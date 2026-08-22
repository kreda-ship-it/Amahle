-- ============================================================
-- 034 — times that know a stylist leaves after the founding
--
-- Migration 033 recorded that a braider is needed for 155 minutes of a
-- 450-minute braid. Availability still did not know it, and could not
-- have used it: get_visit_slots() got its candidate times by asking
-- get_available_slots() for the anchor service, which looks for ONE
-- employee free for that service's WHOLE duration. Every candidate was
-- therefore a time when a stylist had seven and a half hours clear —
-- the precise assumption 033 exists to refute.
--
-- So the candidates have to come from somewhere else, and this function
-- generates its own: a step through each day, tested phase by phase.
--
-- WHAT IT NOW CHECKS, per service, in order:
--
--   LEAD    a stylist who performs it, free for the lead minutes
--   FINISH  assistants covering the rest, in a chain if need be
--
-- The chain is why Selam's two answers mattered. "It can pass between
-- them" is normally the expensive case — a search for people whose free
-- time joins up. It is cheap here only because she also said any
-- assistant can finish any style: interchangeable people can be covered
-- GREEDILY, taking whoever is free next, with no backtracking. Had they
-- been specialised this would be the combinatorial problem DECISIONS #32
-- was written to avoid.
--
-- THE COST, STATED PLAINLY. This walks days × steps × phases and asks
-- employee_is_free() at each. It is not a set-based query and it is not
-- free. Call it for the window actually being shown — a day, or a few —
-- rather than a month. The old function is still there for the
-- one-person case and is cheaper.
--
-- The assignment it returns is now an ARRAY of rows rather than one
-- employee per service, because a visit may legitimately involve a
-- stylist and three assistants. It is shaped as what create_appointment
-- will need to write.
-- ============================================================

drop function if exists public.get_visit_slots(
  uuid, uuid[], date, date, uuid, text, int, jsonb);

