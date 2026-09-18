-- ============================================================
-- 010 — composite keys on roles and audit_log
--
-- Found by supabase/scripts/audit-tenant-safety.sql on its first run.
-- Three foreign keys written in migrations 001 and 006 reference a
-- tenant-scoped table by id alone, which DECISIONS #21 forbids:
--
--   profiles.role_id          → roles (id)
--   role_permissions.role_id  → roles (id)
--   audit_log.actor_id        → profiles (id)
--
-- Each one lets a row in one salon point at a row in another, with
-- every RLS policy satisfied — the WITH CHECK clauses only verify that
-- org_id equals current_org_id(), never that the thing being referenced
-- belongs to the same salon.
--
-- WHY THIS WAS NOT ALREADY A BREACH
--
-- has_permission() joins role_permissions on BOTH role_id and org_id:
--
--     join public.role_permissions rp
--       on  rp.role_id = p.role_id
--       and rp.org_id  = p.org_id
--
-- so a profile pointed at another salon's role matches no permission
-- rows and is granted nothing. The failure mode today is a user with no
-- access, not a user with someone else's. That is defence in depth
-- working as intended — but it is one line in one function, and the
-- next person to rewrite that function does not know it is load
-- bearing. The database should refuse the reference outright.
--
-- audit_log.actor_id is nullable, and a composite foreign key
-- containing a NULL is not checked (MATCH SIMPLE, the default). Entries
-- with no actor — public bookings, migrations, service-role scripts —
-- are unaffected.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Give roles the key the references need.
--
-- Additive and cannot fail: id is already unique on its own, so
-- (id, org_id) is trivially unique too.
-- ------------------------------------------------------------
alter table public.roles
  add constraint roles_id_org_key unique (id, org_id);


-- ------------------------------------------------------------
-- 2. Replace the three references.
--
-- Postgres validates each new constraint against existing rows as it
-- is created. Every row in this database was created inside a single
-- organization, so they pass. A failure here would itself be a finding.
-- ------------------------------------------------------------

-- A profile's role must belong to the profile's own salon.
alter table public.profiles
  drop constraint profiles_role_id_fkey;

alter table public.profiles
  add constraint profiles_role_id_fkey
  foreign key (role_id, org_id) references public.roles (id, org_id);

-- A permission grant must attach to a role in the same salon.
alter table public.role_permissions
  drop constraint role_permissions_role_id_fkey;

alter table public.role_permissions
  add constraint role_permissions_role_id_fkey
  foreign key (role_id, org_id) references public.roles (id, org_id);

-- An audit entry's actor must be someone from the salon the entry
-- belongs to. Null actor stays legal and stays meaningful.
alter table public.audit_log
  drop constraint audit_log_actor_id_fkey;

alter table public.audit_log
  add constraint audit_log_actor_id_fkey
  foreign key (actor_id, org_id) references public.profiles (id, org_id);
