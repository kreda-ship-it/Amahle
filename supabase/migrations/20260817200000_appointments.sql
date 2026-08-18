-- ============================================================
-- 014 — appointments
--
-- The table the whole project is for. PROJECT.md: ONE calendar, TWO
-- entry paths. The public booking form and the receptionist writing
-- down a phone call land in the same rows, and the failure that kills
-- the project is not an ugly screen — it is two customers arriving for
-- the same stylist at 2pm.
--
-- So the two things that must never break are enforced by the
-- database, not by whoever remembered to check:
--
--   1. No employee can hold two overlapping appointments. Section 3.
--   2. The times and the price are computed from the service, on every
--      write, whichever path made it. Section 4.
--
-- Direct API writes stay permitted, RLS-guarded, alongside
-- createAppointment(). Decided 2026-08-17. That is a deliberate
-- softening of PROJECT.md's one-path rule, and sections 3 and 4 are
-- what pay for it: the second path cannot produce a double-booking, an
-- appointment that ends before it starts, or a price that drifted from
-- the service. It can only be more typing.
-- ============================================================


-- ------------------------------------------------------------
-- 1. btree_gist, so the exclusion constraint in section 3 can work.
--
-- A gist index handles ranges natively but not plain equality on a
-- uuid. btree_gist teaches it that, which is what lets one constraint
-- say "same employee AND overlapping time".
--
-- A new database dependency, approved deliberately. It was refused for
-- overlapping rota rows in migration 013 — there the problem was
-- cosmetic and availability unions the rows anyway. Here the problem
-- is the one PROJECT.md says decides whether this project survives.
-- ------------------------------------------------------------
create extension if not exists btree_gist with schema extensions;


-- ------------------------------------------------------------
-- 2. current_employee_id() — which employee is logged in.
--
-- current_org_id() answers "which salon", has_permission() answers
-- "may they". Neither answers "which of these appointments are mine",
-- and a stylist seeing only their own schedule needs that.
--
-- Null is a normal answer: an owner or receptionist who performs no
-- services has no employees row, and a null simply fails the
-- employee_id comparison in the select policy. They see appointments
-- through appointment.view_all instead.
--
-- security definer for the same reason as current_org_id() — it reads
-- profiles and employees without tripping their own policies. See
-- DECISIONS #16.
-- ------------------------------------------------------------
create or replace function public.current_employee_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  join public.profiles p
    on  p.id     = e.profile_id
    and p.org_id = e.org_id
  where p.user_id    = (select auth.uid())
    and p.deleted_at is null
    and p.is_active
    and e.deleted_at is null
  limit 1
$$;

comment on function public.current_employee_id() is
  'The employee record of the logged-in user, or null if they perform no services. Used by the appointments select policy.';

revoke execute on function public.current_employee_id() from public;
grant  execute on function public.current_employee_id() to authenticated;


-- ------------------------------------------------------------
-- 3. appointments.
--
-- THREE TIMESTAMPS, NOT TWO, and the third is the one people forget.
--
--   starts_at      when the customer sits down
--   ends_at        when the service is finished — what the customer
--                  is told, and what appears on their confirmation
--   blocked_until  ends_at plus the service's buffer_minutes: when the
--                  stylist is actually free again
--
-- services.buffer_minutes already exists as cleanup time after a
-- service. Without a column for it the calendar cheerfully books the
-- next customer into the cleanup gap, and the stylist runs late all
-- day through no fault of anyone's.
--
-- The exclusion constraint reserves blocked_until, not ends_at.
--
-- price is a SNAPSHOT. The service's price will change; what this
-- customer was quoted must not change with it.
--
-- source is not null and has no default, deliberately. Every caller
-- must say whether this came from the website or from a member of
-- staff. PROJECT.md calls that the real measure of whether this
-- project worked, and a default would quietly invent the answer.
-- ------------------------------------------------------------
create table public.appointments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  customer_id    uuid not null,
  employee_id    uuid not null,
  service_id     uuid not null,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  blocked_until  timestamptz not null,
  status         text not null default 'pending',
  source         text not null,
  price          numeric(10,2) not null,
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  -- All three references carry org_id. DECISIONS #21: RLS says which
  -- rows you may read, not which rows you may point at.
  constraint appointments_customer_same_org
    foreign key (customer_id, org_id) references public.customers (id, org_id),

  constraint appointments_employee_same_org
    foreign key (employee_id, org_id) references public.employees (id, org_id),

  constraint appointments_service_same_org
    foreign key (service_id, org_id) references public.services (id, org_id),

  -- Null when booked online by a customer, and that null is meaningful
  -- rather than missing. A composite key containing a null is not
  -- checked, so it stays legal.
  constraint appointments_created_by_same_org
    foreign key (created_by, org_id) references public.profiles (id, org_id),

  constraint appointments_status_valid
    check (status in ('pending', 'confirmed', 'checked_in', 'in_progress',
                      'completed', 'cancelled', 'no_show', 'late_arrival')),

  constraint appointments_source_valid
    check (source in ('online', 'staff')),

  constraint appointments_end_after_start
    check (ends_at > starts_at),

  -- Buffer may be zero, so this is >= rather than >.
  constraint appointments_blocked_after_end
    check (blocked_until >= ends_at)
);

