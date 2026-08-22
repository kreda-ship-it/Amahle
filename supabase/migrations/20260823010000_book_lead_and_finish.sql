-- ============================================================
-- 038 — booking writes the founding and the finishing
--
-- Availability has been able to find these times since 034. Nothing
-- could book one: create_appointment() wrote a single row per service
-- holding one employee for the whole duration, which is the model 033
-- disproved.
--
-- It now writes what actually happens. For each service:
--
--   LEAD    the stylist, for the lead minutes, carrying the price
--   FINISH  assistants covering the rest, carrying zero
--
-- All sharing one visit_id, so the visit still adds up to what the
-- customer was quoted no matter how many people touched their hair.
--
-- THE CALLER SUPPLIES WHO LEADS. IT DOES NOT SUPPLY THE CLOCK.
--
-- A booking form could post times and phases straight from what
-- availability offered, and it must not: a crafted request would then be
-- able to give a stylist five minutes of a six-hour braid, or move the
-- money onto a row nobody charges for. So the times, the phases, the
-- split and the price are all recomputed here from the services and the
-- answers chosen. The request may choose PEOPLE — which is checked — and
-- nothing else.
--
-- The finishers are chosen here too, rather than taken from the offer.
-- Minutes pass between a customer seeing a time and pressing the button,
-- and the assistant who was free then may not be now. Picking at write
-- time is both safer and more likely to succeed.
-- ============================================================

drop function if exists public.create_appointment(
  uuid, uuid[], uuid[], timestamptz, text, text, text, text, text, int, uuid, text, boolean);

