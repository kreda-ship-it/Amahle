-- Point the website at the salon's logo once it is in Supabase Storage.
--
-- NOT a migration. It changes one salon's content, not the shape of the
-- database, so it does not belong in supabase/migrations — the same
-- reasoning as seed-kedus.sql beside it.
--
-- RUN THIS SECOND. Upload the file first:
--
--   Supabase dashboard -> Storage -> site-images
--   -> New folder: 6256c761-caf8-402f-8215-b293d4e2be67
--   -> inside it, New folder: brand
--   -> Upload public/brand/kedus-hair-salon.png into it
--
-- The database stores the PATH and never a full web address. imageUrl() in
-- /lib/site/images.ts builds the address from NEXT_PUBLIC_SUPABASE_URL, which
-- is what lets every photograph move with the project when the production
-- Supabase project is created. See migration 011.

update organizations
set public_settings = public_settings || jsonb_build_object(
  'logo', '6256c761-caf8-402f-8215-b293d4e2be67/brand/kedus-hair-salon.png'
)
where slug = 'kedus-hair-salon'
  and deleted_at is null;

-- Check it landed:
-- select public_settings -> 'logo' from organizations
--  where slug = 'kedus-hair-salon';

-- Then, once the site is showing the uploaded copy rather than the local one:
--
--   1. delete public/brand/kedus-hair-salon.png
--   2. delete stockLogo() from src/lib/site/stock-photos.ts
--
-- Anything still importing it will fail to compile, which is the reminder you
-- want rather than a silent second copy of the logo living in the repo.
