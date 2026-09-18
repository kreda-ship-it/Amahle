-- ============================================================
-- 028 — one visit, one employee per service
--
-- DECISIONS #32. The salon employs washers and blow-dry staff who are
-- not stylists. "Braiding, and a wash first" is not an edge case here,
-- it is the ordinary booking — and until now the software refused it,
-- because create_appointment() took ONE employee and demanded they
-- perform every service in the visit. The most common visit in the
-- salon was the one it would not schedule.
--
-- The table was always ready: appointments.employee_id is per ROW, and
-- a visit is several rows sharing a visit_id. Only the function was
-- narrow. So this migration widens the function and adds one column.
--
-- WHAT THIS MIGRATION DOES NOT DO. It does not find those times.
-- get_available_slots() still looks for one employee free for the whole
-- visit, so nothing yet OFFERS a wash by one person and braids by
-- another. That is migration 029, and it is the hard one: the plan is
-- to anchor on the scarce service — the long one, with few people who
-- can do it — and then filter by whether somebody free can do the short
-- one beside it.
--
-- Until then this is groundwork, and the website keeps passing the same
-- employee for every service, which the function still accepts.
-- ============================================================


-- ------------------------------------------------------------
-- 1. employee_requested — did the customer ask for this person?
--
-- The receptionist rearranges the day constantly. She may move an
-- appointment the system assigned; she may not silently move one where
-- the customer asked for Hanna by name.
--
-- Both look identical once written. A customer who picks "Anyone" and
-- is given Hanna produces a row saying Hanna, exactly like a customer
-- who asked for her. The difference exists only at the moment of
-- booking, so it is recorded then or it is lost forever.
--
-- Default false, and every existing row takes it: those bookings were
-- made through a flow that offered "anyone" as the default, and calling
-- them all requests would invent a preference nobody expressed.
-- ------------------------------------------------------------
alter table public.appointments
  add column employee_requested boolean not null default false;

comment on column public.appointments.employee_requested is
  'True when the customer asked for this employee by name. False when the system assigned them. The receptionist may reassign the second without asking; see DECISIONS #32.';

grant update (employee_requested) on public.appointments to authenticated;


-- ------------------------------------------------------------
-- 2. create_appointment() takes an employee per service.
--
-- Dropped and recreated rather than replaced: `create or replace`
-- cannot change a parameter's type, and p_employee_id becomes
-- p_employee_ids. There is one caller — /lib/appointments/create.ts —
-- and it changes with this.
--
-- p_employee_ids may be:
--
--   * the same length as p_service_ids — one employee per service, in
--     the same order
--   * length one — that employee performs everything, which is what the
--     website sends today and what every existing booking looks like
--
-- Every check that was made once for the visit is now made per service
-- against the person actually doing it: that they are bookable, that
-- they perform THAT service rather than all of them, that the rota
-- permits their own stretch, and that nobody else holds it.
-- ------------------------------------------------------------
drop function if exists public.create_appointment(
  uuid, uuid[], uuid, timestamptz, text, text, text, text, text, int, uuid, text);

