-- File the salon's existing menu into the new category tree.
--
-- NOT a migration, and NOT a soft-delete. Read the reasoning before running it.
--
-- The twenty-four services already on the menu predate migration 027 and carry
-- a `category` TEXT column — Hairstyles, Braids & More, Coloring, Care,
-- Haircuts. The new tree is rows. This puts each existing service under the
-- branch it belongs to, and changes nothing else: not its price, not its
-- duration, not whether it can be booked online.
--
-- WHY THESE ARE NOT SOFT-DELETED.
--
-- The public site reads `category` as text today — the services page groups by
-- it, the homepage spreads across it, the booking picker filters by it.
-- Soft-deleting the twenty-four now empties the live price list and the live
-- booking flow, and replaces them with eleven braiding styles priced with
-- guesses. The salon takes real bookings on this site.
--
-- So they stay, filed. They are retired in one statement on the day the
-- booking flow reads the tree instead of the text column, and not before:
--
--   update public.services set deleted_at = now()
--   where org_id = <org> and category is not null and deleted_at is null;
--
-- Reversible. `category_id` is nullable and nothing reads it yet, so setting
-- every one of them back to null undoes this file completely.

do $$
declare
  v_org uuid;
  v_braiding   uuid; v_natural  uuid; v_finish uuid;
  v_colour     uuid; v_treat    uuid; v_cuts   uuid;
  v_unfiled    int;
begin
  select id into v_org
  from public.organizations
  where slug = 'kedus-hair-salon' and deleted_at is null;

  if v_org is null then
    raise exception 'No live organization with slug kedus-hair-salon.';
  end if;

  select id into v_braiding from public.service_categories
    where org_id = v_org and parent_id is null and name = 'Braiding';
  select id into v_natural  from public.service_categories
    where org_id = v_org and name = 'Natural hair styling';
  select id into v_finish   from public.service_categories
    where org_id = v_org and name = 'Wash, straighten & finish';
  select id into v_colour   from public.service_categories
    where org_id = v_org and name = 'Hair colour';
  select id into v_treat    from public.service_categories
    where org_id = v_org and name = 'Hair treatments';
  select id into v_cuts     from public.service_categories
    where org_id = v_org and name = 'Haircut & trim';

  if v_braiding is null then
    raise exception 'The category tree is missing. Run seed-service-tree.sql first.';
  end if;

  -- Four of the five old text categories map straight across.
  --
  -- Braids & More goes to Braiding itself rather than to "With extensions" or
  -- "Without". Micro braids plainly use extensions and a braided bun plainly
  -- does not, but nothing in the database says so, and guessing would put the
  -- wrong question in front of a customer. A parent category holding services
  -- directly is legal and honest; these move down a level when somebody who
  -- knows says which is which.
  update public.services set category_id = v_braiding
   where org_id = v_org and category = 'Braids & More' and deleted_at is null;

  update public.services set category_id = v_colour
   where org_id = v_org and category = 'Coloring'  and deleted_at is null;

  update public.services set category_id = v_treat
   where org_id = v_org and category = 'Care'      and deleted_at is null;

  update public.services set category_id = v_cuts
   where org_id = v_org and category = 'Haircuts'  and deleted_at is null;

  -- "Hairstyles" was a bag holding three different kinds of work, which is
  -- why the mind map does not have a category by that name. Split by hand.
  update public.services set category_id = v_finish
   where org_id = v_org and deleted_at is null
     and name in ('Wash & Blow Dry', 'Wash & Set', 'Wash & Set with Flat Iron');

  update public.services set category_id = v_natural
   where org_id = v_org and deleted_at is null
     and name in ('Straw Curl', 'Loose Curls', 'Updos');

  update public.services set category_id = v_cuts
   where org_id = v_org and deleted_at is null
     and name in ('Trim', 'Asymmetric Pixie Cut');

  select count(*) into v_unfiled
  from public.services
  where org_id = v_org and deleted_at is null and category_id is null;

  if v_unfiled > 0 then
    raise exception '% service(s) still have no category. Nothing was left unfiled on purpose — check the names.', v_unfiled;
  end if;

  raise notice 'Every live service is filed.';
end $$;
