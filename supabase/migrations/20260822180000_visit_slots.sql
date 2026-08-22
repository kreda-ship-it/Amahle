-- ============================================================
-- 030 — times for a visit that two different people perform
--
-- DECISIONS #32. get_available_slots() looks for ONE employee free for
-- the whole visit, and only offers employees who perform every service
-- in it. The salon's washers are not stylists, so "a wash, then braids"
-- — its most ordinary booking — matches nobody and returns nothing.
--
-- THE SHAPE OF THE SEARCH, AND WHY IT IS NOT A CHAIN SEARCH.
--
-- Looking for a washer free at 10:00 AND a braider free at 10:45 for
-- six hours is combinatorial, and that is what the old decision was
-- avoiding. It is avoidable because the two resources are not equal.
-- Six hours of a braider is the constraint. Forty-five minutes of a
-- washer is not — there are more of them and they are interchangeable.
--
-- So: find the times for the SCARCE service using the machinery that
-- already exists, then walk the rest of the visit around each one and
-- ask whether anybody free can do it. The expensive search runs once,
-- over the resource that actually limits the day.
--
-- Scarce means fewest people who perform it, and the longest of those
-- if two are equally rare.
--
-- This is layering rather than a second path. get_available_slots()
-- remains what it always was — the times one employee has free for one
-- stretch — and is now called by the thing above it instead of being
-- asked a question it was never shaped to answer.
--
-- The computed duration from migration 029 is used throughout, so a
-- waist-length boho knotless braid looks for the eight hours it takes
-- rather than the six its base row says.
-- ============================================================


-- ------------------------------------------------------------
-- 1. employee_is_free() — the whole question, not a third of it.
--
-- schedule_permits() answers "would the rota allow this", which is
-- working hours, time off, lead time and horizon. It says nothing about
-- whether somebody is already booked, because the write path relies on
-- the exclusion constraint for that and never had to ask.
--
-- A search does have to ask, so this adds the two the rota does not
-- cover: an appointment already there, and somebody else's live hold.
--
-- NO GRANT, for the same reason schedule_permits has none. Handed to
-- anon it is a way to map the staff rota one yes-or-no at a time, which
-- is what migration 013 revoked those tables to prevent. It is reached
-- only through the security definer function below.
-- ------------------------------------------------------------
create or replace function public.employee_is_free(
  p_org_id        uuid,
  p_employee_id   uuid,
  p_starts_at     timestamptz,
  p_minutes       int,
  p_session_token text default null,
  p_party_index   int  default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_ends timestamptz;
begin
  if p_employee_id is null or p_minutes is null or p_minutes <= 0 then
    return false;
  end if;

  if not public.schedule_permits(p_org_id, p_employee_id, p_starts_at, p_minutes) then
    return false;
  end if;

  v_ends := p_starts_at + make_interval(mins => p_minutes);

  -- Already booked. blocked_until rather than ends_at, so the cleanup
  -- time after the previous customer is respected.
  perform 1
  from public.appointments a
  where a.employee_id = p_employee_id
    and a.org_id      = p_org_id
    and a.deleted_at  is null
    and a.status not in ('cancelled', 'no_show')
    and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, v_ends);

  if found then
    return false;
  end if;

  -- Held by somebody else who is part-way through booking. This
  -- party's own hold does not count against it, which is what the
  -- session token and party index are for.
  perform 1
  from public.appointment_holds h
  where h.employee_id = p_employee_id
    and h.released_at is null
    and h.expires_at  > now()
    and not (
      h.session_token is not distinct from p_session_token
      and h.party_index is not distinct from p_party_index
    )
    and tstzrange(h.starts_at, h.blocked_until) && tstzrange(p_starts_at, v_ends);

  return not found;
end;
$fn$;

comment on function public.employee_is_free is
  'Is this person actually free for this stretch — rota, time off, existing appointments and other people''s holds. schedule_permits() answers only the first two.';

revoke execute on function public.employee_is_free(uuid, uuid, timestamptz, int, text, int) from public;


