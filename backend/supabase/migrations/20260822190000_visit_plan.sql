-- ============================================================
-- 031 — get_visit_slots() without a temporary table
--
-- Migration 030 built its working list of services in a temp table and
-- was marked `stable`, which Postgres refuses: a non-volatile function
-- may not create tables. The function applied cleanly and failed on its
-- first call.
--
-- Dropping `stable` would have fixed the error and been the wrong fix.
-- A function that creates and drops a temp table on every call does
-- real work per call for something that is pure arithmetic over rows,
-- and availability is asked this question constantly.
--
-- So the list becomes a function of its own. visit_plan() is the visit
-- as the scheduler needs to see it — position, service, how many
-- minutes once the customer's answers are counted, and how many people
-- can perform it. Everything in 030 that reached for the temp table now
-- asks this instead.
-- ============================================================

create or replace function public.visit_plan(
  p_org_id      uuid,
  p_service_ids uuid[],
  p_selection   jsonb default null
)
returns table (
  ord        int,
  service_id uuid,
  minutes    int,
  qualified  int
)
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    -- With answers: the computed durations from migration 029.
    select l.ord, l.service_id, l.duration_minutes as minutes
    from public.visit_lines(p_org_id, p_selection) l
    where p_selection is not null and jsonb_array_length(p_selection) > 0

    union all

    -- Without: the plain service durations, which is every booking made
    -- before the options existed and every service that asks nothing.
    select t.ord::int, t.service_id, s.duration_minutes
    from unnest(p_service_ids) with ordinality as t(service_id, ord)
    join public.services s
      on  s.id         = t.service_id
      and s.org_id     = p_org_id
      and s.deleted_at is null
    where p_selection is null or jsonb_array_length(p_selection) = 0
  )
  select p.ord,
         p.service_id,
         p.minutes,
         (select count(*)::int
          from public.employee_services es
          join public.employees e
            on  e.id         = es.employee_id
            and e.deleted_at is null
            and e.is_active
            and e.is_bookable
          where es.service_id = p.service_id
            and es.org_id     = p_org_id
            and es.deleted_at is null)
  from plan p
  order by p.ord;
$$;

comment on function public.visit_plan is
  'A visit as the scheduler sees it: each service in order, its length once the answers are counted, and how many people can perform it. "Scarce" is the smallest of that last number.';

revoke execute on function public.visit_plan(uuid, uuid[], jsonb) from public;


create or replace function public.get_visit_slots(
  p_org_id        uuid,
  p_service_ids   uuid[],
  p_from_date     date,
  p_to_date       date default null,
  p_employee_id   uuid default null,
  p_session_token text default null,
  p_party_index   int  default null,
  p_selection     jsonb default null
)
returns table (
  slot_starts_at   timestamptz,
  slot_employee_id uuid,
  slot_assignment  jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_line          record;
  v_anchor_ord    int;
  v_anchor_id     uuid;
  v_offset_before int := 0;
  v_candidate     record;
  v_visit_start   timestamptz;
  v_cursor        timestamptz;
  v_assign        jsonb;
  v_ok            boolean;
  v_pick          uuid;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  -- Nobody performs one of these, so there is nothing to offer. Returning
  -- empty rather than raising: a service with no staff is a gap in the
  -- salon's own records, and a customer should see "no times" rather than
  -- an error about a table they have never heard of.
  if exists (
    select 1 from public.visit_plan(p_org_id, p_service_ids, p_selection)
    where qualified = 0
  ) then
    return;
  end if;

  -- The scarce service: fewest people who can do it, longest if two are
  -- equally rare. This is the resource that limits the day, and it is the
  -- one the expensive search runs over.
  select ord, service_id into v_anchor_ord, v_anchor_id
  from public.visit_plan(p_org_id, p_service_ids, p_selection)
  order by qualified asc, minutes desc, ord asc
  limit 1;

  select coalesce(sum(minutes), 0) into v_offset_before
  from public.visit_plan(p_org_id, p_service_ids, p_selection)
  where ord < v_anchor_ord;

  -- p_employee_id filters the ANCHOR. "I want Hanna" means Hanna does the
  -- braids; it does not mean she also washes.
  for v_candidate in
    select g.slot_starts_at, g.slot_employee_id
    from public.get_available_slots(
           p_org_id, array[v_anchor_id], p_from_date, p_to_date,
           p_employee_id, p_session_token, p_party_index) g
  loop
    v_visit_start := v_candidate.slot_starts_at - make_interval(mins => v_offset_before);
    v_cursor      := v_visit_start;
    v_assign      := jsonb_build_object();
    v_ok          := true;

    for v_line in
      select * from public.visit_plan(p_org_id, p_service_ids, p_selection) order by ord
    loop
      if v_line.ord = v_anchor_ord then
        v_pick := v_candidate.slot_employee_id;
      else
        -- The anchor's own employee first when they can do it too. One pair
        -- of hands for the whole visit is simpler for the customer and
        -- cheaper for the salon than pulling in a second person.
        if exists (
             select 1 from public.employee_services es
             where es.employee_id = v_candidate.slot_employee_id
               and es.service_id  = v_line.service_id
               and es.org_id      = p_org_id
               and es.deleted_at  is null)
           and public.employee_is_free(p_org_id, v_candidate.slot_employee_id,
                                       v_cursor, v_line.minutes,
                                       p_session_token, p_party_index)
        then
          v_pick := v_candidate.slot_employee_id;
        else
          select es.employee_id into v_pick
          from public.employee_services es
          join public.employees e
            on  e.id         = es.employee_id
            and e.deleted_at is null
            and e.is_active
            and e.is_bookable
          where es.service_id = v_line.service_id
            and es.org_id     = p_org_id
            and es.deleted_at is null
            and public.employee_is_free(p_org_id, es.employee_id, v_cursor,
                                        v_line.minutes, p_session_token, p_party_index)
          order by e.display_order, e.full_name
          limit 1;
        end if;
      end if;

      if v_pick is null then
        v_ok := false;
        exit;
      end if;

      v_assign := v_assign || jsonb_build_object(v_line.service_id::text, v_pick::text);
      v_cursor := v_cursor + make_interval(mins => v_line.minutes);
    end loop;

    if v_ok then
      slot_starts_at   := v_visit_start;
      slot_employee_id := v_candidate.slot_employee_id;
      slot_assignment  := v_assign;
      return next;
    end if;
  end loop;
end;
$fn$;
