-- ============================================================
-- 021 — several services in one visit
--
-- "Blow dry and trim for her." One customer, one stylist, one sitting,
-- two services — and two appointment rows, because a row is one service
-- performed by one person over one stretch of time, and that stays
-- true. What is new is a way to say the rows belong together.
--
-- NO BUFFER BETWEEN THEM, AND THIS IS THE DETAIL THAT MATTERS.
--
-- buffer_minutes is the time to reset the station between CUSTOMERS.
-- It is not a pause, and the same head does not need cleaning up after
-- halfway through. So a chained visit is duration + duration end to
-- end, with the buffer applied once at the finish:
--
--   45 min blow dry   10:00 - 10:45   blocked until 10:45
--   30 min trim       10:45 - 11:15   blocked until 11:25  (+10 buffer)
--
-- Adding the buffer between them would quietly cost the salon ten
-- minutes on every combined booking, and nobody would ever see the bug
-- — the day would just be emptier than it should be.
-- ============================================================


-- ------------------------------------------------------------
-- 1. visit_id — which rows are one trip to the salon.
--
-- Set on EVERY appointment, including single-service ones. There is no
-- "this one is part of a visit" flag and no special case: a visit of
-- one is still a visit, so the same code path serves both and there is
-- no second path to get wrong.
--
-- Added in four steps rather than one so the backfill is explicit.
-- Adding a column with a volatile default does give every existing row
-- its own value, but that depends on a Postgres subtlety about which
-- defaults trigger a table rewrite, and a migration should not rest on
-- something the reader has to know.
-- ------------------------------------------------------------
alter table public.appointments add column visit_id uuid;

update public.appointments set visit_id = gen_random_uuid() where visit_id is null;

alter table public.appointments alter column visit_id set not null;
alter table public.appointments alter column visit_id set default gen_random_uuid();

comment on column public.appointments.visit_id is
  'Which rows are one trip to the salon. Always set, even for a single service — a visit of one is still a visit. This is the customer''s booking reference.';

create index appointments_visit_id_idx on public.appointments (visit_id);


-- ------------------------------------------------------------
-- 2. The three functions take a list now, so their signatures change.
--
-- Dropped rather than replaced: `create or replace` cannot rename or
-- retype a parameter. The application is the only caller of any of
-- them, so nothing else has to be found and fixed.
-- ------------------------------------------------------------
drop function if exists public.get_available_slots(uuid, uuid, date, date, uuid);
drop function if exists public.create_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text);
drop function if exists public.get_booking_confirmation(uuid);


-- ------------------------------------------------------------
-- 3. Availability for a list of services.
--
-- The visit needs one continuous free stretch long enough for all of
-- them, with one stylist who can perform every one. Decided 2026-08-18:
-- a visit split across two specialists is a phone call, because finding
-- a chain of stylists whose free time joins up is a different and much
-- worse problem than finding one gap.
-- ------------------------------------------------------------
create or replace function public.get_available_slots(
  p_org_id      uuid,
  p_service_ids uuid[],
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
  v_lead_hours int;
  v_horizon    int;
  v_rounding   int;
  v_step       int;
  v_is_staff   boolean := public.current_profile_id() is not null;
  v_wanted     int;
  v_found      int;
  v_unbookable int;
  v_duration   int;
  v_buffer     int;
  v_from       date;
  v_to         date;
  v_earliest   timestamptz;
begin
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  select o.timezone,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60),
         coalesce((o.public_settings ->> 'slot_rounding_minutes')::int, 5),
         coalesce((o.public_settings ->> 'slot_step_minutes')::int, 105)
  into v_timezone, v_lead_hours, v_horizon, v_rounding, v_step
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null;

  if not found then
    raise exception 'That salon does not exist.';
  end if;

  -- Every service must be real, live and active. Counting distinct ids
  -- means a duplicated id is not mistaken for a missing one.
  select count(distinct x) into v_wanted from unnest(p_service_ids) x;

  select count(*), count(*) filter (where not s.is_bookable_online)
  into v_found, v_unbookable
  from public.services s
  where s.id = any(p_service_ids)
    and s.org_id     = p_org_id
    and s.deleted_at is null
    and s.is_active;

  if v_found <> v_wanted then
    raise exception 'One of those services is not available.';
  end if;

  if not v_is_staff and v_unbookable > 0 then
    raise exception 'One of those services cannot be booked online. Please call the salon.';
  end if;

  -- Total time in the chair. `with ordinality` keeps duplicates, so
  -- booking the same service twice counts twice.
  select sum(s.duration_minutes)
  into v_duration
  from unnest(p_service_ids) with ordinality as t(service_id, ord)
  join public.services s on s.id = t.service_id;

  if v_duration is null or v_duration <= 0 then
    raise exception 'Those services have no duration, so their available times cannot be worked out.';
  end if;

  -- Cleanup follows the LAST service only. See the header.
  v_buffer := public.buffer_minutes_for(p_service_ids[array_length(p_service_ids, 1)]);

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

  -- Only stylists who can do ALL of it. A visit is one person.
  qualified as (
    select es.employee_id
    from public.employee_services es
    where es.org_id     = p_org_id
      and es.deleted_at is null
      and es.service_id = any(p_service_ids)
    group by es.employee_id
    having count(distinct es.service_id) = v_wanted
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
    join qualified q on q.employee_id = wh.employee_id
    where p_employee_id is null or wh.employee_id = p_employee_id
  ),

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
               when upper(g.gap) >= g.closes_at
                 then upper(g.gap) - make_interval(mins => v_duration)
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

