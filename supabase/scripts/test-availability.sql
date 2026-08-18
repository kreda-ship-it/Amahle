-- Proves get_available_slots() computes free times, and that it is live.
--
-- Run in the SQL editor. Everything is inside a transaction that rolls
-- back, including the working hours and the service change it makes to
-- give itself something deterministic to measure.
--
-- The set-up: a 60 minute service with a 15 minute buffer, on a day the
-- employee works 09:00-17:00, with the salon's default 105 minute step
-- and 5 minute rounding.
--
-- An empty day therefore offers five times:
--
--   09:00  10:45  12:30  14:15  16:00
--
-- 16:00 is the last because the SERVICE must finish by 17:00 — its
-- buffer may overhang closing time, and nothing is harmed by cleaning
-- up after the last customer has gone.
--
-- Expected: eight rows, every outcome starting PASS.

begin;

create temp table results (check_name text, outcome text) on commit drop;

do $$
declare
  v_org_id      uuid;
  v_service_id  uuid;
  v_employee_id uuid;
  v_day         date := (now() + interval '14 days')::date;
  v_tz          text;
  v_count       int;
  v_first       timestamptz;
  v_second      timestamptz;
  v_target      timestamptz;
  v_appt        uuid;
begin
  select o.id, o.timezone into v_org_id, v_tz
  from public.organizations o
  where o.slug = 'kedus-hair-salon' and o.deleted_at is null;

  if v_org_id is null then
    insert into results values ('setup', 'FAIL — no organization with slug kedus-hair-salon');
    return;
  end if;

  select es.employee_id, es.service_id
  into v_employee_id, v_service_id
  from public.employee_services es
  join public.services  s on s.id = es.service_id
  join public.employees e on e.id = es.employee_id
  where es.org_id = v_org_id
    and es.deleted_at is null
    and s.deleted_at is null and s.is_active and s.is_bookable_online
    and e.deleted_at is null and e.is_active and e.is_bookable
  limit 1;

  if v_employee_id is null then
    insert into results values
      ('setup', 'FAIL — no bookable employee/service pair. Check employee_services.');
    return;
  end if;

  -- Deterministic shape, rolled back with everything else. The salon's
  -- real step and rounding settings are left alone.
  update public.services
  set duration_minutes = 60, buffer_minutes = 15
  where id = v_service_id;

  update public.organizations
  set public_settings = public_settings
        || '{"slot_step_minutes": 105, "slot_rounding_minutes": 5}'::jsonb
  where id = v_org_id;

  insert into public.employee_working_hours
    (org_id, employee_id, day_of_week, start_time, end_time)
  values
    (v_org_id, v_employee_id, extract(dow from v_day)::int,     '09:00', '17:00'),
    -- A second, untouched day for check 8.
    (v_org_id, v_employee_id, extract(dow from v_day + 1)::int, '09:00', '17:00');

  -- ---------------------------------------------------------------
  -- 1-4. An empty day.
  -- ---------------------------------------------------------------
  select count(*) into v_count
  from public.get_available_slots(v_org_id, v_service_id, v_day);

  insert into results values (
    '1. five slots on an empty 09:00-17:00 day',
    case when v_count = 5 then 'PASS'
         else format('FAIL — got %s slots, expected 5', v_count) end);

  select slot_starts_at into v_first
  from public.get_available_slots(v_org_id, v_service_id, v_day)
  order by slot_starts_at limit 1;

  select slot_starts_at into v_second
  from public.get_available_slots(v_org_id, v_service_id, v_day)
  order by slot_starts_at offset 1 limit 1;

  insert into results values (
    '2. empty stretches step by 105 minutes',
    case when v_second - v_first = interval '105 minutes' then 'PASS'
         else format('FAIL — gap was %s', v_second - v_first) end);

  insert into results values (
    '3. first slot is 09:00 salon time',
    case when (v_first at time zone v_tz)::time = '09:00' then 'PASS'
         else format('FAIL — first slot was %s', (v_first at time zone v_tz)::time) end);

  insert into results values (
    '4. last slot is 16:00 — service finishes by close, buffer may overhang',
    case when (
      select (max(slot_starts_at) at time zone v_tz)::time
      from public.get_available_slots(v_org_id, v_service_id, v_day)
    ) = '16:00' then 'PASS' else 'FAIL — wrong last slot' end);

  -- ---------------------------------------------------------------
  -- 5-6. Booking splits the day into two gaps, each with its own
  --      anchor. 12:30 is booked and reserves until 13:45, so:
  --        gap 09:00-12:30  offers 09:00, 10:45
  --        gap 13:45-17:00  offers 13:45, 15:30
  --      Four remain, and 13:45 is the anchored one — tight against
  --      the appointment that just ended, not on any grid.
  -- ---------------------------------------------------------------
  select slot_starts_at into v_target
  from public.get_available_slots(v_org_id, v_service_id, v_day)
  order by slot_starts_at offset 2 limit 1;

  v_appt := public.create_appointment(
    p_org_id         => v_org_id,
    p_service_id     => v_service_id,
    p_employee_id    => v_employee_id,
    p_starts_at      => v_target,
    p_customer_name  => 'Availability Test',
    p_customer_phone => '(202) 555-0177');

  select count(*) into v_count
  from public.get_available_slots(v_org_id, v_service_id, v_day);

  insert into results values (
    '5. booking splits the day, four slots remain, live',
    case when v_count = 4 then 'PASS'
         else format('FAIL — %s slots remain, expected 4', v_count) end);

  insert into results values (
    '6. a slot appears tight against the booking (13:45, not a grid line)',
    case when exists (
      select 1 from public.get_available_slots(v_org_id, v_service_id, v_day)
      where (slot_starts_at at time zone v_tz)::time = '13:45'
    ) then 'PASS' else 'FAIL — no slot anchored to the end of the appointment' end);

  -- ---------------------------------------------------------------
  -- 7. Time off from 13:30 to 15:00 merges with the 12:30-13:45
  --    appointment into one blocked stretch, 12:30-15:00. Two gaps
  --    remain: 09:00-12:30 offering two, and 15:00-17:00 offering one.
  -- ---------------------------------------------------------------
  insert into public.employee_time_off (org_id, employee_id, starts_at, ends_at)
  values (v_org_id, v_employee_id,
          (v_day + time '13:30') at time zone v_tz,
          (v_day + time '15:00') at time zone v_tz);

  select count(*) into v_count
  from public.get_available_slots(v_org_id, v_service_id, v_day);

  insert into results values (
    '7. time off merges with the booking into one blocked stretch',
    case when v_count = 3 then 'PASS'
         else format('FAIL — %s slots remain, expected 3', v_count) end);

  -- ---------------------------------------------------------------
  -- 8. A service with no buffer of its own inherits the salon's.
  --    With a 30 minute default, booking 09:00 reserves to 10:30, so
  --    the next slot anchors at 10:30 rather than 10:15.
  -- ---------------------------------------------------------------
  update public.services set buffer_minutes = null where id = v_service_id;

  update public.organizations
  set public_settings = public_settings || '{"default_buffer_minutes": 30}'::jsonb
  where id = v_org_id;

  select slot_starts_at into v_target
  from public.get_available_slots(v_org_id, v_service_id, v_day + 1)
  order by slot_starts_at limit 1;

  perform public.create_appointment(
    p_org_id         => v_org_id,
    p_service_id     => v_service_id,
    p_employee_id    => v_employee_id,
    p_starts_at      => v_target,
    p_customer_name  => 'Buffer Test',
    p_customer_phone => '(202) 555-0188');

  select slot_starts_at into v_first
  from public.get_available_slots(v_org_id, v_service_id, v_day + 1)
  order by slot_starts_at limit 1;

  insert into results values (
    '8. null buffer inherits the salon default (next slot 10:30, not 10:15)',
    case when (v_first at time zone v_tz)::time = '10:30' then 'PASS'
         else format('FAIL — next slot was %s, expected 10:30',
                     (v_first at time zone v_tz)::time) end);

exception
  when others then
    insert into results values ('unexpected error', format('FAIL — %s: %s', SQLSTATE, SQLERRM));
end;
$$;

select check_name, outcome from results order by check_name;

rollback;
