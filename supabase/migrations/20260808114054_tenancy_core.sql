-- ============================================================
-- 001 — tenancy core
--
-- organizations, roles, permissions, role_permissions, profiles
--
-- RLS is ENABLED on every table here, and NO policies are written yet.
-- In Postgres that combination means "deny everything to everyone".
-- That is deliberate: the database is locked until policies land in the
-- next migration. Seeding happens with the service role key, which
-- bypasses RLS by design.
-- ============================================================


-- ------------------------------------------------------------
-- Shared helper: keep updated_at honest.
-- A "trigger" is SQL that Postgres runs automatically on every write,
-- so no query has to remember to set this column by hand.
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ------------------------------------------------------------
-- organizations — the tenant boundary itself.
-- The only table with no org_id, because it IS the org.
-- ------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  timezone    text not null default 'Africa/Johannesburg',
  currency    text not null default 'ZAR',
  phone       text,
  email       text,
  address     text,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- Slug is unique among LIVE rows only. A soft-deleted salon shouldn't
-- permanently reserve its slug.
create unique index organizations_slug_key
  on public.organizations (slug)
  where deleted_at is null;

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;


-- ------------------------------------------------------------
-- roles — per organization. Owner, Manager, Receptionist, Stylist.
-- Rows, not code.
-- ------------------------------------------------------------
create table public.roles (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id),
  name          text not null,
  display_name  text not null,
  is_system     boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- Two salons can each have a role named 'receptionist'. One salon cannot
-- have two.
create unique index roles_org_name_key
  on public.roles (org_id, name)
  where deleted_at is null;

create index roles_org_id_idx on public.roles (org_id);

create trigger roles_set_updated_at
  before update on public.roles
  for each row execute function public.set_updated_at();

alter table public.roles enable row level security;


-- ------------------------------------------------------------
-- permissions — the catalogue of every action the software supports.
--
-- DELIBERATELY has no org_id. This is product reference data, identical
-- for every organization, and it changes when we ship a feature rather
-- than when a salon changes its mind. Per-organization customization
-- lives in role_permissions below. See DECISIONS.md #14.
--
-- Also has no updated_at / deleted_at: rows are added and changed by
-- migration, not by the application.
-- ------------------------------------------------------------
create table public.permissions (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  description  text not null,
  category     text not null,
  created_at   timestamptz not null default now()
);

alter table public.permissions enable row level security;


-- ------------------------------------------------------------
-- role_permissions — which role holds which permission.
-- THIS is where each organization's customization actually lives.
-- ------------------------------------------------------------
create table public.role_permissions (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  role_id        uuid not null references public.roles (id),
  permission_id  uuid not null references public.permissions (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

create unique index role_permissions_role_permission_key
  on public.role_permissions (role_id, permission_id)
  where deleted_at is null;

create index role_permissions_org_id_idx  on public.role_permissions (org_id);
create index role_permissions_role_id_idx on public.role_permissions (role_id);

create trigger role_permissions_set_updated_at
  before update on public.role_permissions
  for each row execute function public.set_updated_at();

alter table public.role_permissions enable row level security;


-- ------------------------------------------------------------
-- profiles — a person who can log in.
-- Customers are NOT here. They never log in.
-- ------------------------------------------------------------
create table public.profiles (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id),
  user_id     uuid not null references auth.users (id),
  full_name   text not null,
  email       text not null,
  phone       text,
  role_id     uuid not null references public.roles (id),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

-- One login belongs to one organization.
create unique index profiles_user_id_key
  on public.profiles (user_id)
  where deleted_at is null;

create index profiles_org_id_idx  on public.profiles (org_id);
create index profiles_role_id_idx on public.profiles (role_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
