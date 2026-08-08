-- Creates the Kedus organization in a Supabase project.
--
-- NOT a migration. An organization is tenant data, and migrations are
-- replayed by every deployment — salon #7 must not replay salon #1's
-- details. Run once per project, by hand, in the SQL editor.
--
-- Already run against: Salon dev (zpndfluiyrvvujyasdbo) on 2026-08-08.
--
-- Contact details below are deliberate placeholders for the dev
-- database. `example.com` is IANA-reserved and can never belong to
-- anyone; the phone number is all zeros so it cannot dial a real person.
-- Replace them with real values before running this against prod.
--
-- p_timezone and p_currency are NOT cosmetic. Every appointment time is
-- interpreted against the timezone, so a wrong value makes every booking
-- wrong. Confirm both before real appointments exist.

select public.create_organization(
  p_name     => 'Kedus Hair Salon and Braiding',
  p_slug     => 'kedus-hair-salon',
  p_timezone => 'Africa/Johannesburg',
  p_currency => 'ZAR',
  p_phone    => '+27 00 000 0000',
  p_email    => 'hello@example.com',
  p_address  => '1 Example Street, Placeholder Suburb'
);
