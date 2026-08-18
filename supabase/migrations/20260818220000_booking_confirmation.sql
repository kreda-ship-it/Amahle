-- ============================================================
-- 020 — get_booking_confirmation()
--
-- A customer who has just booked needs to be able to look at what they
-- booked, refresh the page, and come back to it tomorrow. They have no
-- account and never will (DECISIONS #8), so the appointment's own id is
-- the reference — unguessable, and the only thing they have.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN
--
-- No customer name, phone, email or notes. Nothing about who booked.
--
-- The link will be forwarded — to a partner, into a group chat, pasted
-- somewhere it will outlive the appointment. Everything this function
-- returns is therefore written to be harmless in a stranger's hands:
-- what service, with whom, when, and what it costs. Someone who did not
-- book it learns that an appointment exists, and nothing about the
-- person who made it.
--
-- Returning the customer's name would be friendlier and would put a
-- real person's name and their salon appointment into any chat the link
-- lands in. The page says "your appointment" instead.
-- ============================================================

create or replace function public.get_booking_confirmation(
  p_appointment_id uuid
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
  where a.id       = p_appointment_id
    and a.deleted_at is null
$$;

comment on function public.get_booking_confirmation(uuid) is
  'One appointment, by its id, for the customer who booked it. Returns nothing identifying the customer — the link will be forwarded.';

revoke execute on function public.get_booking_confirmation(uuid) from public;
grant  execute on function public.get_booking_confirmation(uuid) to anon, authenticated;
