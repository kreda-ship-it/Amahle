-- Makes the first Owner of Kedus Hair Salon and Braiding.
--
-- NOT a migration — a profile is tenant data, and migrations are
-- replayed by every deployment. Run once per project, by hand, in the
-- SQL editor, after creating the auth user in the dashboard.
--
-- This is the bootstrap that breaks a loop: the RLS insert policy on
-- profiles requires employee.manage, and nobody holds any permission
-- until an owner exists. create_profile() runs as service role, so it
-- can make the first one.
--
-- The organization is looked up by slug rather than by a pasted uuid.
-- The slug is stable and readable, and it means this script works
-- against any project where Kedus exists.
--
-- Already run against: Salon dev (zpndfluiyrvvujyasdbo) on 2026-08-08.

select public.create_profile(
  p_org_id    => (select id from public.organizations where slug = 'kedus-hair-salon'),
  p_user_id   => '5c3bfeaf-7152-4c5d-b2f5-311f8a64d2da',
  p_full_name => 'Kalkidan Reda',
  p_email     => 'redakalkidan@gmail.com',
  p_role_name => 'owner'
);
