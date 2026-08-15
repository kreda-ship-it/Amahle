-- ============================================================
-- 008 — employees and employee_services
--
-- Who works here, and which services each of them performs.
--
-- Two things make this migration different from services:
--
--   1. It holds staff PERSONAL data — phone and email — on a table
--      that also feeds a public page. The grant list is the only thing
--      standing between a stylist's mobile number and the internet.
--
--   2. It is the first table to reference another tenant-scoped table,
--      which is where RLS alone stops being enough. See section 1.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Composite keys — closing a hole RLS does not cover.
--
-- RLS decides which rows you may READ. It does not stop you POINTING
-- at a row you cannot read. An insert into employee_services carrying
-- your own org_id but salon B's service_id passes every policy we
-- write: the WITH CHECK only verifies org_id = current_org_id().
--
-- So the foreign keys below reference (id, org_id) rather than (id).
-- A reference that crosses a salon boundary is then rejected by the
-- database itself, not by a policy anyone has to remember to write.
--
-- These unique constraints are what make that possible. They are
-- additive and cannot fail: id is already unique on its own, so
-- (id, org_id) is trivially unique too.
-- ------------------------------------------------------------
alter table public.profiles
  add constraint profiles_id_org_key unique (id, org_id);

alter table public.services
  add constraint services_id_org_key unique (id, org_id);


-- ------------------------------------------------------------
-- 2. employees.
--
-- profile_id is NULLABLE and that is the whole point. An employee is a
-- person who performs services; a profile is a person who can log in.
-- They usually point at each other, but a stylist who never touches the
-- system still has to exist on the calendar, and a receptionist with a
-- login is not necessarily bookable.
--
-- Never collapse these two tables into one.
-- ------------------------------------------------------------
create table public.employees (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  profile_id     uuid,
  full_name      text not null,
  photo_url      text,
  position       text,
  bio            text,
  phone          text,
  email          text,
  is_bookable    boolean not null default true,
  is_active      boolean not null default true,
  display_order  int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  -- An employee's login must belong to the same salon as the employee.
  constraint employees_profile_same_org
    foreign key (profile_id, org_id) references public.profiles (id, org_id),

  -- Lets employee_services reference this table the same way.
  constraint employees_id_org_key unique (id, org_id)
);

comment on column public.employees.profile_id is
  'Their login, if they have one. Null is normal — an employee who never uses the system still appears on the calendar.';

comment on column public.employees.is_bookable is
  'False means they still appear on the public team page, but cannot be chosen when booking. A receptionist is part of the team.';

comment on column public.employees.phone is
  'Staff personal contact. Never granted to anon.';

-- One login belongs to one employee. Live rows only, and only where a
-- login actually exists — several employees may have no profile at all,
-- and those nulls must not collide with each other.
create unique index employees_profile_id_key
  on public.employees (profile_id)
  where deleted_at is null and profile_id is not null;

-- Deliberately no uniqueness on full_name. Two people really can share
-- a name, and telling a salon it may not hire the second one would be
-- absurd.
create index employees_org_id_idx on public.employees (org_id);

create trigger employees_set_updated_at
  before update on public.employees
  for each row execute function public.set_updated_at();

alter table public.employees enable row level security;


-- ------------------------------------------------------------
-- 3. employee_services — which employees perform which services.
--
-- Both foreign keys carry org_id, for the reason in section 1.
-- ------------------------------------------------------------
create table public.employee_services (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id),
  employee_id  uuid not null,
  service_id   uuid not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint employee_services_employee_same_org
    foreign key (employee_id, org_id) references public.employees (id, org_id),

  constraint employee_services_service_same_org
    foreign key (service_id, org_id) references public.services (id, org_id)
);

create unique index employee_services_pair_key
  on public.employee_services (employee_id, service_id)
  where deleted_at is null;

create index employee_services_org_id_idx      on public.employee_services (org_id);
create index employee_services_employee_id_idx on public.employee_services (employee_id);
create index employee_services_service_id_idx  on public.employee_services (service_id);

