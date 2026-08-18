-- ============================================================
-- 022 — holding a slot while someone finishes booking
--
-- Between choosing a time and pressing Confirm, the slot is currently
-- fair game. Two customers can be filling in the same form for the same
-- 10:45, and the second finds out only when the database refuses them.
-- The recovery for that exists and works, but the better answer is that
-- the second customer never sees the slot at all.
--
-- A hold is fifteen minutes. Long enough to type a name and a phone
-- number, short enough that an abandoned booking does not take an
-- afternoon out of circulation.
--
-- WHY A TABLE AND NOT A PROVISIONAL APPOINTMENT
--
-- An appointment is something the salon acts on: it appears on the
-- calendar, it is audited, it has a customer attached. A hold has no
-- customer — at the moment it is made we do not know their name. Making
-- them the same thing would put half-finished strangers on the
-- calendar, and the salon would rightly stop trusting it.
--
-- THE SESSION SEES ITS OWN HOLD AS FREE
--
-- Availability treats a live hold as busy for everyone except the
-- session that made it. Otherwise the customer who just picked 10:45
-- would reload the page and find that 10:45 had vanished.
-- ============================================================


-- ------------------------------------------------------------
-- 1. appointment_holds.
--
-- No customer_id: there is no customer yet. No soft-delete column
-- either — `released_at` does that job and says what actually happened,
-- which is that a hold ended rather than a record was deleted.
--
-- Rows are kept after release rather than removed. They cost nothing,
-- they are a record of how often people abandon a booking, and DELETE
-- is granted to nobody anywhere in this database.
-- ------------------------------------------------------------
create table public.appointment_holds (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  employee_id    uuid not null,
  starts_at      timestamptz not null,
  blocked_until  timestamptz not null,

  -- Which browser this belongs to. Random, from the application, and
  -- kept in a cookie. It identifies a booking attempt, not a person.
  session_token  text not null,

  expires_at     timestamptz not null,
  released_at    timestamptz,
  created_at     timestamptz not null default now(),

  constraint appointment_holds_employee_same_org
    foreign key (employee_id, org_id) references public.employees (id, org_id),

  constraint appointment_holds_end_after_start
    check (blocked_until > starts_at)
);

comment on table public.appointment_holds is
  'A slot reserved for a few minutes while someone finishes booking it. No customer — at the moment a hold is made we do not know who they are.';

-- Two people clicking the same time in the same instant is exactly the
-- race this table exists to fix, so the guarantee comes from the
-- database rather than from a check that can be overtaken.
--
-- The predicate cannot mention expires_at: `now()` is not immutable, so
-- Postgres will not index on it. Stale holds are therefore released
-- explicitly before every insert — see hold_slot().
alter table public.appointment_holds
  add constraint appointment_holds_no_overlap
  exclude using gist (
    employee_id with =,
    tstzrange(starts_at, blocked_until) with &&
  )
  where (released_at is null);

create index appointment_holds_session_idx
  on public.appointment_holds (session_token)
  where released_at is null;

create index appointment_holds_org_id_idx on public.appointment_holds (org_id);

alter table public.appointment_holds enable row level security;

-- Nobody reads or writes this table directly, in any role. It is
-- reached only through the functions below, which is what stops a
-- browser holding every slot in the salon.
revoke all on public.appointment_holds from anon, authenticated;

-- No audit trigger. A hold is not an action the salon took, and audit
-- rows for abandoned browsing would drown the log it does care about.


