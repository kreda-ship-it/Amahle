-- ============================================================
-- 026 — the rota becomes a rule, not just a display
--
-- get_available_slots() is the only function in this database that
-- reads employee_working_hours or employee_time_off. hold_slot() and
-- create_appointment() never did. They check the services, the
-- employee and the overlap against existing appointments, and then
-- accept whatever starts_at they were handed.
--
-- The booking form posts that time as a hidden field. Hidden means
-- invisible on screen, not protected: a request carrying a time the
-- picker never offered was held and booked. Three in the morning, a
-- Sunday the salon is shut, or the middle of a stylist's booked
-- holiday. Time off is not an appointment, so the exclusion constraint
-- on appointments never saw it either — there was nothing left to
-- refuse the row.
--
-- The comment at the top of src/app/(public)/book/actions.ts states
-- the rule the other way round: "the database refuses a service that
-- is not bookable online, a stylist who does not perform it, a time in
-- the past and a slot already taken — and it refuses them whatever
-- calls it." That was true of four things and not of the rota — and it
-- is the whole principle DECISIONS #28 rests on. The Phase 5 staff
-- calendar is about to become a second caller, and would have
-- inherited the gap.
--
--
-- WHY A PREDICATE, AND NOT A RE-RUN OF AVAILABILITY
--
-- The obvious fix is "check the time appears in the list we offered."
-- It is wrong, and the reason is worth keeping.
--
-- Migration 018 deliberately stopped offering times on a grid. Each
-- free stretch starts its own sequence from wherever the previous
-- appointment ended, which is what packs the day. So the LIST CHANGES
-- SHAPE as bookings arrive. A customer holding 10:45 while somebody
-- else books 09:00-10:30 would find their own slot had vanished from
-- the offered list — not because it was taken, but because the stretch
-- it is measured from now begins somewhere else. Membership in the
-- list would refuse a booking that is perfectly valid and held.
--
-- So this checks the four things the ROTA says, which did not move:
-- working hours, time off, lead time, horizon.
--
-- The safety property is that availability can only ever offer times
-- which already satisfy all four. schedule_permits() therefore permits
-- a SUPERSET of what is offered, and can never refuse something a
-- customer was legitimately shown. test-availability.sql check 9 exists
-- to prove that relationship holds, and to keep proving it as the
-- offering rules change — a clock-aligned grid, a different step,
-- shorter services. Change what is offered freely; this file does not
-- need to know.
--
--
-- WHY IT TAKES MINUTES AND NOT SERVICE IDS
--
-- appointment_fill_from_service() deliberately supports an explicit
-- override — "this customer's colour always takes an extra hour" is
-- real, and its comment says a trigger that overwrote it would be
-- worse than no trigger. A check that looked the service up itself
-- could not test an appointment whose length was set by hand, and
-- Phase 5's calendar is exactly where those appear.
--
--
-- STAFF ARE NOT CHECKED, DELIBERATELY
--
-- A receptionist squeezing a regular in at ten past six is a real
-- thing salons do and ROADMAP Phase 4 already commits to it. Only
-- bookings made online by a customer are held to the rota.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Would the rota allow this?
--
-- Four questions, one answer. Reads nothing it does not need and
-- changes nothing at all.
-- ------------------------------------------------------------
create or replace function public.schedule_permits(
  p_org_id      uuid,
  p_employee_id uuid,
  p_starts_at   timestamptz,
  p_minutes     int
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_timezone   text;
  v_lead_hours int;
  v_horizon    int;
  v_day        date;
  v_ends       timestamptz;
begin
  if p_starts_at is null or p_minutes is null or p_minutes <= 0 then
    return false;
  end if;

  select o.timezone,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60)
  into v_timezone, v_lead_hours, v_horizon
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null;

  if not found then
    return false;
  end if;

  -- Too soon. With a lead time of zero this still refuses the past,
  -- which is why there is no separate check for it.
  if p_starts_at < now() + make_interval(hours => v_lead_hours) then
    return false;
  end if;

  -- Too far out.
  if (p_starts_at at time zone v_timezone)::date
     > (now() at time zone v_timezone)::date + v_horizon then
    return false;
  end if;

  v_day  := (p_starts_at at time zone v_timezone)::date;
  v_ends := p_starts_at + make_interval(mins => p_minutes);

  -- Inside ONE working window, never spanning two. Several rows for a
  -- day is a split shift, and the space between its halves is a lunch
  -- break rather than bookable time.
  --
  -- The buffer is deliberately not part of p_minutes. A buffer is
  -- protected from whatever comes AFTER it, and at the end of the day
  -- nothing does — the stylist sweeps up at 18:05 and no customer is
  -- waiting. get_available_slots already offers the last slot of the
  -- day on exactly that basis, so requiring the buffer to finish
  -- before closing here would refuse the last appointment every day.
  -- Between two appointments the buffer IS enforced, by the exclusion
  -- constraint on appointments, which reserves through blocked_until.
  perform 1
  from public.employee_working_hours wh
  where wh.employee_id = p_employee_id
    and wh.org_id      = p_org_id
    and wh.deleted_at  is null
    and wh.day_of_week = extract(dow from v_day)::int
    and p_starts_at >= (v_day + wh.start_time) at time zone v_timezone
    and v_ends      <= (v_day + wh.end_time)   at time zone v_timezone;

  if not found then
    return false;
  end if;

  -- Not away.
  perform 1
  from public.employee_time_off t
  where t.employee_id = p_employee_id
    and t.org_id      = p_org_id
    and t.deleted_at  is null
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_starts_at, v_ends);

  return not found;
