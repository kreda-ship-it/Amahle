-- ============================================================
-- 006 — audit log
--
-- Append-only. Written by triggers, never by application code.
--
-- Triggers rather than explicit calls because most writes never pass
-- through a function: the RLS policies allow authenticated users to
-- UPDATE organizations, roles, role_permissions and profiles directly
-- through the API. An owner editing the salon's phone number from a
-- settings form is a straight table update with no function in the
-- path. A trigger fires regardless of what caused the write, and cannot
-- be bypassed by forgetting.
-- ============================================================

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id),
  actor_id     uuid references public.profiles (id),
  action       text not null,
  entity_type  text not null,
  entity_id    uuid not null,
  changes      jsonb,
  tier         text not null check (tier in ('critical', 'routine')),
  ip_address   text,
  created_at   timestamptz not null default now()
);

-- No updated_at, no deleted_at. Nothing here is ever changed or removed.
create index audit_log_org_created_idx on public.audit_log (org_id, created_at desc);
create index audit_log_entity_idx      on public.audit_log (entity_type, entity_id);

alter table public.audit_log enable row level security;

-- Deny-all: no policies, and no grants to anyone. The table is written
-- only by the security definer trigger below, and read only by the
-- service role until an audit UI exists and earns an audit.view
-- permission.
revoke all on public.audit_log from anon, authenticated;


-- ------------------------------------------------------------
-- Who is acting. Mirrors current_org_id(); same recursion reasoning.
-- Null when there is no logged-in user — a migration, a service role
-- script, or an anonymous booking. That null is meaningful, not missing.
-- ------------------------------------------------------------
create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.profiles p
  where p.user_id = (select auth.uid())
    and p.deleted_at is null
    and p.is_active
  limit 1
$$;

comment on function public.current_profile_id() is
  'The profile of the logged-in user. Null when logged out or acting as service role.';

revoke execute on function public.current_profile_id() from public;
grant  execute on function public.current_profile_id() to authenticated;


-- ------------------------------------------------------------
-- The trigger. One function for every table.
--
-- TG_ARGV[0] entity_type — 'organization', 'profile', ...
-- TG_ARGV[1] tier        — 'critical' or 'routine'
-- TG_ARGV[2] org column  — 'org_id' everywhere except organizations,
--                          which IS the org, so its own id is used
--
-- SECURITY DEFINER so it can write to a table nobody may write to.
-- Without it, the audit insert would be denied and would take the
-- user's legitimate update down with it.
-- ------------------------------------------------------------
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_changes jsonb;
  v_action  text;
  v_tier    text := TG_ARGV[1];
  v_org_col text := coalesce(TG_ARGV[2], 'org_id');
  v_org_id  uuid;
begin
  v_new := to_jsonb(new);
  v_org_id := (v_new ->> v_org_col)::uuid;

  if TG_OP = 'INSERT' then
    v_action  := TG_ARGV[0] || '.created';
    v_changes := jsonb_build_object('after', v_new);

  else
    v_old := to_jsonb(old);

    -- A soft delete is an UPDATE that sets deleted_at. Record it as
    -- what it actually is. Deletions are always critical.
    if old.deleted_at is null and new.deleted_at is not null then
      v_action := TG_ARGV[0] || '.deleted';
      v_tier   := 'critical';
    else
      v_action := TG_ARGV[0] || '.updated';
    end if;

    -- Only what actually changed. updated_at moves on every write and
    -- would otherwise be the only entry in half these rows.
    select jsonb_object_agg(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k))
    into v_changes
    from jsonb_object_keys(v_new) k
    where v_new -> k is distinct from v_old -> k
      and k <> 'updated_at';

    -- Nothing of substance changed. Don't log noise.
    if v_changes is null then
      return null;
    end if;
  end if;

  insert into public.audit_log
    (org_id, actor_id, action, entity_type, entity_id, changes, tier)
  values
    (v_org_id, public.current_profile_id(), v_action, TG_ARGV[0], new.id, v_changes, v_tier);

  return null;  -- AFTER trigger; return value is ignored
end;
$$;

comment on function public.audit_row() is
  'Generic audit trigger. Args: entity_type, tier, org column (default org_id).';


-- ------------------------------------------------------------
-- Attach it. All four are critical: identity, permissions, and the
-- organization's own settings.
--
-- permissions gets no trigger — it is product reference data, changed
-- only by migration, and a migration is already recorded in git.
-- ------------------------------------------------------------
create trigger organizations_audit
  after insert or update on public.organizations
  for each row execute function public.audit_row('organization', 'critical', 'id');

create trigger profiles_audit
  after insert or update on public.profiles
  for each row execute function public.audit_row('profile', 'critical');

create trigger roles_audit
  after insert or update on public.roles
  for each row execute function public.audit_row('role', 'critical');

create trigger role_permissions_audit
  after insert or update on public.role_permissions
  for each row execute function public.audit_row('role_permission', 'critical');
