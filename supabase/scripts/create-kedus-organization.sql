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
-- wrong. Migration 004 made both required parameters for this reason.

select public.create_organization(
  p_name     => 'Kedus Hair Salon and Braiding',
  p_slug     => 'kedus-hair-salon',
  p_timezone => 'America/New_York',
  p_currency => 'USD',
  p_phone    => '+1 000 000 0000',
  p_email    => 'hello@example.com',
  p_address  => '1 Example Street, Placeholder Town'
);

-- ------------------------------------------------------------
-- Correction applied by hand on 2026-08-08.
--
-- The organization was originally created with Africa/Johannesburg and
-- ZAR, from a guess made in migration 001. Corrected in the SQL editor
-- before migration 004 landed. Kept here so the row's history is
-- recorded; not needed on a fresh project, since the call above now
-- passes the right values.
-- ------------------------------------------------------------
-- update public.organizations
-- set timezone = 'America/New_York', currency = 'USD'
-- where slug = 'kedus-hair-salon';