comment on column public.appointments.ends_at is
  'When the service finishes — what the customer is told. Filled from the service duration if not given.';

comment on column public.appointments.blocked_until is
  'ends_at plus the service buffer: when the stylist is free again. This is what the calendar reserves.';

comment on column public.appointments.price is
  'Snapshot at booking time. The service price may change; what this customer was quoted does not.';

comment on column public.appointments.source is
  'online or staff. No default on purpose — how much booking actually moved online is the measure of whether this project worked.';

comment on column public.appointments.created_by is
  'Which profile made it. Null means a customer booked it themselves online.';

-- Status is text with a check, not a Postgres enum. Adding a value to
-- an enum is a migration that locks the type; adding one here is an
-- edit to a constraint. This list will change.

create index appointments_org_id_idx on public.appointments (org_id);

-- The two questions the calendar actually asks: what is this employee
-- doing, and what is happening on this day.
create index appointments_employee_start_idx
  on public.appointments (employee_id, starts_at)
  where deleted_at is null;

create index appointments_org_start_idx
  on public.appointments (org_id, starts_at)
  where deleted_at is null;

create index appointments_customer_id_idx on public.appointments (customer_id);

create trigger appointments_set_updated_at
  before update on public.appointments
  for each row execute function public.set_updated_at();

alter table public.appointments enable row level security;


-- ------------------------------------------------------------
-- THE CONSTRAINT THIS WHOLE MIGRATION EXISTS FOR.
--
-- No employee may hold two appointments whose reserved time overlaps.
-- Not "should not" — cannot. The website and the receptionist can
-- submit the same 2pm slot in the same instant and Postgres will
-- accept exactly one of them.
--
-- A check in application code cannot do this. Two requests both read
-- "slot is free", both decide to insert, and both are right at the
-- moment they looked.
--
-- tstzrange is half-open by default: [starts_at, blocked_until). An
-- appointment reserving until 15:00 does NOT clash with one starting
-- at 15:00, which is the behaviour a calendar needs.
--
-- The WHERE clause is what lets a cancelled appointment stop holding
-- the slot. A no-show likewise — the customer did not come, someone
-- else may have the time. Soft-deleted rows never block anything.
-- ------------------------------------------------------------
alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    employee_id with =,
    tstzrange(starts_at, blocked_until) with &&
  )
  where (deleted_at is null and status not in ('cancelled', 'no_show'));


-- ------------------------------------------------------------
-- 4. Times and price come from the service, on every write.
--
-- Direct API writes are permitted alongside createAppointment(), so
-- anything the function computes could be skipped by going around it.
-- Putting the computation in a trigger removes that difference: both
-- paths get the same answer because neither one does the arithmetic.
--
-- Same argument as audit_row() in migration 006, and the same reason
-- it is a trigger rather than a convention.
--
-- Each value is only filled when NOT supplied, so an explicit override
-- still works — "this customer's colour always takes an extra hour" is
-- real, and a trigger that overwrote it would be worse than no trigger.
--
-- On reschedule the end moves with the start. Without this, changing
-- starts_at leaves ends_at behind and the appointment silently changes
-- length.
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

  select s.duration_minutes, coalesce(s.buffer_minutes, 0), s.price
  into v_duration, v_buffer, v_price
  from public.services s
  where s.id = new.service_id;

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

comment on function public.appointment_fill_from_service() is
  'Fills ends_at, blocked_until and price from the service when not supplied, and shifts the end when an appointment is rescheduled. Runs on both write paths.';

-- BEFORE, so the values are in place before NOT NULL and the check
-- constraints are tested. Postgres runs BEFORE row triggers ahead of
-- constraint checking, which is what lets these columns be NOT NULL
-- and still be omitted by the caller.
create trigger appointments_fill_from_service
  before insert or update on public.appointments
  for each row execute function public.appointment_fill_from_service();


