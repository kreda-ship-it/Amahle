-- ============================================================
-- 018 — availability anchored to real appointments
--
-- Migration 016 stepped slots from opening time on a fixed grid:
-- 09:00, 10:15, 11:30, and so on regardless of what was booked. If an
-- appointment ended at 10:28 the grid ignored it, and the salon lost
-- the time between 10:28 and the next grid line.
--
-- This replaces the grid with the rule the salon actually works to:
--
--   the previous appointment ends        10:28
--   plus that service's buffer           10:33
--   rounded up to a tidy 5               10:35   <- offered
--
-- and the day packs itself. Nothing is wasted waiting for a grid line.
--
-- WHY A STEP IS STILL NEEDED
--
-- "After the previous appointment" has no answer on a day with nothing
-- booked. Taken literally it would offer 09:00 and nothing else, and a
-- customer wanting an afternoon slot would be told the day is full.
--
-- So each free stretch gets an anchor AND a rhythm. The anchor is
-- tight against whatever came before; the rhythm spaces out the empty
-- parts. Both are settings:
--
--   slot_rounding_minutes   default 5    10:33 becomes 10:35
--   slot_step_minutes       default 105  an empty day offers
--                                        09:00, 10:45, 12:30, ...
--
-- 105 minutes is the salon's own choice, made 2026-08-18: it nudges
-- customers into a tidy sequence instead of scattering bookings. Its
-- cost is real and worth remembering — on an empty day, someone
-- wanting 09:30 is told no while the stylist sits free. If that starts
-- turning people away, it is one UPDATE to change.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Rounding up to a tidy number of minutes.
--
-- Epoch arithmetic rather than date maths: seconds since 1970 divided
-- by the interval, rounded up, multiplied back. Every real timezone
-- offset is a whole number of minutes divisible by 5, so this lands on
-- wall-clock 5-minute marks everywhere, including the half-hour and
-- three-quarter-hour offsets.
-- ------------------------------------------------------------
create or replace function public.round_up_to_minutes(
  p_ts       timestamptz,
  p_minutes  int
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ts is null or coalesce(p_minutes, 0) <= 0 then p_ts
    else to_timestamp(
           ceil(extract(epoch from p_ts) / (p_minutes * 60.0)) * (p_minutes * 60.0)
         )
  end
$$;

comment on function public.round_up_to_minutes(timestamptz, int) is
  'Round a moment up to the next tidy multiple of minutes. 10:33 with 5 becomes 10:35.';

revoke execute on function public.round_up_to_minutes(timestamptz, int) from public;
grant  execute on function public.round_up_to_minutes(timestamptz, int) to anon, authenticated;


-- ------------------------------------------------------------
-- 2. get_available_slots(), rebuilt around free gaps.
--
-- The shape of the calculation is now:
--
--   working window
--     minus every appointment's reserved span
--     minus every period of time off
--   = a set of free gaps
--
--   for each gap: start at its beginning rounded up, then step
--
-- Postgres does the subtraction itself. A MULTIRANGE is a set of
-- ranges treated as one value, and subtracting one from another gives
-- exactly the free stretches — no loop, no off-by-one, no merging
-- overlapping bookings by hand.
--
-- FITTING INSIDE A GAP. A slot must fit its service AND its buffer
-- inside the gap, because the next appointment starts the moment the
-- gap ends and the exclusion constraint would refuse an overlap. The
-- one exception is the gap that runs to closing time: there the
-- service must finish by close but the buffer may overhang, since
-- cleanup after the last customer harms nobody. Without that
-- exception the last appointment of every day quietly disappears.
-- ------------------------------------------------------------
create or replace function public.get_available_slots(
  p_org_id      uuid,
  p_service_id  uuid,
  p_from_date   date,
  p_to_date     date default null,
  p_employee_id uuid default null
)
returns table (
  slot_starts_at   timestamptz,
  slot_employee_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_timezone   text;
  v_duration   int;
  v_buffer     int;
  v_bookable   boolean;
  v_is_staff   boolean := public.current_profile_id() is not null;
  v_lead_hours int;
  v_horizon    int;
  v_rounding   int;
  v_step       int;
  v_from       date;
  v_to         date;
  v_earliest   timestamptz;
begin
  select o.timezone,
         s.duration_minutes,
         s.is_bookable_online,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60),
         coalesce((o.public_settings ->> 'slot_rounding_minutes')::int, 5),
         coalesce((o.public_settings ->> 'slot_step_minutes')::int, 105)
  into v_timezone, v_duration, v_bookable, v_lead_hours, v_horizon,
       v_rounding, v_step
  from public.organizations o
  join public.services s
    on  s.id     = p_service_id
    and s.org_id = o.id
  where o.id         = p_org_id
    and o.deleted_at is null
    and s.deleted_at is null
    and s.is_active;

  if not found then
    raise exception 'That service is not available.';
  end if;

  if v_duration is null or v_duration <= 0 then
    raise exception
      'Service % has no duration, so its available times cannot be worked out',
      p_service_id;
  end if;

  if not v_is_staff and not v_bookable then
    raise exception 'That service cannot be booked online. Please call the salon.';
  end if;

  if v_step <= 0 then
    raise exception 'slot_step_minutes must be greater than zero';
  end if;

  v_buffer := public.buffer_minutes_for(p_service_id);

  v_earliest := now() + make_interval(hours => v_lead_hours);
  v_from     := greatest(p_from_date, (v_earliest at time zone v_timezone)::date);
  v_to       := least(coalesce(p_to_date, p_from_date),
                      (now() at time zone v_timezone)::date + v_horizon);

  if v_from > v_to then
    return;
  end if;

  return query
  with days as (
    select d::date as day
    from generate_series(v_from, v_to, interval '1 day') as d
  ),

  windows as (
    select wh.id  as window_id,
           wh.employee_id,
           (days.day + wh.start_time) at time zone v_timezone as opens_at,
           (days.day + wh.end_time)   at time zone v_timezone as closes_at
    from days
    join public.employee_working_hours wh
      on  wh.org_id      = p_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from days.day)::int
    join public.employees e
      on  e.id         = wh.employee_id
      and e.org_id     = p_org_id
      and e.deleted_at is null
      and e.is_active
      and e.is_bookable
    join public.employee_services es
      on  es.employee_id = wh.employee_id
      and es.service_id  = p_service_id
      and es.org_id      = p_org_id
      and es.deleted_at  is null
    where p_employee_id is null or wh.employee_id = p_employee_id
  ),

  -- Everything this employee cannot be booked over, in this window.
  -- Appointments contribute their RESERVED span, buffer included, so
  -- this agrees exactly with the exclusion constraint.
  taken as (
    select w.window_id,
           range_agg(busy.span) as spans
    from windows w
    join lateral (
      select tstzrange(a.starts_at, a.blocked_until) as span
      from public.appointments a
      where a.employee_id = w.employee_id
        and a.deleted_at  is null
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.blocked_until)
            && tstzrange(w.opens_at, w.closes_at)

      union all

      select tstzrange(t.starts_at, t.ends_at)
      from public.employee_time_off t
      where t.employee_id = w.employee_id
        and t.deleted_at  is null
        and tstzrange(t.starts_at, t.ends_at)
            && tstzrange(w.opens_at, w.closes_at)
    ) busy on true
    group by w.window_id
  ),

  -- The working window minus everything taken. One subtraction.
  gaps as (
    select w.employee_id,
           w.closes_at,
           g.gap
    from windows w
    left join taken t on t.window_id = w.window_id
    cross join lateral unnest(
      tstzmultirange(tstzrange(w.opens_at, w.closes_at))
        - coalesce(t.spans, tstzmultirange())
    ) as g(gap)
  ),

  candidates as (
    select g.employee_id,
           generate_series(
             public.round_up_to_minutes(lower(g.gap), v_rounding),
             case
               -- The gap runs to closing: the service must finish by
               -- then, the buffer may overhang.
               when upper(g.gap) >= g.closes_at
                 then upper(g.gap) - make_interval(mins => v_duration)
               -- Another appointment starts here: everything must fit.
               else upper(g.gap) - make_interval(mins => v_duration + v_buffer)
             end,
             make_interval(mins => v_step)
           ) as starts_at
    from gaps g
  )

  select c.starts_at, c.employee_id
  from candidates c
  where c.starts_at >= v_earliest
  order by c.starts_at, c.employee_id;
end;
$$;
