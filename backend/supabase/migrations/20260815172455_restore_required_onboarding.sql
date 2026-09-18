-- ============================================================
-- 009 — restore required timezone and currency at onboarding
--
-- A regression fix. Migration 004 deliberately removed the defaults
-- from create_organization(), so that no salon can be onboarded
-- without stating its timezone and currency:
--
--   "An organization onboarded into the wrong timezone books every
--    appointment at the wrong hour, silently, and nobody notices until
--    a customer arrives five hours early. Better to refuse to guess."
--
-- Migrations 007 and 008 both needed to extend the Manager permission
-- list, used CREATE OR REPLACE, and carried the pre-004 signature with
-- them — including `default 'Africa/Johannesburg'` and `default 'ZAR'`.
-- Postgres permits ADDING a default through CREATE OR REPLACE, so the
-- guard was silently undone. From 007 until this migration, onboarding
-- a salon without naming its timezone put it in South African time.
--
-- No organization was created in that window, so nothing needs
-- correcting in the data — only the function.
--
-- Postgres will not let CREATE OR REPLACE *remove* a default, which is
-- why this drops and recreates, exactly as 004 did. DROP also discards
-- the function's grants, so they are reapplied at the bottom.
-- ============================================================

drop function if exists public.create_organization(text,text,text,text,text,text,text);

create function public.create_organization(
  p_name      text,
  p_slug      text,
  p_timezone  text,   -- NO DEFAULT. See the comment below before changing this.
  p_currency  text,   -- NO DEFAULT. See the comment below before changing this.
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

  -- Manager runs the team and the service menu, but not permissions
  -- and not organization settings.
  insert into public.role_permissions (org_id, role_id, permission_id)
  select v_org_id, r.id, p.id
  from public.roles r
  cross join public.permissions p
  where r.org_id = v_org_id
    and r.name = 'manager'
    and p.key in ('employee.manage', 'service.manage', 'employee.record.manage');

  -- Receptionist and Stylist start with nothing from this catalogue.
  -- Their permissions arrive with appointments and customers.

  return v_org_id;
end;
$$;

comment on function public.create_organization(text,text,text,text,text,text,text) is
  'The only way an organization is created. Creates the organization, its four system roles, and their starting permissions. Service role only. DO NOT give p_timezone or p_currency a default — see migrations 004 and 009. A salon onboarded into the wrong timezone books every appointment at the wrong hour and nobody notices until a customer arrives hours early. If you are here to extend the permission list, copy this whole signature; a CREATE OR REPLACE that reinstates the old defaults is how this broke the first time.';

revoke execute on function public.create_organization(text,text,text,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.create_organization(text,text,text,text,text,text,text)
  to service_role;
