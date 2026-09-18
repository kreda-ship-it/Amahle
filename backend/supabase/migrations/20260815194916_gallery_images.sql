-- ============================================================
-- 011 — gallery_images, and paths instead of URLs
--
-- The salon's photographs: the gallery, and the two columns that were
-- already waiting for a picture but were named for the wrong thing.
--
-- Two jobs in one migration, and they belong together because they are
-- the same decision — where an image lives, and how a row points at it.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Store the PATH, never the URL.
--
-- A full Supabase Storage URL contains the project's own domain:
--
--   https://zpndfluiyrvvujyasdbo.supabase.co/storage/v1/object/public/...
--
-- PROJECT.md commits to creating a production project the moment the
-- first real customer record exists. On that day every stored URL
-- points at the old project, and every photograph on the website
-- breaks at once — silently, because a dead image is not an error
-- anyone gets told about.
--
-- Store `<org_id>/gallery/scarf-braids.jpg` instead and the same
-- migration is a non-event: the application builds the URL at render
-- time from whichever project it is talking to.
--
-- Both columns are null on every row today, so this rename moves no
-- data and breaks nothing. It is the cheapest it will ever be, which is
-- the entire argument for doing it now.
--
-- Postgres carries column privileges through a rename, so the grants
-- written in migrations 007 and 008 continue to apply — `anon` still
-- reads these two columns and still cannot read `phone`.
--
-- REGENERATE THE TYPES after this runs, or TypeScript keeps describing
-- columns that no longer exist:  npx supabase gen types typescript
--   --linked --schema public > src/lib/supabase/database.types.ts
-- ------------------------------------------------------------
alter table public.services  rename column image_url to image_path;
alter table public.employees rename column photo_url to photo_path;

comment on column public.services.image_path is
  'Path within the site-images storage bucket, not a URL. The URL is built at render time — see the note in migration 011.';

comment on column public.employees.photo_path is
  'Path within the site-images storage bucket, not a URL. The URL is built at render time — see the note in migration 011.';


-- ------------------------------------------------------------
-- 2. gallery_images.
--
-- Why this needs a table when a logo and a hero image do not: a gallery
-- is a LIST. It has an order the salon chooses, each entry carries its
-- own caption, and entries come and go. A single value belongs in
-- `public_settings` beside the tagline; a list does not.
--
-- alt_text is NOT NULL, deliberately.
--
-- Alt text is what a blind visitor hears in place of the photograph,
-- and what a search engine reads instead of looking at it. Made
-- optional it would be skipped every time, and the salon would quietly
-- have a website that excludes people. The database asking for one
-- sentence per photograph is the cheapest possible enforcement, and it
-- is enforced at the only layer no future upload form can forget.
--
-- caption is nullable and is a different thing: alt_text DESCRIBES the
-- photograph for someone who cannot see it, caption is optional
-- commentary printed underneath for everyone.
-- ------------------------------------------------------------
create table public.gallery_images (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  storage_path   text not null,
  alt_text       text not null check (length(trim(alt_text)) > 0),
  caption        text,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

comment on table public.gallery_images is
  'Photographs on the public website. The files live in Supabase Storage; this table holds the ordering, the alt text and the captions.';

comment on column public.gallery_images.storage_path is
  'Path within the site-images bucket, namespaced by org_id — e.g. <org_id>/gallery/scarf-braids.jpg. Never a full URL; see migration 011.';

comment on column public.gallery_images.alt_text is
  'What a blind visitor hears instead of the photograph. Required on purpose — see migration 011.';

-- The same photograph twice in one gallery is a mistake every time.
-- Live rows only: a soft-deleted image must not permanently reserve its
-- own path, or re-adding a photo someone removed becomes impossible.
create unique index gallery_images_org_path_key
  on public.gallery_images (org_id, storage_path)
  where deleted_at is null;

create index gallery_images_org_id_idx on public.gallery_images (org_id);

create trigger gallery_images_set_updated_at
  before update on public.gallery_images
  for each row execute function public.set_updated_at();

alter table public.gallery_images enable row level security;


-- ------------------------------------------------------------
-- 3. Column privileges.
--
-- The anon list is the public gallery, column by column. `is_active` is
-- absent because the policy below filters on it and nobody needs to
-- read it; the timestamps are absent because they are nobody's
-- business.
--
-- org_id IS granted, for the same reason as on services and employees:
-- filtering a query by a column requires SELECT privilege on it, and
-- the public site fetches one salon's gallery by org_id.
--
-- DELETE is granted to nobody, as everywhere else.
-- ------------------------------------------------------------
revoke all on public.gallery_images from anon, authenticated;

grant select (id, org_id, storage_path, alt_text, caption, display_order)
  on public.gallery_images to anon;

grant select on public.gallery_images to authenticated;

grant insert (org_id, storage_path, alt_text, caption, display_order, is_active)
  on public.gallery_images to authenticated;

grant update (storage_path, alt_text, caption, display_order, is_active, deleted_at)
  on public.gallery_images to authenticated;


-- ------------------------------------------------------------
-- 4. Policies.
--
-- NO NEW PERMISSION KEY. This is guarded by `organization.edit`, which
-- already exists and reads "Edit the organization's details and
-- branding".
--
-- That is the honest home for it. The gallery is website content in
-- exactly the way the tagline, the about paragraph and the opening
-- hours are website content, and those already live in
-- `public_settings` behind `organization.edit`. Whoever may rewrite the
-- salon's front page may change its photographs; splitting the two
-- would invent a distinction nobody asked for.
--
-- It also avoids rewriting create_organization() for the third
-- migration running. Migration 009 exists because 007 and 008 both did
-- that and both carried the old signature back with them. Not touching
-- the function is worth something on its own.
--
-- The anon policy is not scoped to one organization, mirroring
-- services_select_anon and organizations_select_anon: every salon's
-- gallery is public by definition. The application picks the org by
-- slug and filters.
-- ------------------------------------------------------------

create policy gallery_images_select_anon
  on public.gallery_images for select to anon
  using (deleted_at is null and is_active);

create policy gallery_images_select_member
  on public.gallery_images for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy gallery_images_insert
  on public.gallery_images for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('organization.edit'));

create policy gallery_images_update
  on public.gallery_images for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('organization.edit'))
  with check (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 5. Audit.
--
-- 'routine': a photograph on a website is operational configuration.
-- Nothing here is a customer's data or a financial record.
-- ------------------------------------------------------------
create trigger gallery_images_audit
  after insert or update on public.gallery_images
  for each row execute function public.audit_row('gallery_image', 'routine');


-- ============================================================
-- NOT IN THIS MIGRATION, deliberately: the storage bucket.
--
-- Buckets live in Supabase's own `storage` schema, which this project
-- does not own and should not migrate. Create it by hand, once:
--
--   Dashboard -> Storage -> New bucket
--     Name:   site-images
--     Public: yes
--
-- Public is correct. These are marketing photographs whose whole
-- purpose is to be looked at by strangers, and a public bucket serves
-- them without the application signing a URL for every image on every
-- page load.
--
-- No write policy on storage.objects, which means no logged-in user can
-- upload anything through the API. Files go in by hand through the
-- dashboard for now. Upload policies get written with the upload form
-- that needs them, so they can be written against a real screen rather
-- than a guessed one — the same rule that moved these tables out of
-- Phase 1.
-- ============================================================
