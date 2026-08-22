-- ============================================================
-- 037 — the cutoff governs when a CUSTOMER starts, not a shift
--
-- 035 and 036 gave schedule_permits() a service id and had it look up
-- that service's latest_start_time. Wrong shape, and it showed up
-- immediately: knotless braids have a 16:30 cutoff and the latest time
-- offered was 14:00.
--
-- The reason is that a visit has more than one segment, and only the
-- FIRST one is the customer arriving. When an assistant picks the head
-- up at 17:00 to work the length down, that segment was tested against
-- the same 16:30 and refused — a rule about when somebody may book being
-- applied to an internal hand-over.
--
-- The fix is to stop the function looking anything up. A rule read from
-- a row is a rule the caller cannot vary, and the caller is the only one
-- that knows which segment it is asking about. So it is told:
--
--   p_latest_start     the segment may not begin after this, or null
--   p_allow_overhang   the segment may finish after closing
--
-- The lead phase gets both. The finish phase gets overhang and no
-- cutoff, because the customer already started on time and the work has
-- to end somewhere. Everything else keeps the old rule by default.
-- ============================================================

-- Every overload goes. 035 added a second schedule_permits beside the
-- original rather than replacing it, because the signature changed, and
-- the same happened to employee_is_free. Two functions of the same name
-- where one has defaults is a trap: a four-argument call from the write
-- path happens to resolve today because Postgres prefers an exact arity
-- match, and would stop resolving the day somebody adds a third.
drop function if exists public.employee_is_free(uuid, uuid, timestamptz, int, text, int, uuid);
drop function if exists public.employee_is_free(uuid, uuid, timestamptz, int, text, int);
drop function if exists public.schedule_permits(uuid, uuid, timestamptz, int, uuid);
drop function if exists public.schedule_permits(uuid, uuid, timestamptz, int);

create or replace function public.schedule_permits(
  p_org_id         uuid,
  p_employee_id    uuid,
  p_starts_at      timestamptz,
  p_minutes        int,
  p_latest_start   time    default null,
  p_allow_overhang boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_timezone   text;
  v_lead_hours int;
  v_horizon    int;
  v_overhang   int;
  v_day        date;
  v_ends       timestamptz;
begin
  if p_starts_at is null or p_minutes is null or p_minutes <= 0 then
    return false;
  end if;

  select o.timezone,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60),
         o.max_overhang_minutes
  into v_timezone, v_lead_hours, v_horizon, v_overhang
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null;

  if not found then return false; end if;

  if p_starts_at < now() + make_interval(hours => v_lead_hours) then
    return false;
  end if;

  if (p_starts_at at time zone v_timezone)::date
     > (now() at time zone v_timezone)::date + v_horizon then
    return false;
  end if;

  v_day  := (p_starts_at at time zone v_timezone)::date;
  v_ends := p_starts_at + make_interval(mins => p_minutes);

  if not p_allow_overhang then
    -- The old rule, unchanged, and still the default: start and finish
    -- inside ONE window. Several rows for a day is a split shift, and the
    -- space between its halves is a lunch break rather than bookable time.
    perform 1
    from public.employee_working_hours wh
    where wh.employee_id = p_employee_id
      and wh.org_id      = p_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from v_day)::int
      and p_starts_at >= (v_day + wh.start_time) at time zone v_timezone
      and v_ends      <= (v_day + wh.end_time)   at time zone v_timezone;
  else
    perform 1
    from public.employee_working_hours wh
    where wh.employee_id = p_employee_id
      and wh.org_id      = p_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from v_day)::int
      and p_starts_at >= (v_day + wh.start_time) at time zone v_timezone
      and p_starts_at <= (v_day + coalesce(least(wh.end_time, p_latest_start),
                                           wh.end_time)) at time zone v_timezone
      and v_ends      <= ((v_day + wh.end_time) at time zone v_timezone)
                         + make_interval(mins => v_overhang);
  end if;

  if not found then return false; end if;

  perform 1
  from public.employee_time_off t
  where t.employee_id = p_employee_id
    and t.org_id      = p_org_id
    and t.deleted_at  is null
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_starts_at, v_ends);

  return not found;
end;
$fn$;

comment on function public.schedule_permits(uuid, uuid, timestamptz, int, time, boolean) is
  'Would the rota allow this stretch? The caller states the rule — the latest it may begin, and whether it may run past closing — because only the caller knows whether it is a customer arriving or a colleague taking over.';

revoke execute on function public.schedule_permits(
  uuid, uuid, timestamptz, int, time, boolean) from public;


create or replace function public.employee_is_free(
  p_org_id         uuid,
  p_employee_id    uuid,
  p_starts_at      timestamptz,
  p_minutes        int,
  p_session_token  text    default null,
  p_party_index    int     default null,
  p_latest_start   time    default null,
  p_allow_overhang boolean default false
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

  if not public.schedule_permits(p_org_id, p_employee_id, p_starts_at,
                                 p_minutes, p_latest_start, p_allow_overhang) then
    return false;
  end if;

  v_ends := p_starts_at + make_interval(mins => p_minutes);

  perform 1
  from public.appointments a
  where a.employee_id = p_employee_id
    and a.org_id      = p_org_id
    and a.deleted_at  is null
    and a.status not in ('cancelled', 'no_show')
    and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, v_ends);

  if found then return false; end if;

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

revoke execute on function public.employee_is_free(
  uuid, uuid, timestamptz, int, text, int, time, boolean) from public;


-- The searcher, told the rule per segment.
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
  v_cutoff     time;
  v_overhang   boolean;
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

          select s.latest_start_time into v_cutoff
          from public.services s where s.id = v_line.service_id;
          v_overhang := v_cutoff is not null;

          -- ---- the lead phase: the customer arriving ----
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
                                        v_lead_len, p_session_token, p_party_index,
                                        v_cutoff, v_overhang)
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
                                          v_chunk, p_session_token, p_party_index,
                                          null, v_overhang)
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
                                            60, p_session_token, p_party_index,
                                            null, v_overhang)
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
