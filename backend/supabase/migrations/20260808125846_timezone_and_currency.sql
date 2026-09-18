-- ============================================================
-- 004 — timezone and currency
--
-- Defaults move from South Africa to New York, and become impossible to
-- omit at onboarding.
--
-- 'America/New_York' rather than 'EST' so Postgres handles daylight
-- saving itself. A 2pm appointment stays 2pm across the March and
-- November clock changes; a fixed offset would drift by an hour for
-- half the year.
-- ============================================================

alter table public.organizations
  alter column timezone set default 'America/New_York';

alter table public.organizations
  alter column currency set default 'USD';


-- create_organization() previously defaulted these. An organization
-- onboarded into the wrong timezone books every appointment at the
-- wrong hour, silently, and nobody notices until a customer arrives
-- five hours early. Better to refuse to guess.
--
-- Postgres will not let CREATE OR REPLACE remove a parameter default,
-- so the function is dropped and recreated. The body is unchanged.
drop function if exists public.create_organization(text,text,text,text,text,text,text);

create function public.create_organization(
  p_name      text,
  p_slug      text,
  p_timezone  text,
  p_currency  text,
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
