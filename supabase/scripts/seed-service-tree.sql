-- Kedus's service tree — the categories, and the braiding branch in full.
--
-- NOT a migration. Migration 027 built the shapes, which every salon gets.
-- This is one salon's content, so it lives here beside seed-kedus.sql for the
-- same reason that file does.
--
-- EVERY PRICE AND EVERY DURATION BELOW IS A GUESS. They are shaped like real
-- numbers so the engine can be built and seen working; they are not Selam's
-- numbers and must not be shown to a customer. Correcting them later is an
-- update statement, not a rebuild — that is the point of keeping them in rows
-- rather than in code.
--
-- WHAT IS AND IS NOT HERE. All ten categories from the mind map, and the
-- braiding branch complete: its styles, the questions each one asks, and the
-- answers with what they add. The other nine categories are created empty and
-- filled in a later pass — they are flat lists that need no engine, and doing
-- them now would bury the part that does.
--
-- Runs once. It refuses if a tree already exists, rather than quietly making a
-- second one. To start over:
--
--   delete from public.service_option_group_links where org_id = <org>;
--   delete from public.service_options where org_id = <org>;
--   delete from public.service_option_groups where org_id = <org>;
--   update public.services set category_id = null where org_id = <org>;
--   delete from public.service_categories where org_id = <org>;
--
-- (Hard deletes, and legitimately so: nothing here has been booked against.
-- Once a real appointment references an option, soft-delete only.)

do $$
declare
  v_org uuid;

  -- Categories
  c_braiding      uuid;  c_braid_ext   uuid;  c_braid_noext uuid;
  c_natural       uuid;  c_finish      uuid;  c_extensions  uuid;
  c_wigs          uuid;  c_removal     uuid;  c_colour      uuid;
  c_treatments    uuid;  c_cuts        uuid;  c_consult     uuid;

  -- Question groups
  g_boho   uuid;  g_size uuid;  g_length uuid;
  g_hair   uuid;  g_col  uuid;  g_prep   uuid;

  -- The one answer another question depends on
  o_salon_hair uuid;

  -- Services, as they are created
  v_service uuid;
  v_ext_services uuid[] := '{}';
  v_nat_services uuid[] := '{}';