end;
$fn$;

comment on function public.schedule_permits(uuid, uuid, timestamptz, int) is
  'Would the rota allow an appointment starting here, lasting this long? Working hours, time off, lead time, horizon. The write path asks this. get_available_slots offers a subset of what it permits, and test-availability.sql check 9 proves it.';

-- NO GRANT, and that is the point. A security definer function runs as
-- its owner, and so does everything it calls — so hold_slot() and
-- create_appointment() can use this while anon cannot. Granting it to
-- anon would hand the public a way to map the staff rota one yes/no at
-- a time, which is precisely what migration 013 revoked those tables
-- to prevent.
revoke execute on function public.schedule_permits(uuid, uuid, timestamptz, int) from public;


-- ------------------------------------------------------------
-- 2. hold_slot(), which also gains a check it never had.
--
-- Unchanged from migration 024 except where marked NEW. The signature
-- is the same, so this is a replace rather than a drop and recreate —
-- there is no moment where the function does not exist.
-- ------------------------------------------------------------
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
as $fn$
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

  -- NEW. create_appointment() has always refused a stylist who is
  -- inactive or not bookable; this function never did, so a hold could
  -- be taken on somebody who could not then be booked, and the
  -- customer reached the last step before finding out.
  perform 1
  from public.employees e
  where e.id         = p_employee_id
    and e.org_id     = p_org_id
    and e.deleted_at is null
    and e.is_active
    and e.is_bookable;

  if not found then
    raise exception 'That member of staff cannot be booked.';
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

  -- NEW. Held time is time the salon cannot sell, so a hold on an hour
  -- nobody works is worse than a refused booking: it takes the slot out
  -- of circulation and then fails at the end anyway.
  if not v_is_staff
     and not public.schedule_permits(p_org_id, p_employee_id, p_starts_at, v_duration)
  then
    raise exception 'That is not a time we offer. Please choose one of the times shown.';
  end if;

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
$fn$;

revoke execute on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text, int) from public;
grant  execute on function public.hold_slot(uuid, uuid[], uuid, timestamptz, text, int) to anon, authenticated;


