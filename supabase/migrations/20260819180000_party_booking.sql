-- ============================================================
-- 024 — booking for more than one person
--
-- "Blow dry and trim for her, and braids for her daughter."
--
-- THE DAUGHTER HAS NO PHONE NUMBER, and that decides the shape of this.
-- customers.phone is the identity — it is how find-or-create works and
-- it is unique per salon — so two people cannot share one. A child
-- booking with her mother has no number of her own.
--
-- So a party is ONE customer record, the person who can actually be
-- contacted, and each appointment says who it is for. Decided
-- 2026-08-19.
--
-- The cost is real and worth writing down: the daughter's service
-- history attaches to her mother's record. When customer records get
-- screens in Phase 6, "Amira's hair formula" will sit under her
-- mother's name until someone splits them. That is a merge job, and a
-- far easier one than un-picking a nullable identity column would be.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Who is actually in the chair.
--
-- Null means the customer themselves, which is every booking made
-- before today and most bookings after it.
-- ------------------------------------------------------------
alter table public.appointments add column for_name text;

comment on column public.appointments.for_name is
  'Who this appointment is for, when it is not the customer themselves — a child, a friend. Null is the normal case.';


-- ------------------------------------------------------------
-- 2. A session can hold one slot PER PERSON.
--
-- Until now one session held one slot, and taking a new one released
-- the old. For a party that is wrong: person one's hold has to survive
-- while person two picks a time.
--
-- It also flips the rule about whose holds block whom. "Your own holds
-- do not block you" becomes "your own hold FOR THIS SAME PERSON does
-- not block you" — because if the mother has Hanna at 10:45, the
-- daughter genuinely needs somebody else.
-- ------------------------------------------------------------
alter table public.appointment_holds
  add column party_index int not null default 0;

comment on column public.appointment_holds.party_index is
  'Which person in the party this hold is for. 0 is the person booking, and is the only value for an ordinary booking.';

drop index if exists public.appointment_holds_session_idx;

create index appointment_holds_session_idx
  on public.appointment_holds (session_token, party_index)
  where released_at is null;


-- ------------------------------------------------------------
-- 3. The functions, all of which now know about a party.
-- ------------------------------------------------------------
drop function if exists public.get_available_slots(uuid, uuid[], date, date, uuid, text);
drop function if exists public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text, text);
drop function if exists public.hold_slot(uuid, uuid[], uuid, timestamptz, text);
drop function if exists public.release_holds(text);
drop function if exists public.get_hold(text);


-- Releasing. A null party index means the whole party — used after a
-- booking is finished, and when someone abandons.
create or replace function public.release_holds(
  p_session_token text default null,
  p_party_index   int  default null
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
      or (
        p_session_token is not null
        and session_token = p_session_token
        and (p_party_index is null or party_index = p_party_index)
      )
    )
$$;

revoke execute on function public.release_holds(text, int) from public;
grant  execute on function public.release_holds(text, int) to anon, authenticated;


create or replace function public.hold_slot(
  p_org_id        uuid,
  p_service_ids   uuid[],
  p_employee_id   uuid,
  p_starts_at     timestamptz,
  p_session_token text,
  p_party_index   int default 0
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

  -- Expired holds everywhere, and THIS PERSON's previous choice only.
  -- The rest of the party keeps its times.
  perform public.release_holds(p_session_token, p_party_index);

  perform 1
  from public.appointments a
  where a.employee_id = p_employee_id
    and a.deleted_at  is null
    and a.status not in ('cancelled', 'no_show')
    and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, v_blocked);

  if found then
    raise exception 'That time has just been booked. Please choose another.';
  end if;

  insert into public.appointment_holds
    (org_id, employee_id, starts_at, blocked_until,
     session_token, party_index, expires_at)
  values
    (p_org_id, p_employee_id, p_starts_at, v_blocked,
     p_session_token, p_party_index, now() + make_interval(mins => v_minutes))
  returning expires_at into v_expires;

  return v_expires;
end;
$$;

revoke execute on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text, int) from public;
grant  execute on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text, int) to anon, authenticated;


-- Every live hold this session has, one per person.
create or replace function public.get_holds(
  p_session_token text
)
returns table (
  party_index  int,
  employee_id  uuid,
  starts_at    timestamptz,
  blocked_until timestamptz,
  expires_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (h.party_index)
         h.party_index, h.employee_id, h.starts_at, h.blocked_until, h.expires_at
  from public.appointment_holds h
  where h.session_token = p_session_token
    and h.released_at is null
    and h.expires_at  > now()
  order by h.party_index, h.created_at desc
$$;

revoke execute on function public.get_holds(text) from public;
grant  execute on function public.get_holds(text) to anon, authenticated;
