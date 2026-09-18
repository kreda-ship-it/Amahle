-- Proves create_appointment() does what migration 015 claims.
--
-- Run this in the SQL editor. Everything happens inside a transaction
-- that rolls back, so no appointment and no customer survives it —
-- same approach as test-tenant-isolation.sql, and for the same reason:
-- DELETE is granted to nobody, so a test row created for real would be
-- stuck in the database forever.
--
-- Run as the SQL editor's own role, which is not a logged-in member of
-- staff. current_profile_id() is therefore null and every booking below
-- is recorded as source = 'online' — which is exactly the path worth
-- testing, because it is the one that cannot use ordinary privileges.
--
-- Every booking below is made at a time taken from the REAL ROTA.
-- It used to be a flat `now() + 30 days` — an arbitrary instant, at
-- whatever time of day the test happened to run, on whatever weekday
-- that landed on. Migration 026 refuses arbitrary instants, and it is
-- right to.
--
-- Checks 8 to 10 arrived with that migration. Each sends a time the
-- picker would never offer, the way an edited hidden form field would,
-- and each must be refused.
--
-- Expected: ten rows, every outcome starting PASS.

begin;

create temp table results (check_name text, outcome text) on commit drop;

do $$
declare
  v_org_id      uuid;
  v_service_id  uuid;
  v_employee_id uuid;
  v_offline_id  uuid;
  v_when        timestamptz;
  v_times       timestamptz[];
  v_offday      date;
  v_tz          text;
  v_first       uuid;
  v_second      uuid;
  v_customer_a  uuid;
  v_customer_b  uuid;
  v_ends        timestamptz;
  v_blocked     timestamptz;
  v_price       numeric;
  v_source      text;
  v_duration    int;
  v_buffer      int;
  v_second_service uuid;
  v_chain       uuid;
  v_rows        int;
