-- ============================================================
-- 023 — availability and booking respect holds
--
-- Migration 022 built the holds. This is the half that makes them mean
-- something: a held slot stops being offered, and a booking cannot be
-- made on top of somebody else's hold.
--
-- Both functions take a session token, and the rule is the same in
-- each: a hold blocks everyone EXCEPT the session that made it. A
-- customer who has just picked 10:45 must still see 10:45 when the page
-- reloads, or the hold would hide the very slot it is protecting.
--
-- `is distinct from` rather than `<>` does that in one line, and it
-- gets the null case right by accident of being correct: a caller with
-- no token — a crawler, a first visit — is distinct from every token,
-- so every live hold counts as busy for them.
-- ============================================================

drop function if exists public.get_available_slots(uuid, uuid[], date, date, uuid);
drop function if exists public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text);


create or replace function public.get_available_slots(
  p_org_id        uuid,
  p_service_ids   uuid[],
  p_from_date     date,
  p_to_date       date default null,
  p_employee_id   uuid default null,
  p_session_token text default null
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

  select sum(s.duration_minutes)
  into v_duration
  from unnest(p_service_ids) with ordinality as t(service_id, ord)
  join public.services s on s.id = t.service_id;

  if v_duration is null or v_duration <= 0 then
    raise exception 'Those services have no duration, so their available times cannot be worked out.';
  end if;

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

      union all

      -- Somebody else is part-way through booking this. Their own
      -- session is excluded, so they keep seeing the slot they chose.
      -- Expiry is a filter rather than a cleanup because this function
      -- is STABLE and may not write; hold_slot() does the releasing.
      select tstzrange(h.starts_at, h.blocked_until)
      from public.appointment_holds h
      where h.employee_id   = w.employee_id
        and h.released_at   is null
        and h.expires_at    > now()
        and h.session_token is distinct from p_session_token
        and tstzrange(h.starts_at, h.blocked_until)
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

revoke execute on function public.get_available_slots(uuid, uuid[], date, date, uuid, text) from public;
grant  execute on function public.get_available_slots(uuid, uuid[], date, date, uuid, text) to anon, authenticated;


create or replace function public.create_appointment(
  p_org_id          uuid,
  p_service_ids     uuid[],
  p_employee_id     uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_email  text default null,
  p_notes           text default null,
  p_session_token   text default null
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
  v_duration    int;
  v_visit_end   timestamptz;
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

  select sum(s.duration_minutes)
  into v_duration
  from unnest(p_service_ids) with ordinality as t(service_id, ord)
  join public.services s on s.id = t.service_id;

  v_visit_end := p_starts_at
    + make_interval(mins => v_duration)
    + make_interval(mins => public.buffer_minutes_for(p_service_ids[v_count]));

  -- Somebody else is part-way through booking this time. The exclusion
  -- constraint would not catch it — a hold is not an appointment — so
  -- the promise a hold makes has to be kept here, deliberately.
  perform 1
  from public.appointment_holds h
  where h.employee_id   = p_employee_id
    and h.released_at   is null
    and h.expires_at    > now()
    and h.session_token is distinct from p_session_token
    and tstzrange(h.starts_at, h.blocked_until)
        && tstzrange(p_starts_at, v_visit_end);

  if found then
    raise exception 'Someone else is booking that time right now. Please choose another.';
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
       case when v_service.ord = 1
            then nullif(btrim(coalesce(p_notes, '')), '')
       end,
       v_actor);

    v_cursor := v_blocked;
  end loop;

  -- The hold has done its job. Releasing it here rather than letting it
  -- lapse matters: the customer may book again straight away, and their
  -- own stale hold would sit in front of the next slot they want.
  if p_session_token is not null then
    perform public.release_holds(p_session_token);
  end if;

  return v_visit_id;
end;
$$;

comment on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text, text) is
  'The only way an appointment is created. One row per service, back to back. Respects other sessions'' holds and releases its own. Returns the visit id.';

revoke execute on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text, text) from public;
grant  execute on function public.create_appointment(uuid, uuid[], uuid, timestamptz, text, text, text, text, text) to anon, authenticated;
