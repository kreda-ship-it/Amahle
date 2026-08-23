-- ============================================================
-- 042 — a person's own work, and their own details
--
-- Phase 5 step 9. Two things a stylist could not do, both for the
-- same reason: the permissions are held by ROLE, and "yourself" is
-- not a role.
-- ============================================================


-- ------------------------------------------------------------
-- 1. set_appointment_status() — the one path a status changes by.
--
-- Replaces a direct UPDATE from application code. That update was
-- correct and is now insufficient: appointments_update requires
-- appointment.manage, which a Stylist does not hold and should not
-- — it also permits rescheduling and cancelling anybody's booking.
--
-- The rule this expresses cannot be written as a policy at all.
-- has_permission() answers "may this ROLE do this", and the answer
-- wanted here is "may this PERSON do this, to THIS row". So it is
-- a function, and — the point — it is the ONLY way a status
-- changes, rather than a second way beside the update. A stylist
-- marking her own client done and a receptionist cancelling a
-- booking now travel the same path and are audited identically.
--
-- WHAT A STYLIST MAY SET, and what she may not. The four
-- operational statuses describe what she can see happening in
-- front of her: the customer arrived, is in the chair, is
-- finished, or never came. `cancelled` is not among them — a
-- cancellation has a customer on the other end of it and a
-- conversation behind it, and belongs with the desk.
-- `confirmed` is not either: that is the day-before call round,
-- which is the receptionist's job.
-- ------------------------------------------------------------
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_employee uuid;
  v_mine     boolean;
begin
  select a.org_id, a.employee_id
  into v_org, v_employee
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null;

  if v_org is null then
    raise exception 'That appointment no longer exists.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'That appointment belongs to another salon.';
  end if;

  v_mine := v_employee is not distinct from public.current_employee_id()
            and public.current_employee_id() is not null;

  if public.has_permission('appointment.manage') then
    null;  -- the desk may set any status on any appointment
  elsif v_mine then
    if p_status not in ('checked_in', 'in_progress', 'completed', 'no_show') then
      raise exception
        'You can mark a customer arrived, in the chair, finished or a no-show. Ask the desk for anything else.';
    end if;
  else
    raise exception 'You may only change your own appointments.';
  end if;

  update public.appointments
  set status = p_status
  where id = p_appointment_id;
end;
$$;

comment on function public.set_appointment_status(uuid, text) is
  'The only way an appointment status changes. The desk may set any; an employee may set the four operational ones on their own rows.';

revoke execute on function public.set_appointment_status(uuid, text) from public, anon;
grant  execute on function public.set_appointment_status(uuid, text) to authenticated;


-- ------------------------------------------------------------
-- 2. update_my_employee_details() — your own contact details.
--
-- employee.record.manage governs the roster and is all-or-nothing
-- across the whole team: holding it lets you edit everybody, and
-- not holding it lets you edit nobody, including yourself. So a
-- stylist could not correct her own phone number without an owner
-- doing it for her.
--
-- THE COLUMN LIST IS THE WHOLE SECURITY MODEL HERE, which is why
-- this is a function with four named parameters rather than a
-- policy over the row. `position` is a job title and belongs to
-- whoever decides job titles. `display_order` is the team page's
-- running order. `is_bookable` and `is_active` decide whether
-- somebody appears on the calendar at all — a stylist quietly
-- taking herself off the roster on a Saturday morning is not a
-- feature, and it would be the first thing an argument produced.
--
-- `full_name` is left out too, more arguably: it is how the salon
-- refers to somebody across the customer records, and a rename is
-- the sort of thing the desk should know about.
--
-- Null means "leave it alone" rather than "clear it", so the form
-- can send only what changed. Clearing a field is done by sending
-- an empty string, which is normalised to null on the way in.
-- ------------------------------------------------------------
create or replace function public.update_my_employee_details(
  p_phone      text default null,
  p_email      text default null,
  p_bio        text default null,
  p_photo_path text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid := public.current_employee_id();
begin
  if v_employee is null then
    raise exception 'You do not have an employee record to edit.';
  end if;

  update public.employees e
  set phone      = coalesce(nullif(btrim(p_phone), ''), case when p_phone is null then e.phone end),
      email      = coalesce(nullif(btrim(p_email), ''), case when p_email is null then e.email end),
      bio        = coalesce(nullif(btrim(p_bio), ''), case when p_bio is null then e.bio end),
      photo_path = coalesce(nullif(btrim(p_photo_path), ''),
                            case when p_photo_path is null then e.photo_path end)
  where e.id = v_employee
    and e.org_id = public.current_org_id()
    and e.deleted_at is null;
end;
$$;

comment on function public.update_my_employee_details(text, text, text, text) is
  'Lets somebody edit their own phone, email, bio and photo. Deliberately cannot touch position, display_order, is_bookable or is_active.';

revoke execute on function public.update_my_employee_details(text, text, text, text)
  from public, anon;
grant  execute on function public.update_my_employee_details(text, text, text, text)
  to authenticated;