-- ------------------------------------------------------------
-- 2. get_visit_slots() — the times a whole visit can start.
--
-- Returns the visit's START, the person doing the scarce service, and
-- an assignment naming who does what. The assignment matters: without
-- it the caller knows a washer exists but not which one, and would have
-- to find one again at booking time, by which point it may be somebody
-- else.
--
--   slot_assignment = {"<service_id>": "<employee_id>", …}
-- ------------------------------------------------------------
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
  v_lines         record;
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

  -- The visit as a list: position, service, and how many minutes it
  -- takes once the customer's answers are counted. visit_lines() when
  -- there are answers, the plain durations when there are not.
  create temporary table if not exists _visit_plan (
    ord        int,
    service_id uuid,
    minutes    int,
    qualified  int
  ) on commit drop;
  delete from _visit_plan;

  if p_selection is not null and jsonb_array_length(p_selection) > 0 then
    insert into _visit_plan (ord, service_id, minutes)
    select l.ord, l.service_id, l.duration_minutes
    from public.visit_lines(p_org_id, p_selection) l;
  else
    insert into _visit_plan (ord, service_id, minutes)
    select t.ord::int, t.service_id, s.duration_minutes
    from unnest(p_service_ids) with ordinality as t(service_id, ord)
    join public.services s
      on  s.id         = t.service_id
      and s.org_id     = p_org_id
      and s.deleted_at is null;
  end if;

  -- How many people can perform each one. This is what "scarce" means.
  update _visit_plan p
  set qualified = (
    select count(*)
    from public.employee_services es
    join public.employees e
      on  e.id         = es.employee_id
      and e.deleted_at is null
      and e.is_active
      and e.is_bookable
    where es.service_id = p.service_id
      and es.org_id     = p_org_id
      and es.deleted_at is null
  );

  if exists (select 1 from _visit_plan where qualified = 0) then
    return;  -- nobody performs one of these; there are no times to offer
  end if;

  select ord, service_id into v_anchor_ord, v_anchor_id
  from _visit_plan
  order by qualified asc, minutes desc, ord asc
  limit 1;

  select coalesce(sum(minutes), 0) into v_offset_before
  from _visit_plan where ord < v_anchor_ord;

  -- The expensive search, run once, over the resource that limits the
  -- day. p_employee_id filters the ANCHOR — "I want Hanna" means Hanna
  -- does the braids, not that she also washes.
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

    for v_lines in select * from _visit_plan order by ord loop
      if v_lines.ord = v_anchor_ord then
        v_pick := v_candidate.slot_employee_id;
      else
        -- The anchor's own employee first when they can do it too: one
        -- pair of hands for the whole visit is simpler for the customer
        -- and cheaper for the salon than pulling in a second person.
        if public.employee_is_free(p_org_id, v_candidate.slot_employee_id,
                                   v_cursor, v_lines.minutes,
                                   p_session_token, p_party_index)
           and exists (
             select 1 from public.employee_services es
             where es.employee_id = v_candidate.slot_employee_id
               and es.service_id  = v_lines.service_id
               and es.org_id      = p_org_id
               and es.deleted_at  is null)
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
          where es.service_id = v_lines.service_id
            and es.org_id     = p_org_id
            and es.deleted_at is null
            and public.employee_is_free(p_org_id, es.employee_id, v_cursor,
                                        v_lines.minutes, p_session_token, p_party_index)
          order by e.display_order, e.full_name
          limit 1;
        end if;
      end if;

      if v_pick is null then
        v_ok := false;
        exit;
      end if;

      v_assign := v_assign || jsonb_build_object(v_lines.service_id::text, v_pick::text);
      v_cursor := v_cursor + make_interval(mins => v_lines.minutes);
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

comment on function public.get_visit_slots is
  'When a whole visit can start, allowing a different person per service. Anchors on the scarce service and fits the rest around it — see DECISIONS #32.';

revoke all on function public.get_visit_slots(
  uuid, uuid[], date, date, uuid, text, int, jsonb) from public;

grant execute on function public.get_visit_slots(
  uuid, uuid[], date, date, uuid, text, int, jsonb) to anon, authenticated;
