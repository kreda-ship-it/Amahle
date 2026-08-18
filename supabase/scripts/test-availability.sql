-- Proves get_available_slots() computes free times, and that it is live.
--
-- Run in the SQL editor. Everything is inside a transaction that rolls
-- back, including the working hours and the service change it makes to
-- give itself something deterministic to measure.
--
-- The set-up is deliberate: a 60 minute service with a 15 minute
-- buffer, on a day the employee works 09:00-17:00. Slots should
-- therefore step 75 minutes from 09:00, and the last one is the last
-- whose SERVICE finishes by 17:00 — 15:15, not 16:00.
--
--   09:00  10:15  11:30  12:45  14:00  15:15     = six slots
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
  v_after       int;
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

  -- Deterministic shape, rolled back with everything else.
  update public.services
  set duration_minutes = 60, buffer_minutes = 15
  where id = v_service_id;

  insert into public.employee_working_hours
    (org_id, employee_id, day_of_week, start_time, end_time)
  values
    (v_org_id, v_employee_id, extract(dow from v_day)::int,     '09:00', '17:00'),
    -- A second, untouched day, so check 8 measures spacing without
    -- the booking and time off that checks 5 to 7 introduce.
    (v_org_id, v_employee_id, extract(dow from v_day + 1)::int, '09:00', '17:00');

  -- ---------------------------------------------------------------
  -- 1 & 2. The right number of slots, at the right spacing.
  -- ---------------------------------------------------------------
  select count(*) into v_count
  from public.get_available_slots(v_org_id, v_service_id, v_day);

  insert into results values (
    '1. six slots in a 09:00-17:00 day',
    case when v_count = 6 then 'PASS'
         else format('FAIL — got %s slots, expected 6', v_count) end);

  select slot_starts_at into v_first
  from public.get_available_slots(v_org_id, v_service_id, v_day)
  order by slot_starts_at limit 1;

  select slot_starts_at into v_second
  from public.get_available_slots(v_org_id, v_service_id, v_day)
  order by slot_starts_at offset 1 limit 1;

  insert into results values (
    '2. slots step by duration + buffer (75 min)',
    case when v_second - v_first = interval '75 minutes' then 'PASS'
         else format('FAIL — gap was %s', v_second - v_first) end);

  insert into results values (
    '3. first slot is 09:00 salon time',
    case when (v_first at time zone v_tz)::time = '09:00' then 'PASS'
         else format('FAIL — first slot was %s salon time',
                     (v_first at time zone v_tz)::time) end);

  insert into results values (
    '4. last slot is 15:15, not 16:00 — buffer may overhang closing',
    case when (
      select (max(slot_starts_at) at time zone v_tz)::time
      from public.get_available_slots(v_org_id, v_service_id, v_day)
    ) = '15:15' then 'PASS' else 'FAIL — wrong last slot' end);

  -- ---------------------------------------------------------------
  -- 5. Booking one removes it. Nothing is recalculated by hand.
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

  select count(*) into v_after
  from public.get_available_slots(v_org_id, v_service_id, v_day);

  insert into results values (
    '5. booking a slot removes it, live',
    case when v_after = 5 then 'PASS'
         else format('FAIL — %s slots remain, expected 5', v_after) end);

  insert into results values (
    '6. the booked time is the one that disappeared',
    case when not exists (
      select 1 from public.get_available_slots(v_org_id, v_service_id, v_day)
      where slot_starts_at = v_target
    ) then 'PASS' else 'FAIL — the booked slot is still offered' end);

  -- ---------------------------------------------------------------
  -- 7. Time off removes slots too.
  -- ---------------------------------------------------------------
  insert into public.employee_time_off (org_id, employee_id, starts_at, ends_at)
  values (v_org_id, v_employee_id,
          (v_day + time '13:30') at time zone v_tz,
          (v_day + time '15:00') at time zone v_tz);

  select count(*) into v_after
  from public.get_available_slots(v_org_id, v_service_id, v_day);

  -- Two slots go, not one, and the second is the interesting one:
  --   12:45  service runs to 13:45, crossing the 13:30 start. Removed —
  --          a stylist who leaves at 13:30 cannot finish it.
  --   14:00  runs to 15:00, entirely inside the time off. Removed.
  --   15:15  starts after it ends. Survives.
  -- With 11:30 already booked by check 5, three remain: 09:00, 10:15,
  -- 15:15. Overlap is compared against the SERVICE, not just the start
  -- time, which is the whole point.
  insert into results values (
    '7. time off removes every slot it overlaps, not just those inside it',
    case when v_after = 3 then 'PASS'
         else format('FAIL — %s slots remain, expected 3', v_after) end);

  -- ---------------------------------------------------------------
  -- 8. A service with no buffer of its own inherits the salon's.
  --    Migration 017: null means "use the house rule", which is not
  --    the same as 0.
  -- ---------------------------------------------------------------
  update public.services set buffer_minutes = null where id = v_service_id;

  update public.organizations
  set public_settings = public_settings || '{"default_buffer_minutes": 30}'::jsonb
  where id = v_org_id;

  select slot_starts_at into v_first
  from public.get_available_slots(v_org_id, v_service_id, v_day + 1)
  order by slot_starts_at limit 1;

  select slot_starts_at into v_second
  from public.get_available_slots(v_org_id, v_service_id, v_day + 1)
  order by slot_starts_at offset 1 limit 1;

  insert into results values (
    '8. null buffer inherits the salon default (60 + 30 = 90 min)',
    case when v_second - v_first = interval '90 minutes' then 'PASS'
         else format('FAIL — gap was %s, expected 90 minutes', v_second - v_first) end);

exception
  when others then
    insert into results values ('unexpected error', format('FAIL — %s: %s', SQLSTATE, SQLERRM));
end;
$$;

select check_name, outcome from results order by check_name;

rollback;
