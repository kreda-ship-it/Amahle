-- ============================================================
-- 016 — get_available_slots()
--
-- The times a customer may choose from. One function, computed live.
--
-- NOTHING IS PRECOMPUTED. There is no table of slots, no nightly job,
-- no cache. Availability is derived from the rota, time off and the
-- appointments already booked, at the moment someone asks. Change a
-- working-hours row at 2pm and the 2:01pm booking form reflects it.
--
-- The alternative — materialising slots into a table — means every
-- rota edit, cancellation and booking has to remember to update it,
-- and the day one of them forgets is the day the salon double-books a
-- customer and stops trusting the software.
--
-- CUSTOMERS ONLY. Staff do not call this. A receptionist squeezing
-- someone in at 6:15 on a day that closes at 6 is a real thing that
-- must keep working — the salon owns its own calendar and may overrule
-- its own opening hours. Staff are protected by the exclusion
-- constraint from migration 014, which stops a double-booking, and by
-- nothing else. That is the difference between a customer and the
-- person who runs the diary, and it is deliberate.
-- ============================================================


-- ------------------------------------------------------------
-- get_available_slots()
--
-- Returns (slot_starts_at, slot_employee_id) — the employee is in the
-- result because p_employee_id may be null, meaning "anyone who can do
-- this". The form shows the times; the row remembers who each one
-- belongs to so the booking can name them.
--
-- THE SERVICE MUST FINISH BY CLOSING TIME. THE BUFFER MAY RUN PAST.
-- A one-hour cut at 4pm is offered on a day that shuts at 5, even
-- though cleanup runs to 5:15. Requiring the buffer to fit inside the
-- working day too would silently delete the last appointment of every
-- day, which is not what a buffer is for.
--
-- SLOTS STEP BY duration + buffer. Back to back, no wasted gaps. The
-- gap between one customer and the next is services.buffer_minutes —
-- salon data, editable by anyone with service.manage, different per
-- service if braiding needs longer than a fringe trim.
--
-- TIMEZONE IS THE WHOLE RISK HERE. Working hours are stored as `time`
-- — "Tuesday 09:00" — which is a fact about the salon's clock, not a
-- moment. `(day + start_time) AT TIME ZONE tz` is what turns one into
-- the other, and it is correct across a daylight saving change in a
-- way that adding seven hours to something never is. This is why
-- migration 013 stored the rota as `time` in the first place.
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
  v_from       date;
  v_to         date;
  v_earliest   timestamptz;
begin
  select o.timezone,
         s.duration_minutes,
         coalesce(s.buffer_minutes, 0),
         s.is_bookable_online,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60)
  into v_timezone, v_duration, v_buffer, v_bookable, v_lead_hours, v_horizon
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

  -- Same rule as create_appointment(): a service the salon does not
  -- take online has no online times. DECISIONS #23 — the flag governs
  -- the Book button, and a hidden button is not a rule.
  if not v_is_staff and not v_bookable then
    raise exception 'That service cannot be booked online. Please call the salon.';
  end if;

  -- Nothing sooner than the salon's notice period, and nothing further
  -- out than its horizon. Both clamp rather than error: a form asking
  -- for a date beyond the horizon should get an empty day, not a
  -- crash.
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

  -- Every stretch of working time in range, for every employee who can
  -- perform this service and can be booked at all.
  windows as (
    select wh.employee_id,
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

  -- Step across each window. The last start is the latest one whose
  -- SERVICE still finishes by closing time — the buffer may overhang.
  candidates as (
    select w.employee_id,
           generate_series(
             w.opens_at,
             w.closes_at - make_interval(mins => v_duration),
             make_interval(mins => v_duration + v_buffer)
           ) as starts_at
    from windows w
  )

  select c.starts_at, c.employee_id
  from candidates c
  where c.starts_at >= v_earliest

    -- Away. Compared against the service itself: cleanup time running
    -- into someone's holiday harms nobody.
    and not exists (
      select 1
      from public.employee_time_off t
      where t.employee_id = c.employee_id
        and t.deleted_at  is null
        and tstzrange(t.starts_at, t.ends_at)
            && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_duration))
    )

    -- Already booked. Compared against the RESERVED span, buffer
    -- included, so that this matches the exclusion constraint exactly.
    -- If these two disagreed, the form would offer a time and the
    -- database would then refuse it.
    and not exists (
      select 1
      from public.appointments a
      where a.employee_id = c.employee_id
        and a.deleted_at  is null
        and a.status not in ('cancelled', 'no_show')
        and tstzrange(a.starts_at, a.blocked_until)
            && tstzrange(c.starts_at,
                         c.starts_at + make_interval(mins => v_duration + v_buffer))
    )

  order by c.starts_at, c.employee_id;
end;
$$;

comment on function public.get_available_slots(uuid, uuid, date, date, uuid) is
  'Free times a customer may book, computed live from the rota, time off and existing appointments. Staff do not use this — they may overrule opening hours.';

revoke execute on function public.get_available_slots(uuid, uuid, date, date, uuid)
  from public;

grant execute on function public.get_available_slots(uuid, uuid, date, date, uuid)
  to anon, authenticated;
