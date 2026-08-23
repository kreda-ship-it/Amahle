-- ============================================================
-- 041 — reassigning and resizing
--
-- Dragging sideways, and pulling a block's edge. Two operations
-- move_visit() deliberately could not do: it shifts times for a
-- whole visit and never touches employee_id or a duration.
--
-- BOTH ARE PER-APPOINTMENT, NOT PER-VISIT, and that is the
-- difference from migration 039. "Move Sara to three o'clock" is a
-- fact about the whole visit — she arrives later and everything
-- she is having follows her. "Give Sara's braids to Maki" is a
-- fact about one piece of work; the assistant finishing them is
-- not reassigned by it, and neither is her blow dry afterwards.
-- ============================================================


-- ------------------------------------------------------------
-- 1. reassign_appointment() — sideways.
--
-- Takes a start time as well, because the gesture that produces it
-- is a drag: the block lands in a different column AND at a
-- different height, and it must end up where it was dropped.
--
-- THE NEW PERSON MUST ACTUALLY DO THE WORK, in the right capacity.
-- create_appointment() insists a lead holds an employee_services
-- row at role = 'lead'; this insists on the same for a lead row
-- and on 'assist' for a finishing one. Without it the receptionist
-- could hand a six-hour knotless braid to somebody who has never
-- braided, and nothing anywhere would object.
--
-- WHAT IT DOES NOT CHECK. Not the rota, not opening hours — staff
-- are stopped only by the clash, per DECISIONS #30. And not
-- employee_requested: a customer who asked for Hanna by name can
-- be moved off her, because sometimes Hanna is ill. The star is a
-- prompt to ask the customer first, which is a conversation, not a
-- constraint. See DECISIONS #32.
-- ------------------------------------------------------------
create or replace function public.reassign_appointment(
  p_appointment_id uuid,
  p_employee_id    uuid,
  p_starts_at      timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_service uuid;
  v_phase   text;
  v_length  interval;
  v_buffer  int;
  v_gap     interval;
begin
  if not public.has_permission('appointment.manage') then
    raise exception 'You may not move appointments.';
  end if;

  select a.org_id, a.service_id, a.phase,
         a.ends_at - a.starts_at,
         a.blocked_until - a.ends_at
  into v_org, v_service, v_phase, v_length, v_gap
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null;

  if v_org is null then
    raise exception 'That appointment no longer exists.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'That appointment belongs to another salon.';
  end if;

  if not exists (
    select 1
    from public.employee_services es
    join public.employees e
      on  e.id = es.employee_id and e.deleted_at is null
      and e.is_active and e.is_bookable
    where es.employee_id = p_employee_id
      and es.service_id  = v_service
      and es.org_id      = v_org
      and es.deleted_at  is null
      and es.role        = case when v_phase = 'finish' then 'assist' else 'lead' end)
  then
    raise exception 'That member of staff does not do that service.';
  end if;

  -- The length and the cleanup gap are facts about the work, so
  -- they travel with it rather than being recomputed.
  update public.appointments
  set employee_id   = p_employee_id,
      starts_at     = p_starts_at,
      ends_at       = p_starts_at + v_length,
      blocked_until = p_starts_at + v_length + v_gap
  where id = p_appointment_id;
end;
$$;

comment on function public.reassign_appointment(uuid, uuid, timestamptz) is
  'Gives one appointment to a different person, at a new time. Per-appointment, unlike move_visit(). Refuses somebody who does not perform that service in that capacity.';

revoke execute on function public.reassign_appointment(uuid, uuid, timestamptz) from public, anon;
grant  execute on function public.reassign_appointment(uuid, uuid, timestamptz) to authenticated;


-- ------------------------------------------------------------
-- 2. resize_appointment() — pulling an edge.
--
-- The receptionist knows this customer's colour always runs long.
-- appointment_fill_from_service() was written to allow exactly
-- that: it only computes ends_at when the caller left it null, so
-- an explicit length is honoured rather than overwritten. That was
-- deliberate in migration 014 and this is what it was for.
--
-- WHAT FOLLOWS IT MOVES TOO. A braid is a founding and then a
-- finishing that starts where the founding ends. Stretch the
-- founding by half an hour and leave the finishing alone, and an
-- assistant is booked to work on hair the stylist has not released
-- yet — the same fault dragging a lead row would cause, which is
-- why move_visit() takes the whole visit. Later rows in the visit
-- shift by the same interval, so the chain stays joined.
--
-- The buffer is recomputed from the service rather than carried,
-- because it is a property of the service and not of this booking.
-- ------------------------------------------------------------
create or replace function public.resize_appointment(
  p_appointment_id uuid,
  p_ends_at        timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_visit   uuid;
  v_service uuid;
  v_start   timestamptz;
  v_was_end timestamptz;
  v_shift   interval;
  v_buffer  int;
begin
  if not public.has_permission('appointment.manage') then
    raise exception 'You may not change an appointment.';
  end if;

  select a.org_id, a.visit_id, a.service_id, a.starts_at, a.ends_at
  into v_org, v_visit, v_service, v_start, v_was_end
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null;

  if v_org is null then
    raise exception 'That appointment no longer exists.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'That appointment belongs to another salon.';
  end if;

  if p_ends_at <= v_start then
    raise exception 'An appointment has to finish after it starts.';
  end if;

  v_shift  := p_ends_at - v_was_end;
  v_buffer := public.buffer_minutes_for(v_service);

  -- Deferred for the same reason move_visit() defers: the rows
  -- after this one are shifted in the same breath, and one at a
  -- time they overlap on the way past.
  set constraints public.appointments_no_double_booking deferred;

  update public.appointments
  set ends_at       = p_ends_at,
      blocked_until = p_ends_at + make_interval(mins => v_buffer)
  where id = p_appointment_id;

  -- Everything later in the same visit follows, so a founding and
  -- its finishing stay joined.
  update public.appointments a
  set starts_at     = a.starts_at + v_shift,
      ends_at       = a.ends_at + v_shift,
      blocked_until = a.blocked_until + v_shift
  where a.visit_id = v_visit
    and a.deleted_at is null
    and a.id <> p_appointment_id
    and a.starts_at >= v_was_end;
end;
$$;

comment on function public.resize_appointment(uuid, timestamptz) is
  'Changes how long one appointment takes, shifting whatever follows it in the same visit. The explicit length appointment_fill_from_service() was written to allow.';

revoke execute on function public.resize_appointment(uuid, timestamptz) from public, anon;
grant  execute on function public.resize_appointment(uuid, timestamptz) to authenticated;
