-- ============================================================
-- 007 — services
--
-- The first table a stranger on the internet reads. Everything before
-- this one was for people who had already logged in.
--
-- That changes the shape of the work: the public price list is served
-- to `anon`, so this migration cares as much about which COLUMNS leave
-- the database as about which rows.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The table.
--
-- price_display exists because a flat number is a marketing decision,
-- not a fact. Braiding and colour are priced by length and condition,
-- so the salon picks per service:
--
--   'exact'   → "$120"
--   'from'    → "from $120"
--   'hidden'  → no price shown; the page invites a phone call
--
-- duration_minutes and buffer_minutes are what Phase 4 will compute
-- availability from. buffer_minutes is cleanup and prep AFTER the
-- appointment, and it is nobody's business outside the salon.
-- ------------------------------------------------------------
create table public.services (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations (id),
  name                text not null,
  description         text,
  category            text,
  price               numeric(10,2) not null default 0 check (price >= 0),
  price_display       text not null default 'exact'
                        check (price_display in ('exact', 'from', 'hidden')),
  duration_minutes    int not null check (duration_minutes > 0),
  buffer_minutes      int not null default 0 check (buffer_minutes >= 0),
  is_bookable_online  boolean not null default true,
  image_url           text,
  display_order       int not null default 0,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

comment on column public.services.price_display is
  'How the public site renders the price: exact, from, or hidden. A presentation choice, not a security boundary — see the note on grants below.';

comment on column public.services.buffer_minutes is
  'Cleanup and prep time after the appointment. Internal; never granted to anon.';

comment on column public.services.is_bookable_online is
  'False means the service still appears on the public price list, but with a "call us" note instead of a Book button. It does not hide the service.';

-- Two salons can both offer "Silk Press". One salon cannot list it
-- twice. Live rows only — a soft-deleted service must not permanently
-- reserve its own name.
create unique index services_org_name_key
  on public.services (org_id, name)
  where deleted_at is null;

create index services_org_id_idx on public.services (org_id);

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

alter table public.services enable row level security;


-- ------------------------------------------------------------
-- 2. The permission.
--
-- Migration 003 says a future migration adding a permission must decide
-- who gets it, so nobody silently gains access while they weren't
-- looking. This is that decision, made in writing.
-- ------------------------------------------------------------
insert into public.permissions (key, description, category) values
  ('service.manage', 'Add and edit services, prices and durations', 'Services')
on conflict (key) do nothing;

-- create_organization() hands the Owner role every permission that
-- exists at the moment the organization is created, so future salons
-- are covered by that cross join. Manager is an explicit list, and
-- setting prices is squarely a manager's job.
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
    and p.key in ('employee.manage', 'service.manage');

  return v_org_id;
end;
$$;

-- Kedus already exists, so it missed both cross joins above. Hand the
-- new permission to the roles that should have it. ON CONFLICT makes
-- this safe to replay.
insert into public.role_permissions (org_id, role_id, permission_id)
select r.org_id, r.id, p.id
from public.roles r
cross join public.permissions p
where r.name in ('owner', 'manager')
  and r.deleted_at is null
  and p.key = 'service.manage'
on conflict do nothing;


-- ------------------------------------------------------------
-- 3. Column privileges.
--
-- The anon list is the public price list, column by column. Anything
-- not named here never leaves the database for a logged-out visitor:
-- not buffer_minutes, not is_active, not the timestamps.
--
-- org_id IS granted, and has to be: filtering a query by a column
-- requires SELECT privilege on that column, and the public site fetches
-- one salon's services by org_id.
--
-- KNOWN AND ACCEPTED: `price` is granted to anon even for rows whose
-- price_display is 'hidden'. Grants are per column, not per row, so a
-- determined visitor querying the API directly reads the number the
-- page chose not to print. This is a presentation preference, not a
-- secret — but it is a real gap, and the fix if it ever matters is a
-- view that nulls the column, with anon reading the view instead of the
-- table. Not built now, deliberately.
--
-- DELETE is granted to nobody, as everywhere else.
-- ------------------------------------------------------------
revoke all on public.services from anon, authenticated;

grant select (id, org_id, name, description, category, price, price_display,
              duration_minutes, is_bookable_online, image_url, display_order)
  on public.services to anon;

grant select on public.services to authenticated;

grant insert (org_id, name, description, category, price, price_display,
              duration_minutes, buffer_minutes, is_bookable_online,
              image_url, display_order, is_active)
  on public.services to authenticated;

grant update (name, description, category, price, price_display,
              duration_minutes, buffer_minutes, is_bookable_online,
              image_url, display_order, is_active, deleted_at)
  on public.services to authenticated;


-- ------------------------------------------------------------
-- 4. Policies.
--
-- The anon policy is not scoped to one organization, and that is
-- correct — it mirrors organizations_select_anon. Every salon's public
-- price list is public by definition; there is nothing to protect by
-- hiding salon B's menu from salon A's visitors. The application picks
-- the org by slug and filters. Multi-tenancy protects private data, not
-- a printed menu.
-- ------------------------------------------------------------

create policy services_select_anon
  on public.services for select to anon
  using (deleted_at is null and is_active);

-- Staff see every live service in their own organization, including the
-- ones marked inactive or not bookable online. They need the whole menu
-- to work from, not the shop window.
create policy services_select_member
  on public.services for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy services_insert
  on public.services for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('service.manage'));

create policy services_update
  on public.services for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('service.manage'))
  with check (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 5. Audit.
--
-- 'routine': services are operational configuration. The money that
-- matters legally is the price snapshot copied onto each appointment,
-- which is a different table and a different tier. Every price change
-- is still recorded in full — the tier is only how an audit screen
-- would sort it, and it is one word to change later.
-- ------------------------------------------------------------
create trigger services_audit
  after insert or update on public.services
  for each row execute function public.audit_row('service', 'routine');