create trigger employee_services_set_updated_at
  before update on public.employee_services
  for each row execute function public.set_updated_at();

alter table public.employee_services enable row level security;


-- ------------------------------------------------------------
-- 4. The permission.
--
-- employee.manage already exists and guards profiles — the people who
-- can LOG IN. This new key guards the roster: everyone who works here,
-- including the people who never log in. Two distinct jobs, two keys.
-- ------------------------------------------------------------
insert into public.permissions (key, description, category) values
  ('employee.record.manage',
   'Add and edit employees — the team roster, including people who never log in',
   'Team')
on conflict (key) do nothing;

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
    and p.key in ('employee.manage', 'service.manage', 'employee.record.manage');

  return v_org_id;
end;
$$;

-- Kedus predates this permission, so it missed both cross joins above.
insert into public.role_permissions (org_id, role_id, permission_id)
select r.org_id, r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'manager')
  and r.deleted_at is null
  and p.key = 'employee.record.manage'
on conflict do nothing;


-- ------------------------------------------------------------
-- 5. Column privileges.
--
-- The anon list on employees IS the public team page, column by
-- column. What is missing from it is the point:
--
--   phone, email  — staff personal contact details. A stylist's mobile
--                   number is not published because the column is not
--                   granted, which is a guarantee. "Remember not to
--                   select it" is not.
--   profile_id    — reveals who has a login and links to identity.
--   is_active     — the policy filters on it; nobody needs to read it.
--
-- org_id is granted for the same reason as on services: filtering a
-- query by a column requires SELECT privilege on that column, and the
-- public site fetches one salon's team by org_id.
-- ------------------------------------------------------------
revoke all on public.employees from anon, authenticated;

grant select (id, org_id, full_name, photo_url, position, bio,
              is_bookable, display_order)
  on public.employees to anon;

grant select on public.employees to authenticated;

grant insert (org_id, profile_id, full_name, photo_url, position, bio,
              phone, email, is_bookable, is_active, display_order)
  on public.employees to authenticated;

grant update (profile_id, full_name, photo_url, position, bio,
              phone, email, is_bookable, is_active, display_order, deleted_at)
  on public.employees to authenticated;

-- employee_services holds no personal data at all — it is a map of who
-- performs what, which is exactly what a customer is trying to find out.
revoke all on public.employee_services from anon, authenticated;

grant select (id, org_id, employee_id, service_id)
  on public.employee_services to anon;

grant select on public.employee_services to authenticated;

grant insert (org_id, employee_id, service_id)
  on public.employee_services to authenticated;

grant update (deleted_at) on public.employee_services to authenticated;


-- ------------------------------------------------------------
-- 6. Policies.
--
-- Same shape as services, and deliberately so. Consistency across
-- tables is what makes a missing policy obvious.
-- ------------------------------------------------------------

create policy employees_select_anon
  on public.employees for select to anon
  using (deleted_at is null and is_active);

create policy employees_select_member
  on public.employees for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy employees_insert
  on public.employees for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('employee.record.manage'));

create policy employees_update
  on public.employees for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('employee.record.manage'))
  with check (org_id = public.current_org_id());


create policy employee_services_select_anon
  on public.employee_services for select to anon
  using (deleted_at is null);

create policy employee_services_select_member
  on public.employee_services for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy employee_services_insert
  on public.employee_services for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('employee.record.manage'));

create policy employee_services_update
  on public.employee_services for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('employee.record.manage'))
  with check (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 7. Audit.
--
-- employees is 'critical': it holds real people's contact details, and
-- who works here is an identity question, same as profiles.
--
-- employee_services is 'routine': it is a mapping between two rows,
-- carrying no personal data of its own.
-- ------------------------------------------------------------
create trigger employees_audit
  after insert or update on public.employees
  for each row execute function public.audit_row('employee', 'critical');

create trigger employee_services_audit
  after insert or update on public.employee_services
  for each row execute function public.audit_row('employee_service', 'routine');