create or replace function public.create_appointment(
  p_org_id             uuid,
  p_service_ids        uuid[],
  p_employee_ids       uuid[],
  p_starts_at          timestamptz,
  p_customer_name      text,
  p_customer_phone     text,
  p_customer_email     text default null,
  p_notes              text default null,
  p_session_token      text default null,
  p_party_index        int  default 0,
  p_visit_id           uuid default null,
  p_for_name           text default null,
  p_employee_requested boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := public.current_profile_id();
  v_source      text;
  v_wanted      int;
  v_found       int;
  v_unbookable  int;
  v_count       int;
  v_staff_count int;
  v_duration    int;
  v_customer_id uuid;
  v_visit_id    uuid := coalesce(p_visit_id, gen_random_uuid());
  v_cursor      timestamptz;
  v_ends        timestamptz;
  v_blocked     timestamptz;
  v_service     record;
  v_staff       uuid[];
begin
  v_source := case when v_actor is null then 'online' else 'staff' end;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  if p_employee_ids is null or array_length(p_employee_ids, 1) is null then
    raise exception 'Choose who is doing each service.';
  end if;

  if v_actor is not null and p_org_id is distinct from public.current_org_id() then
    raise exception 'You cannot book into another salon.';
  end if;

  if p_starts_at is null then
    raise exception 'A start time is needed to make a booking.';
  end if;

  v_count       := array_length(p_service_ids, 1);
  v_staff_count := array_length(p_employee_ids, 1);

  -- One employee for the whole visit is spelled out into one per service,
  -- so everything below has a single shape to work with rather than two.
  if v_staff_count = 1 and v_count > 1 then
    select array_agg(p_employee_ids[1]) into v_staff
    from generate_series(1, v_count);
  elsif v_staff_count = v_count then
    v_staff := p_employee_ids;
  else
    raise exception 'Give one member of staff per service, or one for the whole visit.';
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

  if v_source = 'online' and v_unbookable > 0 then
    raise exception 'One of those services cannot be booked online. Please call the salon.';
  end if;

  -- Every named person must be real and bookable. Checked over the
  -- distinct set, so booking one stylist for three services asks once.
  select count(*) into v_found
  from public.employees e
  where e.id = any(v_staff)
    and e.org_id     = p_org_id
    and e.deleted_at is null
    and e.is_active
    and e.is_bookable;

  if v_found <> (select count(distinct x) from unnest(v_staff) x) then
    raise exception 'That member of staff cannot be booked.';
  end if;

  -- And each must perform the service they are down for. This is the
  -- check that used to demand one person perform ALL of them, which is
  -- the reason a washer could never appear in a braiding visit.
  perform 1
  from unnest(p_service_ids, v_staff) as t(service_id, employee_id)
  where not exists (
    select 1 from public.employee_services es
    where es.employee_id = t.employee_id
      and es.service_id  = t.service_id
      and es.org_id      = p_org_id
      and es.deleted_at  is null
  );

  if found then
    raise exception 'One of those services is not performed by the person chosen for it.';
  end if;

  if v_source = 'online' and p_starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;

  select sum(s.duration_minutes)
  into v_duration
  from unnest(p_service_ids) with ordinality as t(service_id, ord)
  join public.services s on s.id = t.service_id;

  v_customer_id := public.find_or_create_customer(
    p_org_id, p_customer_phone, p_customer_name, p_customer_email);

  -- ----------------------------------------------------------
  -- One pass over the services, in order. Each one gets its own
  -- stretch of the clock, and every check that concerns a person is
  -- made against the person doing THAT stretch.
  --
  -- The rota check and the hold check moved inside this loop for that
  -- reason: with two employees there is no single window to test, and
  -- testing the whole visit against one of them would let the other be
  -- booked outside their own hours.
  -- ----------------------------------------------------------
  v_cursor := p_starts_at;

  for v_service in
    select t.ord, t.service_id, e.employee_id, s.duration_minutes
    from unnest(p_service_ids, v_staff) with ordinality as t(service_id, employee_id, ord)
    join public.services s on s.id = t.service_id
    join lateral (select t.employee_id) e on true
    order by t.ord
  loop
    v_ends := v_cursor + make_interval(mins => v_service.duration_minutes);

    v_blocked := case
      when v_service.ord = v_count
        then v_ends + make_interval(mins => public.buffer_minutes_for(v_service.service_id))
      else v_ends
    end;

    -- The rota, read live rather than trusted from when the slot was
    -- offered. Durations are editable by anyone holding service.manage.
    if v_source = 'online'
       and not public.schedule_permits(
             p_org_id, v_service.employee_id, v_cursor, v_service.duration_minutes)
    then
      raise exception 'That is not a time we offer. Please choose one of the times shown.';
    end if;

    -- Somebody else's hold, or another member of this same party's. A
    -- hold is not an appointment, so the exclusion constraint does not
    -- see it; the promise a hold makes has to be kept deliberately.
    perform 1
    from public.appointment_holds h
    where h.employee_id = v_service.employee_id
      and h.released_at is null
      and h.expires_at  > now()
      and not (
        h.session_token is not distinct from p_session_token
        and h.party_index is not distinct from p_party_index
      )
      and tstzrange(h.starts_at, h.blocked_until)
          && tstzrange(v_cursor, v_blocked);

    if found then
      raise exception 'Someone else is booking that time right now. Please choose another.';
    end if;

    insert into public.appointments
      (org_id, visit_id, customer_id, employee_id, service_id,
       starts_at, ends_at, blocked_until, source, notes, created_by, for_name,
       employee_requested)
    values
      (p_org_id, v_visit_id, v_customer_id, v_service.employee_id, v_service.service_id,
       v_cursor, v_ends, v_blocked, v_source,
       case when v_service.ord = 1
            then nullif(btrim(coalesce(p_notes, '')), '')
       end,
       v_actor,
       nullif(btrim(coalesce(p_for_name, '')), ''),
       coalesce(p_employee_requested, false));

    v_cursor := v_blocked;
  end loop;

  -- This person's hold has done its job. The rest of the party keeps
  -- theirs until their own appointments are made.
  if p_session_token is not null then
    perform public.release_holds(p_session_token, p_party_index);
  end if;

  return v_visit_id;
end;
$fn$;

comment on function public.create_appointment is
  'The one way an appointment is created. Takes an employee per service — or one for the whole visit — so a wash by one person and braids by another is a single booking. See DECISIONS #32.';

revoke all on function public.create_appointment(
  uuid, uuid[], uuid[], timestamptz, text, text, text, text, text, int, uuid, text, boolean)
  from public;

grant execute on function public.create_appointment(
  uuid, uuid[], uuid[], timestamptz, text, text, text, text, text, int, uuid, text, boolean)
  to anon, authenticated;