create or replace function public.create_appointment(
  p_org_id             uuid,
  p_service_ids        uuid[],
  p_employee_ids       uuid[],
  p_starts_at          timestamptz,
  p_customer_name      text,
  p_customer_phone     text,
  p_customer_email     text default null,
  p_notes              text default null,
  p_session_token      text default null,
  p_party_index        int  default 0,
  p_visit_id           uuid default null,
  p_for_name           text default null,
  p_employee_requested boolean default false,
  p_selection          jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := public.current_profile_id();
  v_source      text;
  v_count       int;
  v_staff_count int;
  v_customer_id uuid;
  v_visit_id    uuid := coalesce(p_visit_id, gen_random_uuid());
  v_staff       uuid[];
  v_line        record;
  v_lead_emp    uuid;
  v_cursor      timestamptz;
  v_lead_len    int;
  v_lead_end    timestamptz;
  v_fin_start   timestamptz;
  v_fin_end     timestamptz;
  v_chunk       int;
  v_pick        uuid;
  v_cutoff      time;
  v_overhang    boolean;
  v_appt        uuid;
  v_last_ord    int;
  v_buffer      int;
  v_blocked     timestamptz;
begin
  v_source := case when v_actor is null then 'online' else 'staff' end;

  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'Choose at least one service.';
  end if;
  if p_employee_ids is null or array_length(p_employee_ids, 1) is null then
    raise exception 'Choose who is doing each service.';
  end if;
  if v_actor is not null and p_org_id is distinct from public.current_org_id() then
    raise exception 'You cannot book into another salon.';
  end if;
  if p_starts_at is null then
    raise exception 'A start time is needed to make a booking.';
  end if;
  if v_source = 'online' and p_starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;

  v_count       := array_length(p_service_ids, 1);
  v_staff_count := array_length(p_employee_ids, 1);

  if v_staff_count = 1 and v_count > 1 then
    select array_agg(p_employee_ids[1]) into v_staff from generate_series(1, v_count);
  elsif v_staff_count = v_count then
    v_staff := p_employee_ids;
  else
    raise exception 'Give one member of staff per service, or one for the whole visit.';
  end if;

  -- Every service must exist, be live, and be bookable by this route.
  if (select count(*) from public.services s
      where s.id = any(p_service_ids) and s.org_id = p_org_id
        and s.deleted_at is null and s.is_active)
     <> (select count(distinct x) from unnest(p_service_ids) x) then
    raise exception 'One of those services is not available.';
  end if;

  if v_source = 'online' and exists (
       select 1 from public.services s
       where s.id = any(p_service_ids) and s.org_id = p_org_id
         and s.deleted_at is null and not s.is_bookable_online) then
    raise exception 'One of those services cannot be booked online. Please call the salon.';
  end if;

  select max(ord) into v_last_ord
  from public.visit_plan(p_org_id, p_service_ids, p_selection);

  v_customer_id := public.find_or_create_customer(
    p_org_id, p_customer_phone, p_customer_name, p_customer_email);

  v_cursor := p_starts_at;

  for v_line in
    select vp.ord, vp.service_id, vp.minutes
    from public.visit_plan(p_org_id, p_service_ids, p_selection) vp
    order by vp.ord
  loop
    v_lead_emp := v_staff[v_line.ord];

    -- How much of it the lead is needed for, and the rule that governs
    -- when a customer may start it.
    select coalesce(l.lead_minutes, v_line.minutes) into v_lead_len
    from public.visit_lines(p_org_id, coalesce(p_selection, '[]'::jsonb)) l
    where l.ord = v_line.ord;

    if v_lead_len is null then
      select coalesce(s.lead_minutes, v_line.minutes) into v_lead_len
      from public.services s where s.id = v_line.service_id;
    end if;

    select s.latest_start_time into v_cutoff
    from public.services s where s.id = v_line.service_id;
    v_overhang := v_cutoff is not null;

    -- The named person must lead this service and be free for it.
    if not exists (
      select 1 from public.employee_services es
      join public.employees e
        on  e.id = es.employee_id and e.deleted_at is null
        and e.is_active and e.is_bookable
      where es.employee_id = v_lead_emp
        and es.service_id  = v_line.service_id
        and es.org_id      = p_org_id
        and es.deleted_at  is null
        and es.role        = 'lead')
    then
      raise exception 'That member of staff does not perform one of those services.';
    end if;

    if v_source = 'online'
       and not public.employee_is_free(p_org_id, v_lead_emp, v_cursor, v_lead_len,
                                       p_session_token, p_party_index, v_cutoff, v_overhang)
    then
      raise exception 'That is not a time we offer. Please choose one of the times shown.';
    end if;

    v_lead_end := v_cursor + make_interval(mins => v_lead_len);
    v_fin_start := v_lead_end;
    v_fin_end   := v_cursor + make_interval(mins => v_line.minutes);

    -- The trailing buffer belongs to the very end of the visit, not
    -- between its parts. The same head does not need the station cleaned
    -- half way through.
    v_buffer := case when v_line.ord = v_last_ord and v_fin_end = v_lead_end
                     then public.buffer_minutes_for(v_line.service_id) else 0 end;
    v_blocked := v_lead_end + make_interval(mins => v_buffer);

    insert into public.appointments
      (org_id, visit_id, customer_id, employee_id, service_id, starts_at, ends_at,
       blocked_until, source, price, notes, created_by, for_name,
       employee_requested, phase)
    select p_org_id, v_visit_id, v_customer_id, v_lead_emp, v_line.service_id,
           v_cursor, v_lead_end, v_blocked, v_source, l.price,
           case when v_line.ord = 1 then nullif(btrim(coalesce(p_notes, '')), '') end,
           v_actor, nullif(btrim(coalesce(p_for_name, '')), ''),
           coalesce(p_employee_requested, false), 'lead'
    from public.visit_lines(p_org_id, coalesce(p_selection, '[]'::jsonb)) l
    where l.ord = v_line.ord
    returning id into v_appt;

    -- No options chosen means no selection to read, so price comes from
    -- the service and the row above wrote nothing. Fall back.
    if v_appt is null then
      insert into public.appointments
        (org_id, visit_id, customer_id, employee_id, service_id, starts_at, ends_at,
         blocked_until, source, notes, created_by, for_name, employee_requested, phase)
      values
        (p_org_id, v_visit_id, v_customer_id, v_lead_emp, v_line.service_id,
         v_cursor, v_lead_end, v_blocked, v_source,
         case when v_line.ord = 1 then nullif(btrim(coalesce(p_notes, '')), '') end,
         v_actor, nullif(btrim(coalesce(p_for_name, '')), ''),
         coalesce(p_employee_requested, false), 'lead')
      returning id into v_appt;
    end if;

    -- What they chose, snapshotted onto the row that carries the price.
    if p_selection is not null then
      insert into public.appointment_options
        (org_id, appointment_id, option_id, group_name, option_name,
         price_delta, duration_delta_minutes)
      select p_org_id, v_appt, o.id, g.name, o.name,
             o.price_delta, o.duration_delta_minutes
      from jsonb_array_elements(p_selection) with ordinality as sel(entry, ord)
      join lateral jsonb_array_elements_text(sel.entry -> 'option_ids') as picked(option_id) on true
      join public.service_options o on o.id = picked.option_id::uuid and o.org_id = p_org_id
      join public.service_option_groups g on g.id = o.group_id
      join public.service_option_group_links lk
        on  lk.group_id = o.group_id
        and lk.service_id = (sel.entry ->> 'service_id')::uuid
        and lk.deleted_at is null
      where sel.ord = v_line.ord;
    end if;

    -- ---- the finishing, covered greedily ----
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
        and public.employee_is_free(p_org_id, es.employee_id, v_fin_start, v_chunk,
                                    p_session_token, p_party_index, null, v_overhang)
      order by e.display_order, e.full_name
      limit 1;

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
          and public.employee_is_free(p_org_id, es.employee_id, v_fin_start, 60,
                                      p_session_token, p_party_index, null, v_overhang)
        order by e.display_order, e.full_name
        limit 1;
      end if;

      if v_pick is null then
        raise exception 'We do not have anyone free to finish that. Please choose another time.';
      end if;

      v_buffer := case when v_line.ord = v_last_ord
                        and v_fin_start + make_interval(mins => v_chunk) = v_fin_end
                       then public.buffer_minutes_for(v_line.service_id) else 0 end;

      insert into public.appointments
        (org_id, visit_id, customer_id, employee_id, service_id, starts_at, ends_at,
         blocked_until, source, price, created_by, for_name, employee_requested, phase)
      values
        (p_org_id, v_visit_id, v_customer_id, v_pick, v_line.service_id,
         v_fin_start, v_fin_start + make_interval(mins => v_chunk),
         v_fin_start + make_interval(mins => v_chunk + v_buffer),
         v_source, 0, v_actor, nullif(btrim(coalesce(p_for_name, '')), ''),
         false, 'finish');

      v_fin_start := v_fin_start + make_interval(mins => v_chunk);
    end loop;

    v_cursor := v_fin_end;
  end loop;

  if p_session_token is not null then
    perform public.release_holds(p_session_token, p_party_index);
  end if;

  return v_visit_id;
end;
$fn$;

comment on function public.create_appointment(
  uuid, uuid[], uuid[], timestamptz, text, text, text, text, text, int, uuid, text, boolean, jsonb) is
  'The one way an appointment is created. Writes a lead row per service and finish rows for whoever completes it. The caller chooses people; the clock, the split and the price are computed here.';

revoke all on function public.create_appointment(
  uuid, uuid[], uuid[], timestamptz, text, text, text, text, text, int, uuid, text, boolean, jsonb)
  from public;

grant execute on function public.create_appointment(
  uuid, uuid[], uuid[], timestamptz, text, text, text, text, text, int, uuid, text, boolean, jsonb)
  to anon, authenticated;
