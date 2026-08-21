-- Set the three small facts printed under the booking button on the homepage.
--
-- NOT a migration. It changes one salon's content, not the shape of the
-- database, so it does not belong in supabase/migrations — the same reasoning
-- as seed-kedus.sql beside it.
--
-- The website reads `public_settings -> 'highlights'` and prints nothing at
-- all when the key is absent, which is where things stand until this is run.
--
-- EDIT THE THREE LINES BELOW FIRST. They are a guess taken from the design
-- and nobody has checked them with the salon. Three is what the row is built
-- for; a fourth is read but not printed.
--
-- Run it from the Supabase dashboard SQL editor, against the dev project.

update organizations
set public_settings = public_settings || jsonb_build_object(
  'highlights', jsonb_build_array(
    'Walk-ins welcome',
    'Parking in back',
    'Cash or card'
  )
)
where slug = 'kedus-hair-salon'
  and deleted_at is null;

-- Check it landed:
-- select public_settings -> 'highlights' from organizations
--  where slug = 'kedus-hair-salon';