create or replace function public.get_visit_slots(
  p_org_id        uuid,
  p_service_ids   uuid[],
  p_from_date     date,
  p_to_date       date default null,
  p_employee_id   uuid default null,
  p_session_token text default null,
  p_party_index   int  default null,
  p_selection     jsonb default null,
  p_limit         int  default 200
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
  v_timezone   text;
  v_lead_hours int;
  v_horizon    int;
  v_step       int := 30;
  v_from       date;
  v_to         date;
  v_day        date;
  v_open       time;
  v_close      time;
  v_start      timestamptz;
  v_cursor     timestamptz;
  v_line       record;
  v_lead_len   int;
  v_fin_start  timestamptz;
  v_fin_end    timestamptz;
  v_chunk      int;
  v_pick       uuid;
  v_rows       jsonb;
  v_ok         boolean;
  v_found      int := 0;
  v_lead_emp   uuid;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  select o.timezone,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60)
  into v_timezone, v_lead_hours, v_horizon
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null;

  if not found then
    raise exception 'That salon does not exist.';
  end if;

  -- Nobody leads one of these, so there is nothing to offer.
  if exists (
    select 1
    from public.visit_plan(p_org_id, p_service_ids, p_selection) vp
    where not exists (
      select 1 from public.employee_services es
      join public.employees e
        on  e.id = es.employee_id and e.deleted_at is null
        and e.is_active and e.is_bookable
      where es.service_id = vp.service_id
        and es.org_id     = p_org_id
        and es.deleted_at is null
        and es.role       = 'lead')
  ) then
    return;
  end if;

  v_from := greatest(p_from_date,
                     ((now() + make_interval(hours => v_lead_hours))
                        at time zone v_timezone)::date);
  v_to   := least(coalesce(p_to_date, p_from_date),
                  (now() at time zone v_timezone)::date + v_horizon);

  v_day := v_from;
  while v_day <= v_to and v_found < p_limit loop
    -- The salon's own opening hours for that weekday, taken as the widest
    -- any employee works. An employee's own rota is checked per phase by
    -- employee_is_free(); this only bounds where it is worth looking.
    select min(wh.start_time), max(wh.end_time)
    into v_open, v_close
    from public.employee_working_hours wh
    where wh.org_id = p_org_id
      and wh.deleted_at is null
      and wh.day_of_week = extract(dow from v_day)::int;

    if v_open is not null then
      v_start := (v_day + v_open) at time zone v_timezone;

      while v_start < ((v_day + v_close) at time zone v_timezone)
            and v_found < p_limit loop
        v_cursor := v_start;
        v_rows   := '[]'::jsonb;
        v_ok     := true;
        v_lead_emp := null;

        for v_line in
          select * from public.visit_plan(p_org_id, p_service_ids, p_selection) order by ord
        loop
          -- How much of this service the lead person is needed for.
          select coalesce(l.lead_minutes, v_line.minutes)
          into v_lead_len
          from public.visit_lines(p_org_id, coalesce(p_selection, '[]'::jsonb)) l
          where l.ord = v_line.ord;

          if v_lead_len is null then
            select coalesce(s.lead_minutes, v_line.minutes) into v_lead_len
            from public.services s where s.id = v_line.service_id;
          end if;

          -- ---- the lead phase ----
          select es.employee_id into v_pick
          from public.employee_services es
          join public.employees e
            on  e.id = es.employee_id and e.deleted_at is null
            and e.is_active and e.is_bookable
          where es.service_id = v_line.service_id
            and es.org_id     = p_org_id
            and es.deleted_at is null
            and es.role       = 'lead'
            and (p_employee_id is null or es.employee_id = p_employee_id)
            and public.employee_is_free(p_org_id, es.employee_id, v_cursor,
                                        v_lead_len, p_session_token, p_party_index)
          order by (es.employee_id = v_lead_emp) desc, e.display_order, e.full_name
          limit 1;

          if v_pick is null then
            v_ok := false;
            exit;
          end if;

          v_lead_emp := coalesce(v_lead_emp, v_pick);
          v_rows := v_rows || jsonb_build_array(jsonb_build_object(
            'service_id', v_line.service_id, 'employee_id', v_pick,
            'phase', 'lead', 'starts_at', v_cursor, 'minutes', v_lead_len));

          -- ---- the finish phase, covered greedily ----
          v_fin_start := v_cursor + make_interval(mins => v_lead_len);
          v_fin_end   := v_cursor + make_interval(mins => v_line.minutes);

          while v_fin_start < v_fin_end loop
            v_chunk := (extract(epoch from (v_fin_end - v_fin_start)) / 60)::int;

            select es.employee_id into v_pick
            from public.employee_services es
            join public.employees e
              on  e.id = es.employee_id and e.deleted_at is null
              and e.is_active and e.is_bookable
            where es.service_id = v_line.service_id
              and es.org_id     = p_org_id
              and es.deleted_at is null
              and es.role       = 'assist'
              and public.employee_is_free(p_org_id, es.employee_id, v_fin_start,
                                          v_chunk, p_session_token, p_party_index)
            order by e.display_order, e.full_name
            limit 1;

            -- Nobody free for the whole rest of it, so hand it over: take
            -- an hour from whoever is free and come back round.
            if v_pick is null and v_chunk > 60 then
              v_chunk := 60;
              select es.employee_id into v_pick
              from public.employee_services es
              join public.employees e
                on  e.id = es.employee_id and e.deleted_at is null
                and e.is_active and e.is_bookable
              where es.service_id = v_line.service_id
                and es.org_id     = p_org_id
                and es.deleted_at is null
                and es.role       = 'assist'
                and public.employee_is_free(p_org_id, es.employee_id, v_fin_start,
                                            60, p_session_token, p_party_index)
              order by e.display_order, e.full_name
              limit 1;
            end if;

            if v_pick is null then
              v_ok := false;
              exit;
            end if;

            v_rows := v_rows || jsonb_build_array(jsonb_build_object(
              'service_id', v_line.service_id, 'employee_id', v_pick,
              'phase', 'finish', 'starts_at', v_fin_start, 'minutes', v_chunk));

            v_fin_start := v_fin_start + make_interval(mins => v_chunk);
          end loop;

          if not v_ok then exit; end if;

          v_cursor := v_cursor + make_interval(mins => v_line.minutes);
        end loop;

        if v_ok then
          slot_starts_at   := v_start;
          slot_employee_id := v_lead_emp;
          slot_assignment  := v_rows;
          v_found := v_found + 1;
          return next;
        end if;

        v_start := v_start + make_interval(mins => v_step);
      end loop;
    end if;

    v_day := v_day + 1;
  end loop;
end;
$fn$;

comment on function public.get_visit_slots is
  'When a whole visit can start, with a stylist for the founding and assistants for the rest. Returns every row that would be written. Walks the day rather than querying it in one shot — ask it for the window being shown, not a month.';

revoke all on function public.get_visit_slots(
  uuid, uuid[], date, date, uuid, text, int, jsonb, int) from public;

grant execute on function public.get_visit_slots(
  uuid, uuid[], date, date, uuid, text, int, jsonb, int) to anon, authenticated;
