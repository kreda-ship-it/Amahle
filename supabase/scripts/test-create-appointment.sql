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
-- Expected: seven rows, every outcome starting PASS.

begin;

create temp table results (check_name text, outcome text) on commit drop;

do $$
declare
  v_org_id      uuid;
  v_service_id  uuid;
  v_employee_id uuid;
  v_offline_id  uuid;
  v_when        timestamptz := now() + interval '30 days';
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
  select o.id into v_org_id
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
  limit 1;

  if v_employee_id is null then
    insert into results values
      ('setup', 'FAIL — no bookable employee/service pair. Check employee_services.');
    return;
  end if;

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
    p_starts_at      => v_when + interval '1 day',
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
      p_starts_at      => v_when + interval '3 days',
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

exception
  when others then
    insert into results values ('unexpected error', format('FAIL — %s: %s', SQLSTATE, SQLERRM));
end;
$$;

select check_name, outcome from results order by check_name;

rollback;
