-- Say who can perform the services the mind map added.
--
-- Sixty of the eighty-four services had nobody attached, which means
-- availability correctly offered no times at all for any of them: a service
-- nobody performs cannot be booked, and get_visit_slots() returns nothing
-- rather than guessing.
--
-- DERIVED, NOT INVENTED. For each new service, the people assigned are the
-- people who ALREADY perform something else in the same top-level category.
-- Hanna is on the braiding services because she is already on the salon's
-- braiding services; Yonas is on the cuts because he is already on the cuts.
-- The salon's own record of who does what is the source, not my reading of a
-- job title.
--
-- Four categories had nothing to derive from, because the old menu had
-- nothing in them: wigs, extensions, take-down and consultations. Those go to
-- the two stylists who already perform across every other category. That is a
-- GUESS and it is the only one in this file — Selam should confirm it, and
-- correcting it is one delete and one insert per person.
--
-- Safe to run more than once. Nothing is duplicated and nothing is removed:
-- an employee already linked to a service is skipped, and this file never
-- takes an assignment away.

do $$
declare
  v_org uuid;
  v_added int;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  -- Which top-level category each service belongs to, following parents up.
  create temporary table _svc_top on commit drop as
  select s.id as service_id,
         coalesce(parent.id, c.id) as top_id
  from public.services s
  join public.service_categories c on c.id = s.category_id
  left join public.service_categories parent on parent.id = c.parent_id
  where s.org_id = v_org and s.deleted_at is null;

  -- Who already works in each top-level category.
  create temporary table _cat_staff on commit drop as
  select distinct t.top_id, es.employee_id
  from public.employee_services es
  join _svc_top t on t.service_id = es.service_id
  where es.org_id = v_org and es.deleted_at is null;

  -- 1. Derived: everyone who already works in this category.
  insert into public.employee_services (org_id, employee_id, service_id)
  select v_org, cs.employee_id, t.service_id
  from _svc_top t
  join _cat_staff cs on cs.top_id = t.top_id
  where not exists (
    select 1 from public.employee_services es
    where es.employee_id = cs.employee_id
      and es.service_id  = t.service_id
      and es.deleted_at  is null);

  get diagnostics v_added = row_count;
  raise notice 'derived assignments: %', v_added;

  -- 2. The guess, for categories the old menu never covered. The employees
  --    who already perform work in the most categories — the full-service
  --    stylists — rather than a name typed in here.
  insert into public.employee_services (org_id, employee_id, service_id)
  select v_org, e.employee_id, t.service_id
  from _svc_top t
  cross join (
    select es.employee_id
    from public.employee_services es
    join _svc_top t2 on t2.service_id = es.service_id
    where es.org_id = v_org and es.deleted_at is null
    group by es.employee_id
    having count(distinct t2.top_id) >= 4
  ) e
  where not exists (select 1 from _cat_staff cs where cs.top_id = t.top_id)
    and not exists (
      select 1 from public.employee_services es
      where es.employee_id = e.employee_id
        and es.service_id  = t.service_id
        and es.deleted_at  is null);

  get diagnostics v_added = row_count;
  raise notice 'guessed assignments (uncovered categories): %', v_added;
end $$;
