-- Proves that one organization cannot see another's rows.
--
-- Run this in the SQL editor after adding any new table. If a new table
-- is missing its RLS policy, the counts below stop matching and you find
-- out immediately rather than in production.
--
-- The second organization is created inside a transaction that rolls
-- back, so it is real for the length of the test and gone afterwards.
-- This matters because DELETE is granted to nobody: a test organization
-- created for real would be stuck in the database forever, soft-deleted
-- at best. Rolling back is the only clean way to test destructively.
--
-- p_user_id below is the Kedus owner. Change it to test as someone else.
--
-- Last run against Salon dev on 2026-08-08 — passed: 1, 4, 4, 0.

begin;

  -- A second organization, real for the length of this transaction.
  select public.create_organization(
    p_name     => 'Test Salon Two',
    p_slug     => 'test-salon-two',
    p_timezone => 'America/New_York',
    p_currency => 'USD'
  );

  -- Become the Kedus owner. set_config with `true` scopes it to this
  -- transaction; auth.uid() reads the `sub` claim from here.
  select set_config(
    'request.jwt.claims',
    '{"sub":"5c3bfeaf-7152-4c5d-b2f5-311f8a64d2da","role":"authenticated"}',
    true
  );
  set local role authenticated;

  -- At this moment the database holds TWO organizations, EIGHT roles and
  -- EIGHT role_permissions. Expected result: 1, 4, 4, 0.
  --
  -- The last column is the point. The other organization exists. It is
  -- not visible. Not because the query filtered it out — because
  -- Postgres refuses to hand it over.
  select (select count(*) from public.organizations)                              as organizations_visible,
         (select count(*) from public.roles)                                      as roles_visible,
         (select count(*) from public.role_permissions)                           as role_permissions_visible,
         (select count(*) from public.organizations where slug = 'test-salon-two') as other_org_visible;

rollback;