begin
  select o.id, o.timezone into v_org_id, v_tz
  from public.organizations o
  where o.slug = 'kedus-hair-salon' and o.deleted_at is null;

  if v_org_id is null then
    insert into results values ('setup', 'FAIL — no organization with slug kedus-hair-salon');
    return;
  end if;

  -- Any employee/service pair the salon can actually take online.
  select es.employee_id, es.service_id, s.duration_minutes, coalesce(s.buffer_minutes, 0)
  into v_employee_id, v_service_id, v_duration, v_buffer
  from public.employee_services es
  join public.services  s on s.id = es.service_id
  join public.employees e on e.id = es.employee_id
  where es.org_id = v_org_id
    and es.deleted_at is null
    and s.deleted_at is null and s.is_active and s.is_bookable_online
    and e.deleted_at is null and e.is_active and e.is_bookable
  order by s.duration_minutes
  limit 1;

  if v_employee_id is null then
    insert into results values
      ('setup', 'FAIL — no bookable employee/service pair. Check employee_services.');
    return;
  end if;

  -- Four times the rota actually permits, about a month out: the start
  -- of the first working window on each of the next four working days.
  select array_agg(t order by t) into v_times
  from (
    select distinct on (d::date)
           (d::date + wh.start_time) at time zone v_tz as t
    from generate_series(
      (now() at time zone v_tz)::date + 30,
      (now() at time zone v_tz)::date + 44,
      interval '1 day') as d
    join public.employee_working_hours wh
      on  wh.employee_id = v_employee_id
      and wh.org_id      = v_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from d::date)::int
    order by d::date, wh.start_time
    limit 4
  ) s;

  if v_times is null or array_length(v_times, 1) < 4 then
    insert into results values ('setup',
      'FAIL — fewer than four working days in a fortnight. Check employee_working_hours.');
    return;
  end if;

  v_when := v_times[1];

  -- ---------------------------------------------------------------
  -- 1. A booking is created, and the trigger fills what was omitted.
  -- ---------------------------------------------------------------
  v_first := public.create_appointment(
    p_org_id         => v_org_id,
    p_service_ids    => array[v_service_id],
    p_employee_id    => v_employee_id,
    p_starts_at      => v_when,
    p_customer_name  => 'Test Customer',
    p_customer_phone => '(202) 555-0143'
  );

  select a.ends_at, a.blocked_until, a.price, a.source, a.customer_id
  into v_ends, v_blocked, v_price, v_source, v_customer_a
  from public.appointments a where a.visit_id = v_first;

  insert into results values (
    '1. booking created',
    case when v_first is not null then 'PASS' else 'FAIL — no id returned' end);

  insert into results values (
    '2. trigger filled ends_at, blocked_until, price',
    case
      when v_ends    = v_when + make_interval(mins => v_duration)
       and v_blocked = v_ends + make_interval(mins => v_buffer)
       and v_price is not null
      then 'PASS'
      else format('FAIL — ends %s, blocked %s, price %s', v_ends, v_blocked, v_price)
    end);

  insert into results values (
    '3. source derived as online, not passed in',
    case when v_source = 'online' then 'PASS'
         else format('FAIL — source was %s', v_source) end);

  -- ---------------------------------------------------------------
  -- 4. The same slot cannot be booked twice. This is the constraint
  --    the whole project rests on.
  -- ---------------------------------------------------------------
  begin
    perform public.create_appointment(
      p_org_id         => v_org_id,
      p_service_ids    => array[v_service_id],
      p_employee_id    => v_employee_id,
      p_starts_at      => v_when,
      p_customer_name  => 'Someone Else',
      p_customer_phone => '202 555 0199'
    );

    insert into results values
      ('4. double booking refused', 'FAIL — the second booking was accepted');
  exception
    when exclusion_violation then
      insert into results values ('4. double booking refused', 'PASS');
  end;

  -- ---------------------------------------------------------------
  -- 5. The same phone number written differently is the same person.
  -- ---------------------------------------------------------------
  v_second := public.create_appointment(
    p_org_id         => v_org_id,
    p_service_ids    => array[v_service_id],
    p_employee_id    => v_employee_id,
    p_starts_at      => v_times[2],
    p_customer_name  => 'Test Customer Typed Differently',
    p_customer_phone => '+1 202-555-0143'
  );

  select a.customer_id into v_customer_b
  from public.appointments a where a.visit_id = v_second;

  insert into results values (
    '5. same number, different spelling, one customer',
    case when v_customer_a = v_customer_b then 'PASS'
         else 'FAIL — two customer records for one phone number' end);

  -- ---------------------------------------------------------------
  -- 6-7. A visit of two services, back to back.
  --
  -- The buffer resets the station between CUSTOMERS, so there is none
  -- between two services on the same head. The first ends exactly
  -- where the second begins; only the last one is followed by cleanup.
  -- ---------------------------------------------------------------
  select es.service_id into v_second_service
  from public.employee_services es
  join public.services s on s.id = es.service_id
  where es.employee_id = v_employee_id
    and es.deleted_at is null
    and s.deleted_at is null and s.is_active and s.is_bookable_online
    and s.id <> v_service_id
  order by s.duration_minutes
  limit 1;

  if v_second_service is null then
    insert into results values
      ('6. chained visit', 'SKIPPED — this employee performs only one bookable service');
    insert into results values
      ('7. buffer follows the last service only', 'SKIPPED');
  else
    v_chain := public.create_appointment(
      p_org_id         => v_org_id,
      p_service_ids    => array[v_service_id, v_second_service],
      p_employee_id    => v_employee_id,
      p_starts_at      => v_times[3],
      p_customer_name  => 'Chain Test',
      p_customer_phone => '202 555 0166');

    select count(*) into v_rows
    from public.appointments where visit_id = v_chain;

    insert into results values (
      '6. a two-service visit creates two rows sharing one visit_id',
      case when v_rows = 2 then 'PASS'
           else format('FAIL — %s rows', v_rows) end);

    -- The first row's reserved time must end exactly where the second
    -- starts. Any gap is a buffer that should not be there.
    insert into results values (
      '7. no buffer between them; cleanup follows the last only',
      case when (
        select a1.blocked_until = a2.starts_at and a1.ends_at = a1.blocked_until
        from public.appointments a1
        join public.appointments a2
          on a2.visit_id = a1.visit_id and a2.starts_at > a1.starts_at
        where a1.visit_id = v_chain
        limit 1
      ) then 'PASS' else 'FAIL — a gap appeared between two services' end);
  end if;

  -- ---------------------------------------------------------------
  -- 8-10. The rota is a rule, not a display. Migration 026.
  --
  -- Before it, all three of these were accepted: the booking form
  -- posts starts_at as a hidden field, and nothing on the write path
  -- ever consulted employee_working_hours or employee_time_off.
  -- ---------------------------------------------------------------
  begin
    perform public.create_appointment(
      p_org_id         => v_org_id,
      p_service_ids    => array[v_service_id],
      p_employee_id    => v_employee_id,
      p_starts_at      => v_times[1] - interval '1 hour',
      p_customer_name  => 'Too Early',
      p_customer_phone => '202 555 0122');

    insert into results values
      ('8. an hour before opening refused', 'FAIL — booked outside working hours');
  exception
    when raise_exception then
      insert into results values ('8. an hour before opening refused', 'PASS');
  end;

  -- A weekday this employee has no working hours row for at all.
  select d::date into v_offday
  from generate_series(
    (now() at time zone v_tz)::date + 30,
    (now() at time zone v_tz)::date + 44,
    interval '1 day') as d
  where not exists (
    select 1
    from public.employee_working_hours wh
    where wh.employee_id = v_employee_id
      and wh.org_id      = v_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from d::date)::int)
  limit 1;

  if v_offday is null then
    insert into results values
      ('9. a non-working day refused', 'SKIPPED — this employee works every day');
  else
    begin
      perform public.create_appointment(
        p_org_id         => v_org_id,
        p_service_ids    => array[v_service_id],
        p_employee_id    => v_employee_id,
        p_starts_at      => (v_offday + time '12:00') at time zone v_tz,
        p_customer_name  => 'Day Off',
        p_customer_phone => '202 555 0133');

      insert into results values
        ('9. a non-working day refused', 'FAIL — booked on a day with no rota');
    exception
      when raise_exception then
        insert into results values ('9. a non-working day refused', 'PASS');
    end;
  end if;

  -- Time off is not an appointment, so the exclusion constraint never
  -- saw it. This is the one that was refused by nothing at all.
  insert into public.employee_time_off (org_id, employee_id, starts_at, ends_at)
  values (v_org_id, v_employee_id,
          v_times[4] - interval '1 hour',
          v_times[4] + interval '8 hours');

  begin
    perform public.create_appointment(
      p_org_id         => v_org_id,
      p_service_ids    => array[v_service_id],
      p_employee_id    => v_employee_id,
      p_starts_at      => v_times[4],
      p_customer_name  => 'On Holiday',
      p_customer_phone => '202 555 0144');

    insert into results values
      ('10. booked time off refused', 'FAIL — booked during a holiday');
  exception
    when raise_exception then
      insert into results values ('10. booked time off refused', 'PASS');
  end;

exception
  when others then
    insert into results values ('unexpected error', format('FAIL — %s: %s', SQLSTATE, SQLERRM));
end;
$$;

select check_name, outcome from results order by check_name;

rollback;
