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
-- Last run against Salon dev on 2026-08-17 — passed:
--   1, 4, 21, 0, 0, 0, 0, 0, 0, 0
-- Expected counts change as migrations land:
--   007  services table; service.manage to Owner and Manager (4 → 6)
--   008  employees and employee_services; employee.record.manage to
--        Owner and Manager (6 → 8)
--   011  gallery_images, and a seventh column. The permission count does
--        NOT move: the gallery is guarded by organization.edit, which
--        already existed, so no new key was added
--   012  customers, customer_care_notes, customer_flags, and three more
--        columns. Four new keys, and the first permissions Receptionist
--        and Stylist have ever held, so the count jumps 8 → 21:
--          Owner 9, Manager 7, Receptionist 3, Stylist 2

begin;

  -- A second organization, real for the length of this transaction.
  select public.create_organization(
    p_name     => 'Test Salon Two',
    p_slug     => 'test-salon-two',
    p_timezone => 'America/New_York',
    p_currency => 'USD'
  );

  -- Give the other organization something to hide. This runs before the
  -- role switch below, so no policy applies to the writes themselves.
  insert into public.services (org_id, name, price, duration_minutes)
  select o.id, 'Other Salon Secret Service', 999, 60
  from public.organizations o
  where o.slug = 'test-salon-two';

  insert into public.gallery_images (org_id, storage_path, alt_text)
  select o.id, 'other-salon/gallery/secret.jpg', 'Other salon secret photograph'
  from public.organizations o
  where o.slug = 'test-salon-two';

  insert into public.employees (org_id, full_name, phone)
  select o.id, 'Other Salon Secret Stylist', '555-0100'
  from public.organizations o
  where o.slug = 'test-salon-two';

  -- A customer of the other salon, with an allergy and a flag. These
  -- three are the rows that would do real damage if they leaked: a
  -- name, a phone number, and a medical note about someone who never
  -- agreed to be in anyone's database.
  insert into public.customers (org_id, full_name, phone)
  select o.id, 'Other Salon Secret Customer', '555-0199'
  from public.organizations o
  where o.slug = 'test-salon-two';

  insert into public.customer_care_notes (org_id, customer_id, allergies)
  select c.org_id, c.id, 'Other salon secret allergy'
  from public.customers c
  where c.full_name = 'Other Salon Secret Customer';

  insert into public.customer_flags (org_id, customer_id, flag_type, note)
  select c.org_id, c.id, 'vip', 'Other salon secret flag'
  from public.customers c
  where c.full_name = 'Other Salon Secret Customer';

  -- Become the Kedus owner. set_config with `true` scopes it to this
  -- transaction; auth.uid() reads the `sub` claim from here.
  select set_config(
    'request.jwt.claims',
    '{"sub":"5c3bfeaf-7152-4c5d-b2f5-311f8a64d2da","role":"authenticated"}',
    true
  );
  set local role authenticated;

  -- At this moment the database holds TWO organizations, EIGHT roles,
  -- FORTY-TWO role_permissions, and — belonging to the other salon —
  -- ONE service, ONE employee, ONE gallery image, ONE customer, ONE
  -- care note and ONE flag.
  -- Expected result: 1, 4, 21, 0, 0, 0, 0, 0, 0, 0.
  --
  -- The seven zeroes are the point. Every one of those rows exists.
  -- None is visible. Not because the query filtered them out — because
  -- Postgres refuses to hand them over.
  --
  -- The last three matter more than they look. The Kedus owner holds
  -- customer.view AND customer.view_sensitive, so those zeroes are not
  -- a permission being denied — they are the tenant boundary holding
  -- against someone who has every relevant permission there is. Had we
  -- tested as a Stylist, a zero would have proved nothing.
  select (select count(*) from public.organizations)                              as organizations_visible,
         (select count(*) from public.roles)                                      as roles_visible,
         (select count(*) from public.role_permissions)                           as role_permissions_visible,
         (select count(*) from public.organizations where slug = 'test-salon-two') as other_org_visible,
         (select count(*) from public.services
           where name = 'Other Salon Secret Service')                             as other_service_visible,
         (select count(*) from public.employees
           where full_name = 'Other Salon Secret Stylist')                        as other_employee_visible,
         (select count(*) from public.gallery_images
           where alt_text = 'Other salon secret photograph')                      as other_image_visible,
         (select count(*) from public.customers
           where full_name = 'Other Salon Secret Customer')                       as other_customer_visible,
         (select count(*) from public.customer_care_notes
           where allergies = 'Other salon secret allergy')                        as other_care_note_visible,
         (select count(*) from public.customer_flags
           where note = 'Other salon secret flag')                                as other_flag_visible;

rollback;
