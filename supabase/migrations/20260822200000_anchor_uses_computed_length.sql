-- ============================================================
-- 032 — the anchor is checked against its real length, not its base
--
-- A hole in 030/031, found by comparing the same visit with and without
-- the customer's answers: it returned the same thirty-three times for
-- both.
--
-- get_visit_slots() asks get_available_slots() for candidate times for
-- the scarce service. That function computes a duration from the
-- SERVICE ROW — 360 minutes for knotless braids — because it predates
-- options and knows nothing about them. Boho, waist length and
-- medium-big make the real job 450. So every candidate was generated
-- against a six-hour gap for a seven-and-a-half-hour appointment, and
-- the support services were verified while the appointment they hang
-- off was not.
--
-- That is the exact failure this whole line of work exists to prevent,
-- reintroduced one layer up.
--
-- THE FIX, AND WHY IT IS NOT "TEACH get_available_slots ABOUT OPTIONS".
--
-- get_available_slots() is the primitive: the times one employee has
-- free for one stretch. Threading a selection into it would push the
-- option engine down into the layer that should stay ignorant of it,
-- and it is called from places that have no selection to give.
--
-- Instead, its output is treated as what it is — CANDIDATES — and every
-- segment of the visit is verified afterwards, the anchor included.
-- employee_is_free() already asks the whole question: rota, time off,
-- existing appointments, other people's holds. The anchor now goes
-- through it like every other service.
--
-- The consequence worth stating: candidates are generated generously
-- and filtered strictly. A visit longer than its base duration returns
-- FEWER times, which is the correct direction to be wrong in.
-- ============================================================

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

  if exists (
    select 1 from public.visit_plan(p_org_id, p_service_ids, p_selection)
    where qualified = 0
  ) then
    return;
  end if;

  select ord, service_id into v_anchor_ord, v_anchor_id
  from public.visit_plan(p_org_id, p_service_ids, p_selection)
  order by qualified asc, minutes desc, ord asc
  limit 1;

  select coalesce(sum(minutes), 0) into v_offset_before
  from public.visit_plan(p_org_id, p_service_ids, p_selection)
  where ord < v_anchor_ord;

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
        -- NEW. The candidate was generated against the service's base
        -- duration; this checks it against the real one.
        if public.employee_is_free(p_org_id, v_candidate.slot_employee_id,
                                   v_cursor, v_line.minutes,
                                   p_session_token, p_party_index) then
          v_pick := v_candidate.slot_employee_id;
        else
          v_pick := null;
        end if;
      else
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