revoke execute on function public.get_available_slots(uuid, uuid[], date, date, uuid) from public;
grant  execute on function public.get_available_slots(uuid, uuid[], date, date, uuid) to anon, authenticated;


-- ------------------------------------------------------------
-- 4. Creating the visit.
--
-- One row per service, in the order the customer chose them, back to
-- back. All of them or none — a visit that half-books is worse than one
-- that fails, because the customer believes they have an appointment
-- for something nobody is expecting them for.
--
-- Atomicity is free: a function runs inside a single transaction, so
-- the exclusion constraint refusing the second row rolls back the
-- first. Nothing extra is needed to get it, but it is worth saying out
-- loud that it is being relied on.
--
-- RETURNS THE VISIT, NOT THE APPOINTMENT. That is the customer's
-- reference, and it is the same whether they booked one service or
-- three.
-- ------------------------------------------------------------
create or replace function public.create_appointment(
  p_org_id          uuid,
  p_service_ids     uuid[],
  p_employee_id     uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_email  text default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := public.current_profile_id();
  v_source      text;
  v_wanted      int;
  v_found       int;
  v_unbookable  int;
  v_count       int;
  v_customer_id uuid;
  v_visit_id    uuid := gen_random_uuid();
  v_cursor      timestamptz;
  v_ends        timestamptz;
  v_blocked     timestamptz;
  v_service     record;
begin
  v_source := case when v_actor is null then 'online' else 'staff' end;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;

  if v_actor is not null and p_org_id is distinct from public.current_org_id() then
    raise exception 'You cannot book into another salon.';
  end if;

  if p_starts_at is null then
    raise exception 'A start time is needed to make a booking.';
  end if;

  v_count := array_length(p_service_ids, 1);
  select count(distinct x) into v_wanted from unnest(p_service_ids) x;

  select count(*), count(*) filter (where not s.is_bookable_online)
  into v_found, v_unbookable
  from public.services s
  where s.id = any(p_service_ids)
    and s.org_id     = p_org_id
    and s.deleted_at is null
    and s.is_active;

  if v_found <> v_wanted then
    raise exception 'One of those services is not available.';
  end if;

  if v_source = 'online' and v_unbookable > 0 then
    raise exception 'One of those services cannot be booked online. Please call the salon.';
  end if;

  perform 1
  from public.employees e
  where e.id         = p_employee_id
    and e.org_id     = p_org_id
    and e.deleted_at is null
    and e.is_active
    and e.is_bookable;

  if not found then
    raise exception 'That member of staff cannot be booked.';
  end if;

  -- One stylist for the whole visit, so they must do all of it.
  perform 1
  from public.employee_services es
  where es.employee_id = p_employee_id
    and es.org_id      = p_org_id
    and es.deleted_at  is null
    and es.service_id  = any(p_service_ids)
  group by es.employee_id
  having count(distinct es.service_id) = v_wanted;

  if not found then
    raise exception 'That member of staff does not perform all of those services.';
  end if;

  if v_source = 'online' and p_starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;

  v_customer_id := public.find_or_create_customer(
    p_org_id, p_customer_phone, p_customer_name, p_customer_email);

  v_cursor := p_starts_at;

  for v_service in
    select t.ord, t.service_id, s.duration_minutes
    from unnest(p_service_ids) with ordinality as t(service_id, ord)
    join public.services s on s.id = t.service_id
    order by t.ord
  loop
    v_ends := v_cursor + make_interval(mins => v_service.duration_minutes);

    -- Cleanup after the last one only. Everything before it ends
    -- exactly where the next begins, and the exclusion constraint is
    -- happy with that: its ranges are half-open, so touching is not
    -- overlapping.
    v_blocked := case
      when v_service.ord = v_count
        then v_ends + make_interval(mins => public.buffer_minutes_for(v_service.service_id))
      else v_ends
    end;

    insert into public.appointments
      (org_id, visit_id, customer_id, employee_id, service_id,
       starts_at, ends_at, blocked_until, source, notes, created_by)
    values
      (p_org_id, v_visit_id, v_customer_id, p_employee_id, v_service.service_id,
       v_cursor, v_ends, v_blocked, v_source,
       -- The note is about the visit, so it goes on the first row
       -- rather than being repeated onto every one of them.
       case when v_service.ord = 1
            then nullif(btrim(coalesce(p_notes, '')), '')
       end,
       v_actor);

    v_cursor := v_blocked;
  end loop;

  return v_visit_id;
end;
$$;

comment on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text) is
  'The only way an appointment is created. One row per service, back to back, buffer after the last only. Returns the visit id, which is the customer''s reference.';

revoke execute on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text) from public;
grant  execute on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 5. The confirmation, by visit.
--
-- Several rows now, in the order they happen. Still nothing that
-- identifies the customer — see migration 020 for why: the link gets
-- forwarded, so everything it returns is written to be harmless in a
-- stranger's hands.
-- ------------------------------------------------------------
create or replace function public.get_booking_confirmation(
  p_visit_id uuid
)
returns table (
  service_name   text,
  employee_name  text,
  starts_at      timestamptz,
  ends_at        timestamptz,
  price          numeric(10,2),
  status         text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.name,
         e.full_name,
         a.starts_at,
         a.ends_at,
         a.price,
         a.status
  from public.appointments a
  join public.services  s on s.id = a.service_id
  join public.employees e on e.id = a.employee_id
  where a.visit_id   = p_visit_id
    and a.deleted_at is null
  order by a.starts_at
$$;

revoke execute on function public.get_booking_confirmation(uuid) from public;
grant  execute on function public.get_booking_confirmation(uuid) to anon, authenticated;
