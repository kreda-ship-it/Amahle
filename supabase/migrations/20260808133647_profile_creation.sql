-- ============================================================
-- 005 — profile creation
--
-- The canonical path by which a person gains a login. Staff never
-- self-register: someone with employee.manage invites them, and the
-- very first owner is created by hand, the same way the organization
-- was.
--
-- Service role only. There IS an RLS insert policy on profiles, for the
-- eventual invite UI, but it requires employee.manage — which nobody
-- holds until an owner exists. This function is how that loop is broken.
--
-- Customers never reach this table. They have no login. See DECISIONS
-- #8 and #20.
-- ============================================================

create or replace function public.create_profile(
  p_org_id     uuid,
  p_user_id    uuid,
  p_full_name  text,
  p_email      text,
  p_role_name  text,
  p_phone      text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_role_id    uuid;
  v_profile_id uuid;
begin
  -- Roles are per-organization, so the same name means different rows
  -- in different organizations. Looking it up by name scoped to the org
  -- is what stops a profile being handed a role from another salon.
  select id into v_role_id
  from public.roles
  where org_id = p_org_id
    and name = p_role_name
    and deleted_at is null;

  if v_role_id is null then
    raise exception 'No role named "%" in organization %', p_role_name, p_org_id;
  end if;

  insert into public.profiles
    (org_id, user_id, full_name, email, phone, role_id)
  values
    (p_org_id, p_user_id, p_full_name, p_email, p_phone, v_role_id)
  returning id into v_profile_id;

  return v_profile_id;
end;
$$;

comment on function public.create_profile(uuid,uuid,text,text,text,text) is
  'The only way a profile is created. Service role only — the invite UI calls it server-side.';

revoke execute on function public.create_profile(uuid,uuid,text,text,text,text)
  from public, anon, authenticated;

grant execute on function public.create_profile(uuid,uuid,text,text,text,text)
  to service_role;
