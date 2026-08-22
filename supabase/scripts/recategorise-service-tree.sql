-- Second pass on the tree: sub-branches that match the mind map, and the
-- old menu moved into them.
--
-- NOT a migration, and nothing is deleted. file-existing-services.sql was a
-- first pass that got everything filed and left three things crude:
--
--   * seven old braiding services sat on "Braiding" itself rather than under
--     with- or without-extensions, because the database does not record which
--     use added hair
--   * "Wash, straighten & finish" and "Natural hair styling" were flat, where
--     the mind map has sub-branches inside both
--   * relaxers sat under treatments, which is where they landed rather than
--     where they belong
--
-- The mind map's own shape is followed wherever it has one. Where the salon
-- offers something the mind map does not mention — relaxers — a branch is
-- added rather than the service being forced into a heading that lies about
-- what it is.
--
-- TWO GUESSES ARE MARKED BELOW. Both are about whether a style uses added
-- hair, both are the common answer rather than the certain one, and both are
-- one update statement to correct once Selam says.

do $$
declare
  v_org uuid;
  c_braiding uuid; c_ext uuid; c_noext uuid;
  c_natural  uuid; c_curls uuid;
  c_finish   uuid; c_blowout uuid; c_press uuid; c_relaxer uuid;
  c_treat    uuid;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  select id into c_braiding from public.service_categories
   where org_id = v_org and parent_id is null and name = 'Braiding';
  select id into c_ext      from public.service_categories
   where org_id = v_org and parent_id = c_braiding and name = 'With extensions';
  select id into c_noext    from public.service_categories
   where org_id = v_org and parent_id = c_braiding and name = 'Without extensions';
  select id into c_natural  from public.service_categories
   where org_id = v_org and name = 'Natural hair styling';
  select id into c_finish   from public.service_categories
   where org_id = v_org and name = 'Wash, straighten & finish';
  select id into c_treat    from public.service_categories
   where org_id = v_org and name = 'Hair treatments';

  if c_ext is null then
    raise exception 'The braiding branches are missing. Run seed-service-tree.sql first.';
  end if;

  -- ----------------------------------------------------------
  -- 1. The sub-branches the mind map has and the tree did not.
  --
  -- Written so the script can be run twice without making duplicates: each
  -- one is created only if it is not already there.
  -- ----------------------------------------------------------
  select id into c_curls from public.service_categories
   where org_id = v_org and parent_id = c_natural and name = 'Curls';
  if c_curls is null then
    insert into public.service_categories (org_id, parent_id, name, display_order)
    values (v_org, c_natural, 'Curls', 1) returning id into c_curls;
  end if;

  select id into c_blowout from public.service_categories
   where org_id = v_org and parent_id = c_finish and name = 'Wash, blowout & roller set';
  if c_blowout is null then
    insert into public.service_categories (org_id, parent_id, name, display_order)
    values (v_org, c_finish, 'Wash, blowout & roller set', 1) returning id into c_blowout;
  end if;

  select id into c_press from public.service_categories
   where org_id = v_org and parent_id = c_finish and name = 'Silk press & flat iron';
  if c_press is null then
    insert into public.service_categories (org_id, parent_id, name, display_order)
    values (v_org, c_finish, 'Silk press & flat iron', 2) returning id into c_press;
  end if;

  -- Not in the mind map. A relaxer is chemical straightening — it is not a
  -- treatment, and it is not heat styling either. It sits under straightening
  -- as its own branch rather than being filed somewhere that misdescribes it.
  select id into c_relaxer from public.service_categories
   where org_id = v_org and parent_id = c_finish and name = 'Relaxer';
  if c_relaxer is null then
    insert into public.service_categories (org_id, parent_id, name, display_order)
    values (v_org, c_finish, 'Relaxer', 3) returning id into c_relaxer;
  end if;

  -- ----------------------------------------------------------
  -- 2. The old braiding services, split by whether hair is added.
  -- ----------------------------------------------------------

  -- Certain. Micro braids and the half-cornrow styles are built with added
  -- hair; that is what makes them those styles.
  update public.services set category_id = c_ext
   where org_id = v_org and deleted_at is null
     and name in ('Micro Braids',
                  'Half Cornrows Half Individual Braids',
                  'Wave Half Cornrows Half Indiv. Braids');

  -- Certain the other way. "Half afro" is the customer's own hair left out,
  -- and a bun is made from what is already on the head.
  update public.services set category_id = c_noext
   where org_id = v_org and deleted_at is null
     and name in ('Half Cornrows Half Afro', 'Braided Bun');

  -- GUESS — ask Selam. A braided ponytail is usually built with added hair
  -- for length and thickness, and is occasionally not. Common answer taken.
  update public.services set category_id = c_ext
   where org_id = v_org and deleted_at is null
     and name = 'Braided Ponytail';

  -- GUESS — ask Selam. "Half curls" reads as curly hair added at the ends,
  -- which needs extensions; it could equally be the customer's own curls.
  update public.services set category_id = c_ext
   where org_id = v_org and deleted_at is null
     and name = 'Circle Half Cornrows Half Curls';

  -- ----------------------------------------------------------
  -- 3. Everything else into its proper branch.
  -- ----------------------------------------------------------
  update public.services set category_id = c_curls
   where org_id = v_org and deleted_at is null
     and name in ('Straw Curl', 'Loose Curls');

  update public.services set category_id = c_blowout
   where org_id = v_org and deleted_at is null
     and name in ('Wash & Blow Dry', 'Wash & Set');

  update public.services set category_id = c_press
   where org_id = v_org and deleted_at is null
     and name = 'Wash & Set with Flat Iron';

  update public.services set category_id = c_relaxer
   where org_id = v_org and deleted_at is null
     and name in ('Virgin Relaxer', 'Retouch Relaxer');

  -- Conditioning stays a treatment, which is what it is.
  update public.services set category_id = c_treat
   where org_id = v_org and deleted_at is null
     and name = 'Conditioning';

  -- ----------------------------------------------------------
  -- 4. Two branches must end up empty of services.
  --
  -- A service sitting directly under "Braiding" when "With extensions" and
  -- "Without" exist beneath it is exactly the state this script was written
  -- to clear, and the same is true of the straightening heading. If one
  -- survives, a name above is wrong and the whole thing rolls back rather
  -- than finishing half done.
  --
  -- "Natural hair styling" is deliberately NOT in this check. The mind map
  -- lists Ponytail, Bun and Updo directly under it AND gives it a Curls
  -- branch underneath — a heading may hold both, and Updos belongs on it.
  -- ----------------------------------------------------------
  if exists (
    select 1 from public.services
    where org_id = v_org and deleted_at is null
      and category_id in (c_braiding, c_finish)
  ) then
    raise exception 'A service is still sitting on a parent category. Check the names in this file against the menu.';
  end if;

  raise notice 'Re-categorised.';
end $$;
