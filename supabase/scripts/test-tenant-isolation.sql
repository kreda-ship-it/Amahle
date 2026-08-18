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
--   1, 4, 21, 0, 0, 0, 0, 0, 0, 0  (before migration 013)
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
--   013  employee_working_hours and employee_time_off, and two more
--        columns. The permission count does NOT move: editing a rota is
--        employee.record.manage, which already existed, and time off
--        carries no reason column to protect
--   014  appointments, and a thirteenth column. Three new keys, to
--        Owner, Manager and Receptionist (21 → 30):
--          Owner 12, Manager 10, Receptionist 6, Stylist 2
--        Stylist gets none of them and still sees their own schedule —
--        that is the select policy, not a permission

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

  -- The other salon's rota and time off. The sentinel values are
  -- deliberately absurd — no salon opens at 03:33 or books leave in
  -- 2099 — so the counts below can identify these rows without
  -- joining to an employee the test user cannot see anyway.
  insert into public.employee_working_hours
    (org_id, employee_id, day_of_week, start_time, end_time)
  select e.org_id, e.id, 2, '03:33', '04:44'
  from public.employees e
  where e.full_name = 'Other Salon Secret Stylist';

  insert into public.employee_time_off (org_id, employee_id, starts_at, ends_at)
  select e.org_id, e.id, '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z'
  from public.employees e
  where e.full_name = 'Other Salon Secret Stylist';

  -- An appointment joining all three of the other salon's rows. Note
  -- that ends_at, blocked_until and price are not supplied — the
  -- trigger fills them from the service, which this also proves.
  insert into public.appointments
    (org_id, customer_id, employee_id, service_id, starts_at, source)
  select c.org_id, c.id, e.id, s.id, '2099-06-01T10:00:00Z', 'staff'
  from public.customers c
  join public.employees e on e.org_id = c.org_id
  join public.services  s on s.org_id = c.org_id
  where c.full_name = 'Other Salon Secret Customer'
    and e.full_name = 'Other Salon Secret Stylist'
    and s.name      = 'Other Salon Secret Service';

  -- Become the Kedus owner. set_config with `true` scopes it to this
  -- transaction; auth.uid() reads the `sub` claim from here.
  select set_config(
    'request.jwt.claims',
    '{"sub":"5c3bfeaf-7152-4c5d-b2f5-311f8a64d2da","role":"authenticated"}',
    true
  );
  set local role authenticated;

  -- At this moment the database holds TWO organizations, EIGHT roles,
  -- SIXTY role_permissions, and — belonging to the other salon — ONE
  -- service, ONE employee, ONE gallery image, ONE customer, ONE care
  -- note, ONE flag, ONE rota entry, ONE period of leave and ONE
  -- appointment.
  -- Expected result: 1, 4, 30, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.
  --
  -- The ten zeroes are the point. Every one of those rows exists.
  -- None is visible. Not because the query filtered them out — because
  -- Postgres refuses to hand them over.
  --
  -- The gated ones — the care note and the flag — matter more than they
  -- look. The Kedus owner holds both customer.view and
  -- customer.view_sensitive, so those zeroes are not a permission being
  -- denied. They are the tenant boundary holding against someone who
  -- has every relevant permission there is. Tested as a Stylist, a zero
  -- would have proved nothing.
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
           where note = 'Other salon secret flag')                                as other_flag_visible,
         (select count(*) from public.employee_working_hours
           where start_time = '03:33')                                            as other_hours_visible,
         (select count(*) from public.employee_time_off
           where starts_at = '2099-01-01T00:00:00Z')                              as other_time_off_visible,
         (select count(*) from public.appointments
           where starts_at = '2099-06-01T10:00:00Z')                              as other_appointment_visible;

rollback;