-- ------------------------------------------------------------
-- 5. The permissions.
--
--   appointment.view_all  see the whole salon's calendar. WITHOUT it,
--                         a stylist still sees their own — that is the
--                         policy in section 8, not a permission.
--   appointment.create    book someone in
--   appointment.manage    reschedule, change status, cancel
--
-- Stylist gets none of them for now, and so sees their own schedule
-- read-only. Marking one's own appointment complete is a real need and
-- arrives with the calendar in Phase 5, where the screens exist to
-- judge it against.
-- ------------------------------------------------------------
insert into public.permissions (key, description, category) values
  ('appointment.view_all',
   'See the whole salon''s calendar, not only your own appointments',
   'Appointments'),
  ('appointment.create',
   'Book an appointment',
   'Appointments'),
  ('appointment.manage',
   'Reschedule, change the status of, or cancel an appointment',
   'Appointments')
on conflict (key) do nothing;


-- ------------------------------------------------------------
-- 6. create_organization(), redefined for the three new keys.
-- Receptionist gets all three — taking phone bookings is the job.
-- ------------------------------------------------------------
create or replace function public.create_organization(
  p_name      text,
  p_slug      text,
  p_timezone  text default 'Africa/Johannesburg',
  p_currency  text default 'ZAR',
  p_phone     text default null,
  p_email     text default null,
  p_address   text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_org_id uuid;
begin
  insert into public.organizations
    (name, slug, timezone, currency, phone, email, address)
  values
    (p_name, p_slug, p_timezone, p_currency, p_phone, p_email, p_address)
  returning id into v_org_id;

  insert into public.roles (org_id, name, display_name, is_system) values
    (v_org_id, 'owner',        'Owner',        true),
    (v_org_id, 'manager',      'Manager',      true),
    (v_org_id, 'receptionist', 'Receptionist', true),
    (v_org_id, 'stylist',      'Stylist',      true);

  -- Owner holds every permission that exists at this moment.
  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'owner';

  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'manager'
    and p.key in ('employee.manage',
                  'service.manage',
                  'employee.record.manage',
                  'customer.view',
                  'customer.manage',
                  'customer.view_sensitive',
                  'customer.view_financial',
                  'appointment.view_all',
                  'appointment.create',
                  'appointment.manage');

  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'receptionist'
    and p.key in ('customer.view',
                  'customer.manage',
                  'customer.view_financial',
                  'appointment.view_all',
                  'appointment.create',
                  'appointment.manage');

  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'stylist'
    and p.key in ('customer.view',
                  'customer.view_sensitive');

  return v_org_id;
end;
$$;


-- ------------------------------------------------------------
-- 7. Kedus predates the three new keys.
-- ------------------------------------------------------------
insert into public.role_permissions (org_id, role_id, permission_id)
select r.org_id, r.id, p.id
from public.roles r
cross join public.permissions p
where r.deleted_at is null
  and r.name in ('owner', 'manager', 'receptionist')
  and p.key in ('appointment.view_all',
                'appointment.create',
                'appointment.manage')
on conflict do nothing;


-- ------------------------------------------------------------
-- 8. Column privileges.
--
-- No anon grants. A customer booking online never touches this table
-- directly — createAppointment() does it for them.
--
-- source and created_by are insertable and NOT updatable. How a
-- booking arrived and who took it are historical facts; a reschedule
-- must not be able to rewrite them.
-- ------------------------------------------------------------
revoke all on public.appointments from anon, authenticated;

grant select on public.appointments to authenticated;

grant insert (org_id, customer_id, employee_id, service_id, starts_at,
              ends_at, blocked_until, status, source, price, notes, created_by)
  on public.appointments to authenticated;

grant update (customer_id, employee_id, service_id, starts_at, ends_at,
              blocked_until, status, price, notes, deleted_at)
  on public.appointments to authenticated;


-- ------------------------------------------------------------
-- 9. Policies.
--
-- The select policy is the one that matters. Two ways to see a row:
-- hold appointment.view_all, or be the employee it belongs to. A
-- stylist needs no permission key to see their own day.
--
-- ROADMAP puts "stylist sees only their own schedule" in Phase 5. It
-- is written here because it is a row-level rule and it belongs with
-- the table — bolting a visibility filter onto a table already in use
-- is the retrofit this project keeps refusing to do.
-- ------------------------------------------------------------

create policy appointments_select
  on public.appointments for select to authenticated
  using (deleted_at is null
         and org_id = public.current_org_id()
         and (public.has_permission('appointment.view_all')
              or employee_id = public.current_employee_id()));

create policy appointments_insert
  on public.appointments for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('appointment.create'));

create policy appointments_update
  on public.appointments for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('appointment.manage'))
  with check (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 10. Audit. Critical — it carries a price, a customer, and the
-- salon's operational record of who was where.
--
-- A cancellation is an update to status, not a soft delete, so it is
-- logged as appointment.updated with the status change in `changes`.
-- The distinction is real: a cancelled appointment is a fact about the
-- business, a deleted one is a mistake being tidied away.
-- ------------------------------------------------------------
create trigger appointments_audit
  after insert or update on public.appointments
  for each row execute function public.audit_row('appointment', 'critical');