begin
  select id into v_org
  from public.organizations
  where slug = 'kedus-hair-salon' and deleted_at is null;

  if v_org is null then
    raise exception 'No live organization with slug kedus-hair-salon.';
  end if;

  if exists (select 1 from public.service_categories
             where org_id = v_org and deleted_at is null) then
    raise exception
      'A service tree already exists for this organization. Clear it first — see the header of this file.';
  end if;

  -- ----------------------------------------------------------
  -- 1. The ten headings, in the order the mind map has them.
  -- ----------------------------------------------------------
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Braiding',                 1) returning id into c_braiding;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Natural hair styling',     2) returning id into c_natural;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Wash, straighten & finish',3) returning id into c_finish;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Hair extensions',          4) returning id into c_extensions;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Wig services',             5) returning id into c_wigs;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Take-down & removal',      6) returning id into c_removal;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Hair colour',              7) returning id into c_colour;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Hair treatments',          8) returning id into c_treatments;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Haircut & trim',           9) returning id into c_cuts;
  insert into public.service_categories (org_id, name, display_order) values
    (v_org, 'Consultation',            10) returning id into c_consult;

  -- The first question in the mind map — "do you want extensions?" — is two
  -- branches rather than a question, because the two lead to different lists
  -- of styles. A branch you can see beats a question you have to answer.
  insert into public.service_categories (org_id, parent_id, name, display_order) values
    (v_org, c_braiding, 'With extensions',    1) returning id into c_braid_ext;
  insert into public.service_categories (org_id, parent_id, name, display_order) values
    (v_org, c_braiding, 'Without extensions', 2) returning id into c_braid_noext;

  -- ----------------------------------------------------------
  -- 2. The questions.
  --
  -- Written once here and attached to eleven styles below. That is the whole
  -- reason they are rows: "what size?" is the same question for knotless
  -- braids and for twists, and typing it twice is how two versions of it end
  -- up in the database saying slightly different things.
  -- ----------------------------------------------------------
  insert into public.service_option_groups (org_id, name, prompt, display_order) values
    (v_org, 'Boho finish',     'Would you like a boho or curly finish?', 1)
    returning id into g_boho;
  insert into public.service_option_groups (org_id, name, prompt, display_order) values
    (v_org, 'Size',            'What size would you like?',              2)
    returning id into g_size;
  insert into public.service_option_groups (org_id, name, prompt, display_order) values
    (v_org, 'Length',          'How long would you like it?',            3)
    returning id into g_length;
  insert into public.service_option_groups (org_id, name, prompt, display_order) values
    (v_org, 'Braiding hair',   'Whose braiding hair are we using?',      4)
    returning id into g_hair;
  insert into public.service_option_groups (org_id, name, prompt, display_order) values
    (v_org, 'Hair colour',     'Which colour?',                          5)
    returning id into g_col;
  insert into public.service_option_groups (org_id, name, prompt, display_order) values
    (v_org, 'Hair preparation','How will your hair arrive?',             6)
    returning id into g_prep;

  -- ----------------------------------------------------------
  -- 3. The answers, and what each one adds.
  --
  -- Medium size and mid-back length are the baseline, both zero, and the base
  -- price of every style is quoted for that combination. Smaller and longer
  -- add; bigger and shorter subtract. That is why migration 027 allows a
  -- negative delta — the alternative is to price every style at its cheapest
  -- possible version, which reads as a lie on a price list.
  -- ----------------------------------------------------------
  insert into public.service_options
    (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
    (v_org, g_boho, 'No, plain',        0,   0, 1),
    (v_org, g_boho, 'Light',           30,  45, 2),
    (v_org, g_boho, 'Medium',          50,  75, 3),
    (v_org, g_boho, 'Full',            80, 120, 4),

    (v_org, g_size, 'Small',           60, 150, 1),
    (v_org, g_size, 'Medium',           0,   0, 2),
    (v_org, g_size, 'Medium-big',     -20, -45, 3),
    (v_org, g_size, 'Large',          -40, -90, 4),

    (v_org, g_length, 'Shoulder',     -30, -45, 1),
    (v_org, g_length, 'Mid-back',       0,   0, 2),
    (v_org, g_length, 'Waist',         40,  60, 3),
    (v_org, g_length, 'Extra long',    80, 120, 4);

  -- The hair question, and the one answer that opens another question.
  insert into public.service_options
    (org_id, group_id, name, description, price_delta, duration_delta_minutes, display_order) values
    (v_org, g_hair, 'I will bring my own',
     'Bring it with you to the appointment.', 0, 0, 1);

  insert into public.service_options
    (org_id, group_id, name, description, price_delta, duration_delta_minutes, display_order) values
    (v_org, g_hair, 'The salon provides it',
     'Hair is charged on top of the style.', 35, 0, 2)
    returning id into o_salon_hair;

  insert into public.service_options
    (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
    (v_org, g_col, 'Natural black',        0, 0, 1),
    (v_org, g_col, 'Off black / brown',    0, 0, 2),
    (v_org, g_col, 'Honey / caramel',     10, 0, 3),
    (v_org, g_col, 'Burgundy',            10, 0, 4),
    (v_org, g_col, 'Blonde',              15, 0, 5),
    (v_org, g_col, 'Grey / silver',       15, 0, 6);

  -- Preparation costs TIME and never money.
  --
  -- "Not washed" adds forty-five minutes and nothing to the bill, which is the
  -- salon's own rule about the wash being included with other work — expressed
  -- here as minutes, where it belongs. Booking Wash & Blow Dry as a service in
  -- its own right is the other way to say the same thing, and the flag on that
  -- service handles it. Both are real customer paths; neither is a special case
  -- in code.
  insert into public.service_options
    (org_id, group_id, name, description, price_delta, duration_delta_minutes, display_order) values
    (v_org, g_prep, 'Clean and stretched',
     'Washed, dried and stretched before you come.',                 0,  0, 1),
    (v_org, g_prep, 'Clean, not stretched',
     'We will stretch it here.',                                     0, 30, 2),
    (v_org, g_prep, 'Not washed',
     'We will wash and dry it as part of your appointment.',         0, 45, 3);

  -- ----------------------------------------------------------
  -- 4. The braiding styles.
  --
  -- `on conflict ... do update` rather than plain insert, so a name that
  -- already exists in the menu is ADOPTED into the tree rather than
  -- duplicated. Prices and durations of an existing service are left alone —
  -- those may be real, and the numbers in this file are not.
  -- ----------------------------------------------------------
  insert into public.services
    (org_id, category_id, name, description, price, price_display,
     duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_braid_ext, 'Knotless braids',
     'Individual braids fed in from the root, no knot at the scalp.',
     220, 'from', 360, true, 1),
    (v_org, c_braid_ext, 'Cornrows with extensions',
     'Braided flat to the scalp, lengthened with hair.',
     120, 'from', 180, true, 2),
    (v_org, c_braid_ext, 'Fulani braids',
     'Cornrowed front with individual braids through the rest.',
     180, 'from', 300, true, 3),
    (v_org, c_braid_ext, 'Twists with extensions',
     'Two-strand twists with hair added.',
     200, 'from', 330, true, 4),
    (v_org, c_braid_ext, 'Boho braids',
     'Braids left loose and curly through the length.',
     260, 'from', 420, true, 5),
    (v_org, c_braid_ext, 'French curls',
     'Braided to the ends and finished with soft curls.',
     240, 'from', 390, true, 6),
    (v_org, c_braid_ext, 'Ethiopian traditional braids',
     'Albaso, shuruba and the styles they are built from.',
     150, 'from', 240, true, 7)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  insert into public.services
    (org_id, category_id, name, description, price, price_display,
     duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_braid_noext, 'Individual braids on natural hair',
     'Your own hair, braided without anything added.',
     90, 'from', 150, true, 1),
    (v_org, c_braid_noext, 'Twists on natural hair',
     'Two-strand twists in your own hair.',
     80, 'from', 120, true, 2),
    (v_org, c_braid_noext, 'Cornrows on natural hair',
     'Braided flat to the scalp, your own hair.',
     60, 'from',  90, true, 3),
    (v_org, c_braid_noext, 'Kids braiding',
     'For children. Shorter appointment, gentler on the scalp.',
     55, 'from',  90, true, 4)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  -- ----------------------------------------------------------
  -- 5. Wash & Blow Dry — the service the salon's pricing rule is about.
  --
  -- Already on the menu, so it is updated rather than created: filed under
  -- the finishing category and flagged as included alongside other work.
  -- Its forty-five minutes still count. See migration 027.
  -- ----------------------------------------------------------
  update public.services
  set category_id = c_finish,
      is_included_with_others = true
  where org_id = v_org
    and name = 'Wash & Blow Dry'
    and deleted_at is null;

  -- ----------------------------------------------------------
  -- 6. Which styles ask which questions.
  --
  -- With extensions: everything. Without: no boho, and no question about
  -- whose hair, because there is no added hair to ask about.
  --
  -- The colour question carries depends_on_option_id, so it is asked only
  -- after somebody says the salon is providing the hair. Nobody is asked to
  -- pick a colour for hair they are bringing themselves.
  -- ----------------------------------------------------------
  select array_agg(id) into v_ext_services
  from public.services where org_id = v_org and category_id = c_braid_ext;

  select array_agg(id) into v_nat_services
  from public.services where org_id = v_org and category_id = c_braid_noext;

  foreach v_service in array v_ext_services loop
    insert into public.service_option_group_links
      (org_id, service_id, group_id, depends_on_option_id, display_order) values
      (v_org, v_service, g_boho,   null,         1),
      (v_org, v_service, g_size,   null,         2),
      (v_org, v_service, g_length, null,         3),
      (v_org, v_service, g_hair,   null,         4),
      (v_org, v_service, g_col,    o_salon_hair, 5),
      (v_org, v_service, g_prep,   null,         6);
  end loop;

  foreach v_service in array v_nat_services loop
    insert into public.service_option_group_links
      (org_id, service_id, group_id, display_order) values
      (v_org, v_service, g_size,   1),
      (v_org, v_service, g_length, 2),
      (v_org, v_service, g_prep,   3);
  end loop;

  raise notice 'Seeded % categories, % questions, % answers.',
    (select count(*) from public.service_categories where org_id = v_org),
    (select count(*) from public.service_option_groups where org_id = v_org),
    (select count(*) from public.service_options where org_id = v_org);
end $$;
