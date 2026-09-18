-- ============================================================
-- test-move-visit.sql — proves migration 039 did what it says
--
-- Run in the SQL editor. Everything happens inside a transaction
-- that is rolled back at the end, so it can be run against dev
-- repeatedly and leaves nothing behind.
--
-- Expected: six 'PASS' rows and no 'FAIL'.
-- ============================================================
begin;

-- ---- 1. the constraint became deferrable ----
select case
         when condeferrable and not condeferred then 'PASS'
         else 'FAIL'
       end as check_1_constraint_is_deferrable_initially_immediate
from pg_constraint
where conname = 'appointments_no_double_booking';

-- ---- 2. it still refuses an overlap by default ----
-- initially immediate means every existing write path is unchanged:
-- the check still fires at statement time unless somebody defers it.
select case
         when condeferred = false then 'PASS'
         else 'FAIL — deferred by default, which would loosen every write path'
       end as check_2_not_deferred_by_default
from pg_constraint
where conname = 'appointments_no_double_booking';

-- ---- 3. move_visit exists, and only staff may run it ----
select case
         when has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('anon', p.oid, 'execute')
         then 'PASS'
         else 'FAIL'
       end as check_3_granted_to_staff_only
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'move_visit';

-- ---- 4. a chained visit moves as one thing ----
-- The case the deferral exists for: rows back to back on one
-- employee, where shifting them one at a time overlaps mid-statement.
do $$
declare
  v_org   uuid;
  v_visit uuid := gen_random_uuid();
  v_cust  uuid;
  v_emp   uuid;
  v_svc   uuid;
  v_base  timestamptz := date_trunc('hour', now()) + interval '40 days';
  v_first timestamptz;
  v_gap   interval;
begin
  select id into v_org from public.organizations where deleted_at is null limit 1;
  select id into v_cust from public.customers where org_id = v_org and deleted_at is null limit 1;

  select es.employee_id, es.service_id into v_emp, v_svc
  from public.employee_services es
  where es.org_id = v_org and es.role = 'lead' and es.deleted_at is null
  limit 1;

  -- Two rows touching end to end, same employee: 10:00-11:00, 11:00-12:00.
  insert into public.appointments
    (org_id, visit_id, customer_id, employee_id, service_id,
     starts_at, ends_at, blocked_until, source, price, phase)
  values
    (v_org, v_visit, v_cust, v_emp, v_svc,
     v_base, v_base + interval '1 hour', v_base + interval '1 hour',
     'staff', 0, 'lead'),
    (v_org, v_visit, v_cust, v_emp, v_svc,
     v_base + interval '1 hour', v_base + interval '2 hours',
     v_base + interval '2 hours', 'staff', 0, 'lead');

  -- Shift forward by thirty minutes. Without the deferral the first
  -- row would overlap the second the instant it moved.
  perform public.move_visit(v_visit, v_base + interval '30 minutes');

  select min(starts_at) into v_first
  from public.appointments where visit_id = v_visit;

  select max(starts_at) - min(starts_at) into v_gap
  from public.appointments where visit_id = v_visit;

  if v_first = v_base + interval '30 minutes' and v_gap = interval '1 hour' then
    raise notice 'check_4_chained_visit_moves_whole: PASS';
  else
    raise notice 'check_4_chained_visit_moves_whole: FAIL (first=%, gap=%)', v_first, v_gap;
  end if;

  -- ---- 5. the internal shape is preserved, not recomputed ----
  if (select count(*) from public.appointments
      where visit_id = v_visit
        and ends_at - starts_at = interval '1 hour') = 2 then
    raise notice 'check_5_lengths_unchanged: PASS';
  else
    raise notice 'check_5_lengths_unchanged: FAIL';
  end if;

  -- ---- 6. a clash with somebody else is still refused ----
  begin
    insert into public.appointments
      (org_id, visit_id, customer_id, employee_id, service_id,
       starts_at, ends_at, blocked_until, source, price, phase)
    values
      (v_org, gen_random_uuid(), v_cust, v_emp, v_svc,
       v_base + interval '45 minutes', v_base + interval '75 minutes',
       v_base + interval '75 minutes', 'staff', 0, 'lead');

    raise notice 'check_6_overlap_still_refused: FAIL — the clash was accepted';
  exception
    when exclusion_violation then
      raise notice 'check_6_overlap_still_refused: PASS';
  end;
end $$;

rollback;