-- ------------------------------------------------------------
-- 3. create_appointment().
--
-- Unchanged from migration 025 except where marked NEW.
-- ------------------------------------------------------------
create or replace function public.create_appointment(
  p_org_id          uuid,
  p_service_ids     uuid[],
  p_employee_id     uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_email  text default null,
  p_notes           text default null,
  p_session_token   text default null,
  p_party_index     int  default 0,
  p_visit_id        uuid default null,
  p_for_name        text default null
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
  v_duration    int;
  v_visit_end   timestamptz;
  v_customer_id uuid;
  v_visit_id    uuid := coalesce(p_visit_id, gen_random_uuid());
  v_cursor      timestamptz;
  v_ends        timestamptz;
  v_blocked     timestamptz;
  v_service     record;
begin
  v_source := case when v_actor is null then 'online' else 'staff' end;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  if v_actor is not null and p_org_id is distinct from public.current_org_id() then
    raise exception 'You cannot book into another salon.';
  end if;

  if p_starts_at is null then
    raise exception 'A start time is needed to make a booking.';
  end if;

  v_count := array_length(p_service_ids, 1);
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

  perform 1
  from public.employees e
  where e.id         = p_employee_id
    and e.org_id     = p_org_id
    and e.deleted_at is null
    and e.is_active
    and e.is_bookable;

  if not found then
    raise exception 'That member of staff cannot be booked.';
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

  if v_source = 'online' and p_starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;

  select sum(s.duration_minutes)
  into v_duration
  from unnest(p_service_ids) with ordinality as t(service_id, ord)
  join public.services s on s.id = t.service_id;

  -- NEW. The rota, checked at the moment the row is written. Durations
  -- are editable by anyone holding service.manage, so this reads them
  -- live rather than trusting what they were when the slot was offered
  -- or held.
  if v_source = 'online'
     and not public.schedule_permits(p_org_id, p_employee_id, p_starts_at, v_duration)
  then
    raise exception 'That is not a time we offer. Please choose one of the times shown.';
  end if;

  v_visit_end := p_starts_at
    + make_interval(mins => v_duration)
    + make_interval(mins => public.buffer_minutes_for(p_service_ids[v_count]));

  -- Somebody else's hold, or another member of this same party's.
  -- A hold is not an appointment, so the exclusion constraint would not
  -- catch it; the promise a hold makes has to be kept deliberately.
  perform 1
  from public.appointment_holds h
  where h.employee_id = p_employee_id
    and h.released_at is null
    and h.expires_at  > now()
    and not (
      h.session_token is not distinct from p_session_token
      and h.party_index is not distinct from p_party_index
    )
    and tstzrange(h.starts_at, h.blocked_until)
        && tstzrange(p_starts_at, v_visit_end);

  if found then
    raise exception 'Someone else is booking that time right now. Please choose another.';
  end if;

  v_customer_id := public.find_or_create_customer(
    p_org_id, p_customer_phone, p_customer_name, p_customer_email);

  v_cursor := p_starts_at;

  for v_service in
    select t.ord, t.service_id, s.duration_minutes
    from unnest(p_service_ids) with ordinality as t(service_id, ord)
    join public.services s on s.id = t.service_id
    order by t.ord
  loop
    v_ends := v_cursor + make_interval(mins => v_service.duration_minutes);

    v_blocked := case
      when v_service.ord = v_count
        then v_ends + make_interval(mins => public.buffer_minutes_for(v_service.service_id))
      else v_ends
    end;

    insert into public.appointments
      (org_id, visit_id, customer_id, employee_id, service_id,
       starts_at, ends_at, blocked_until, source, notes, created_by, for_name)
    values
      (p_org_id, v_visit_id, v_customer_id, p_employee_id, v_service.service_id,
       v_cursor, v_ends, v_blocked, v_source,
       case when v_service.ord = 1
            then nullif(btrim(coalesce(p_notes, '')), '')
       end,
       v_actor,
       nullif(btrim(coalesce(p_for_name, '')), ''));

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

revoke execute on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text, text, int, uuid, text) from public;
grant  execute on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text, text, int, uuid, text) to anon, authenticated;