-- ------------------------------------------------------------
-- 2. Releasing.
--
-- Both jobs in one place: stale holds everywhere, and this session's
-- own holds. Choosing a different time releases the previous one
-- immediately — decided 2026-08-19 — so a customer comparing four times
-- never sits on four slots.
-- ------------------------------------------------------------
create or replace function public.release_holds(
  p_session_token text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.appointment_holds
  set released_at = now()
  where released_at is null
    and (
      expires_at <= now()
      or (p_session_token is not null and session_token = p_session_token)
    )
$$;

comment on function public.release_holds(text) is
  'Ends expired holds everywhere, and every live hold belonging to one session. Called before taking a new hold and after a booking is made.';

revoke execute on function public.release_holds(text) from public;
grant  execute on function public.release_holds(text) to anon, authenticated;


-- ------------------------------------------------------------
-- 3. Taking a hold.
--
-- Validates the same things create_appointment does, because a hold on
-- a slot that could never be booked is worse than useless — it takes
-- the time out of circulation and then fails at the end.
-- ------------------------------------------------------------
create or replace function public.hold_slot(
  p_org_id        uuid,
  p_service_ids   uuid[],
  p_employee_id   uuid,
  p_starts_at     timestamptz,
  p_session_token text
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_staff   boolean := public.current_profile_id() is not null;
  v_wanted     int;
  v_found      int;
  v_unbookable int;
  v_duration   int;
  v_buffer     int;
  v_minutes    int;
  v_blocked    timestamptz;
  v_expires    timestamptz;
begin
  if p_session_token is null or btrim(p_session_token) = '' then
    raise exception 'A booking session is needed to hold a time.';
  end if;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  select coalesce((o.public_settings ->> 'hold_minutes')::int, 15)
  into v_minutes
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null;

  if not found then
    raise exception 'That salon does not exist.';
  end if;

  select count(distinct x) into v_wanted from unnest(p_service_ids) x;

  select count(*), count(*) filter (where not s.is_bookable_online)
  into v_found, v_unbookable
  from public.services s
  where s.id = any(p_service_ids)
    and s.org_id     = p_org_id
    and s.deleted_at is null
    and s.is_active;

  if v_found <> v_wanted then
    raise exception 'One of those services is not available.';
  end if;

  if not v_is_staff and v_unbookable > 0 then
    raise exception 'One of those services cannot be booked online. Please call the salon.';
  end if;

  perform 1
  from public.employee_services es
  where es.employee_id = p_employee_id
    and es.org_id      = p_org_id
    and es.deleted_at  is null
    and es.service_id  = any(p_service_ids)
  group by es.employee_id
  having count(distinct es.service_id) = v_wanted;

  if not found then
    raise exception 'That member of staff does not perform all of those services.';
  end if;

  select sum(s.duration_minutes)
  into v_duration
  from unnest(p_service_ids) with ordinality as t(service_id, ord)
  join public.services s on s.id = t.service_id;

  v_buffer  := public.buffer_minutes_for(p_service_ids[array_length(p_service_ids, 1)]);
  v_blocked := p_starts_at + make_interval(mins => v_duration + v_buffer);

  -- Expired holds anywhere, and this session's previous choice.
  -- Both must go before the insert, or the exclusion constraint below
  -- would refuse a slot that is only notionally taken.
  perform public.release_holds(p_session_token);

  -- A hold must not sit on top of a real booking.
  perform 1
  from public.appointments a
  where a.employee_id = p_employee_id
    and a.deleted_at  is null
    and a.status not in ('cancelled', 'no_show')
    and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, v_blocked);

  if found then
    raise exception 'That time has just been booked. Please choose another.';
  end if;

  v_expires := now() + make_interval(mins => v_minutes);

  -- If another session got here first, the exclusion constraint raises
  -- 23P01 and the caller treats it exactly like a taken slot, which is
  -- what it is.
  insert into public.appointment_holds
    (org_id, employee_id, starts_at, blocked_until, session_token, expires_at)
  values
    (p_org_id, p_employee_id, p_starts_at, v_blocked, p_session_token, v_expires);

  return v_expires;
end;
$$;

comment on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text) is
  'Reserve a slot for a few minutes while someone finishes booking. Returns when the hold lapses.';

revoke execute on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text) from public;
grant  execute on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 4. Reading back your own hold, so the page can say how long is left.
-- ------------------------------------------------------------
create or replace function public.get_hold(
  p_session_token text
)
returns table (
  employee_id  uuid,
  starts_at    timestamptz,
  expires_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select h.employee_id, h.starts_at, h.expires_at
  from public.appointment_holds h
  where h.session_token = p_session_token
    and h.released_at is null
    and h.expires_at  > now()
  order by h.created_at desc
  limit 1
$$;

revoke execute on function public.get_hold(text) from public;
grant  execute on function public.get_hold(text) to anon, authenticated;
