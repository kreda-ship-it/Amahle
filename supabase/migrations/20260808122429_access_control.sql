-- ============================================================
-- 002 — access control
--
-- After this migration the DATABASE decides who sees and changes what.
-- The application only asks; it never grants.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Split settings into public and private halves.
--
-- organizations rows are readable by logged-out visitors, because the
-- public website needs the salon's name and branding before anyone has
-- logged in. That makes every column on this table a potential leak.
-- Safe to rename here: the column is empty.
-- ------------------------------------------------------------
alter table public.organizations
  rename column settings to public_settings;

alter table public.organizations
  add column private_settings jsonb not null default '{}'::jsonb;

comment on column public.organizations.public_settings is
  'Branding and public site config. Visible to anyone on the internet. Never put secrets here.';

comment on column public.organizations.private_settings is
  'Internal configuration. Visible only to members of this organization.';


-- ------------------------------------------------------------
-- 2. Helper functions.
--
-- Both are SECURITY DEFINER: they run with their creator's privileges,
-- so they may read profiles without triggering profiles' own RLS policy.
-- That is what breaks the infinite recursion.
--
-- Both are STABLE, so Postgres evaluates them once per statement rather
-- than once per row.
--
-- `set search_path = ''` forces every name inside to be fully qualified.
-- Without it, anyone able to create objects could shadow a table name
-- and hijack a SECURITY DEFINER function. Standard hardening.
-- ------------------------------------------------------------

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.org_id
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.deleted_at is null
    and p.is_active
  limit 1
$$;

comment on function public.current_org_id() is
  'The organization the logged-in user belongs to. Null when logged out.';


create or replace function public.has_permission(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp
      on  rp.role_id    = p.role_id
      and rp.org_id     = p.org_id
      and rp.deleted_at is null
    join public.permissions perm
      on  perm.id = rp.permission_id
    where p.user_id     = (select auth.uid())
      and p.deleted_at  is null
      and p.is_active
      and perm.key      = p_key
  )
$$;

comment on function public.has_permission(text) is
  'Does the logged-in user hold this permission, via their role? The only correct way to ask.';

revoke execute on function public.current_org_id()     from public;
revoke execute on function public.has_permission(text) from public;
grant  execute on function public.current_org_id()     to authenticated;
grant  execute on function public.has_permission(text) to authenticated;


-- ------------------------------------------------------------
-- 3. Column privileges.
--
-- RLS decides which ROWS you may touch. It cannot hide a COLUMN.
-- Column visibility is grants, which is why this section exists.
--
-- Note what is granted nowhere: DELETE. Hard deletes are now impossible
-- through the API for every role. Soft-delete is enforced by the
-- database rather than by discipline.
-- ------------------------------------------------------------

-- organizations
revoke all on public.organizations from anon, authenticated;

grant select (id, name, slug, timezone, currency, phone, email, address, public_settings)
  on public.organizations to anon;

grant select on public.organizations to authenticated;

grant update (name, timezone, currency, phone, email, address,
              public_settings, private_settings)
  on public.organizations to authenticated;

-- permissions — a read-only catalogue
revoke all on public.permissions from anon, authenticated;
grant select on public.permissions to authenticated;

-- roles
revoke all on public.roles from anon, authenticated;
grant select on public.roles to authenticated;
grant insert (org_id, name, display_name) on public.roles to authenticated;
grant update (display_name, deleted_at)   on public.roles to authenticated;

-- role_permissions
revoke all on public.role_permissions from anon, authenticated;
grant select on public.role_permissions to authenticated;
grant insert (org_id, role_id, permission_id) on public.role_permissions to authenticated;
grant update (deleted_at)                     on public.role_permissions to authenticated;

-- profiles
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant insert (org_id, user_id, full_name, email, phone, role_id) on public.profiles to authenticated;
grant update (full_name, email, phone, role_id, is_active, deleted_at) on public.profiles to authenticated;


-- ------------------------------------------------------------
-- 4. Policies.
--
-- USING decides which existing rows you may see or change.
-- WITH CHECK decides what a row is allowed to look like afterwards.
-- Writes need both, or someone can move a row into another organization.
-- ------------------------------------------------------------

-- organizations ----------------------------------------------
create policy organizations_select_anon
  on public.organizations for select to anon
  using (deleted_at is null);

create policy organizations_select_member
  on public.organizations for select to authenticated
  using (deleted_at is null and id = public.current_org_id());

create policy organizations_update
  on public.organizations for update to authenticated
  using (id = public.current_org_id()
         and public.has_permission('organization.edit'))
  with check (id = public.current_org_id());

-- No insert policy. New organizations are created by service_role
-- during onboarding, never by a logged-in user.


-- permissions --------------------------------------------------
create policy permissions_select
  on public.permissions for select to authenticated
  using (true);

-- No write policies. This catalogue changes by migration only.


-- roles --------------------------------------------------------
create policy roles_select
  on public.roles for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy roles_insert
  on public.roles for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('role.manage'));

create policy roles_update
  on public.roles for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('role.manage')
         and is_system = false)
  with check (org_id = public.current_org_id());


-- role_permissions ---------------------------------------------
create policy role_permissions_select
  on public.role_permissions for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy role_permissions_insert
  on public.role_permissions for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('role.manage'));

create policy role_permissions_update
  on public.role_permissions for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('role.manage'))
  with check (org_id = public.current_org_id());


-- profiles ------------------------------------------------------
-- Two select policies. Postgres ORs them together. The first is a
-- safety net: you can always read your own profile even if something
-- goes wrong with the org lookup, so nobody can lock themselves out.
create policy profiles_select_own
  on public.profiles for select to authenticated
  using (deleted_at is null and user_id = (select auth.uid()));

create policy profiles_select_org
  on public.profiles for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy profiles_insert
  on public.profiles for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('employee.manage'));

create policy profiles_update
  on public.profiles for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('employee.manage'))
  with check (org_id = public.current_org_id());
