-- ============================================================
-- 017 — a salon-wide default gap between appointments
--
-- services.buffer_minutes was `not null default 0`, which made two
-- different situations look identical to the database:
--
--   "this service genuinely needs no cleanup time"
--   "nobody has thought about this service yet"
--
-- The first is a decision. The second is a service added next year by
-- someone who did not know the column existed, and it books customers
-- back to back with no gap. Nobody finds out until a stylist is
-- running twenty minutes late by lunchtime.
--
-- After this migration:
--
--   buffer_minutes = 15    this service takes 15 minutes to clean up
--   buffer_minutes = 0     this service deliberately needs none
--   buffer_minutes = null  use the salon's house rule
--
-- The house rule is default_buffer_minutes in the organization's
-- public_settings, and falls back to 0 if the salon has not set one.
--
-- EXISTING ROWS ARE NOT TOUCHED. seed-kedus.sql set a real value on
-- every service — 10 for a blow dry, 5 for a trim, 15 for a straw
-- curl. Those were choices, invented ones but choices, and rewriting
-- them to null would throw away per-service variation to make a point
-- about defaults.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Let the column say "I don't know".
--
-- The check constraint is untouched and still correct: `null >= 0`
-- evaluates to unknown, and a check constraint passes on unknown. So
-- null is allowed and a negative number still is not.
-- ------------------------------------------------------------
alter table public.services
  alter column buffer_minutes drop not null;

-- Dropping the default is the point of the whole migration. A new
-- service now arrives as null — inherit — rather than as 0, silently
-- claiming it needs no gap.
alter table public.services
  alter column buffer_minutes drop default;

comment on column public.services.buffer_minutes is
  'Cleanup and prep time AFTER this service. Null means use the organization''s default_buffer_minutes. 0 means this service deliberately needs none. Internal — never visible to anon.';


-- ------------------------------------------------------------
-- 2. One place that answers "how long is the gap for this service".
--
-- Both the appointment trigger and the availability calculation need
-- the answer, and they must never disagree — if availability offered a
-- slot computed with one gap and the exclusion constraint reserved a
-- span computed with another, the form would offer times the database
-- then refuses. That bug only appears under load, and only for real
-- customers.
--
-- So the rule lives here and both call it.
-- ------------------------------------------------------------
create or replace function public.buffer_minutes_for(p_service_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
           s.buffer_minutes,
           nullif(o.public_settings ->> 'default_buffer_minutes', '')::int,
           0
         )
  from public.services s
  join public.organizations o on o.id = s.org_id
  where s.id = p_service_id
$$;

comment on function public.buffer_minutes_for(uuid) is
  'The gap after this service: its own buffer_minutes, or the salon default, or none. The only place that rule lives.';

revoke execute on function public.buffer_minutes_for(uuid) from public;
grant  execute on function public.buffer_minutes_for(uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- 3. The appointment trigger, using it.
--
-- Unchanged apart from where the buffer comes from. Re-declared in
-- full because that is how `create or replace function` works.
-- ------------------------------------------------------------
create or replace function public.appointment_fill_from_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_duration int;
  v_buffer   int;
  v_price    numeric(10,2);
  v_shift    interval;
begin
  -- A reschedule: the start moved and the end was not set by hand, so
  -- carry the whole appointment across and keep its length.
  if TG_OP = 'UPDATE'
     and new.starts_at is distinct from old.starts_at
     and new.ends_at   is not distinct from old.ends_at then
    v_shift           := new.starts_at - old.starts_at;
    new.ends_at       := new.ends_at + v_shift;
    new.blocked_until := new.blocked_until + v_shift;
    return new;
  end if;

  select s.duration_minutes, s.price
  into v_duration, v_price
  from public.services s
  where s.id = new.service_id;

  v_buffer := public.buffer_minutes_for(new.service_id);

  if new.ends_at is null then
    if v_duration is null then
      raise exception
        'Service % has no duration_minutes, so the appointment end cannot be computed',
        new.service_id;
    end if;
    new.ends_at := new.starts_at + make_interval(mins => v_duration);
  end if;

  if new.blocked_until is null then
    new.blocked_until := new.ends_at + make_interval(mins => v_buffer);
  end if;

  if new.price is null then
    new.price := v_price;
  end if;

  return new;
end;
$$;


-- ------------------------------------------------------------
-- 4. The availability calculation, using it.
--
-- Also unchanged apart from the buffer. See migration 016 for why it
-- is shaped the way it is — nothing precomputed, service must finish
-- by closing time, buffer may overhang.
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
         s.is_bookable_online,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60)
  into v_timezone, v_duration, v_bookable, v_lead_hours, v_horizon
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

    and not exists (
      select 1
      from public.employee_time_off t
      where t.employee_id = c.employee_id
        and t.deleted_at  is null
        and tstzrange(t.starts_at, t.ends_at)
            && tstzrange(c.starts_at, c.starts_at + make_interval(mins => v_duration))
    )

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
