-- ============================================================
-- 003 — permissions catalogue and organization onboarding
--
-- Two kinds of data are deliberately kept apart:
--
--   Product data  — the permissions catalogue. Identical in every
--                   deployment, so it belongs in a migration.
--   Tenant data   — an organization's own row. Salon #7 should not
--                   replay salon #1's details, so no organization is
--                   ever created by a migration. They come through
--                   create_organization() instead.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The permissions catalogue.
--
-- Only the keys that mean something today. It grows one entry at a time
-- as features ship — the appointment and customer keys arrive in the
-- migrations that create those tables.
--
-- ON CONFLICT makes this safe to re-run.
-- ------------------------------------------------------------
insert into public.permissions (key, description, category) values
  ('organization.edit', 'Edit the organization''s details and branding',           'Organization'),
  ('role.manage',       'Create and edit roles, and change what each role can do', 'Permissions'),
  ('employee.manage',   'Add and edit the people who can log in',                  'Team')
on conflict (key) do nothing;


-- ------------------------------------------------------------
-- 2. create_organization() — the canonical creation path.
--
-- The only way an organization comes into existence. Same rule as
-- createAppointment(): one path, so there is no second way to make a
-- thing slightly differently.
--
-- Callable by service_role only. There is no RLS insert policy on
-- organizations, and there should never be one — a logged-in user must
-- not be able to conjure a new organization.
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

  -- Four system roles. `name` is the stable key code may rely on;
  -- `display_name` is what a person reads. is_system = true means the
  -- roles_update policy refuses to let anyone rename or remove them.
  insert into public.roles (org_id, name, display_name, is_system) values
    (v_org_id, 'owner',        'Owner',        true),
    (v_org_id, 'manager',      'Manager',      true),
    (v_org_id, 'receptionist', 'Receptionist', true),
    (v_org_id, 'stylist',      'Stylist',      true);

  -- Owner holds every permission that exists at the moment this
  -- organization is created — not every permission that will ever
  -- exist. A future migration adding a permission must decide who gets
  -- it, so nobody silently gains access while they weren't looking.
  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'owner';

  -- Manager runs the team, but not permissions and not org settings.
  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'manager'
    and p.key in ('employee.manage');

  -- Receptionist and Stylist start with nothing from this catalogue.
  -- Their permissions arrive with appointments and customers.

  return v_org_id;
end;
$$;

comment on function public.create_organization(text,text,text,text,text,text,text) is
  'The only way an organization is created. Creates the organization, its four system roles, and their starting permissions. Service role only.';

revoke execute on function public.create_organization(text,text,text,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.create_organization(text,text,text,text,text,text,text)
  to service_role;
