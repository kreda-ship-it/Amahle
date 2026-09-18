-- The rest of the mind map: branches 2 to 10, and the pieces of branch 1
-- that the fuller version of the map adds.
--
-- Second pass. seed-service-tree.sql built the categories and the braiding
-- branch; this fills in everything else. Additive — it creates what is
-- missing and adopts anything already on the menu under the same name.
--
-- EVERY PRICE AND DURATION IS STILL A GUESS.
--
-- THREE THINGS FROM THE MAP ARE NOT BUILT HERE, ON PURPOSE.
--
-- "Other → Upload Picture → Stylist Approval Required" appears in four
-- branches. That is not a service, it is a REQUEST: nobody knows its price or
-- its length, so it cannot hold a slot in a calendar where every appointment
-- holds its time the moment it exists. It needs its own table and a stylist's
-- approval turning it into a booking. Deliberately absent rather than faked.
--
-- "New Style → Continue to Hair Services" at the end of take-down is a
-- movement through the booking flow, not a row. It belongs in the funnel.
--
-- Hair Fee under "salon will provide hair" is already the price on that
-- answer, so it is not a third question.
--
-- WHERE THE MAP DISAGREES WITH THE OLD MENU, the map wins and both are kept.
-- "Blowout" and the salon's existing "Wash & Blow Dry" are the same job under
-- two names; the old one is retired with the rest of the old menu, and the
-- report at the end of this file lists every pair to settle before that day.

do $$
declare
  v_org uuid;
  -- existing categories
  c_natural uuid; c_curls uuid; c_finish uuid; c_blowout uuid; c_press uuid;
  c_ext uuid; c_wigs uuid; c_removal uuid; c_colour uuid; c_treat uuid;
  c_cuts uuid; c_consult uuid;
  -- new sub-branches
  c_sewin uuid; c_extmaint uuid;
  -- new question groups
  g_prep uuid; g_hairtype uuid; g_hair uuid; g_wiginstall uuid; g_wigcustom uuid;
  g_wigstyle uuid; g_removing uuid; g_condition uuid; g_after uuid;
  o_salon_hair uuid;
  v_service uuid;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  select id into c_natural from public.service_categories where org_id=v_org and name='Natural hair styling';
  select id into c_curls   from public.service_categories where org_id=v_org and name='Curls';
  select id into c_finish  from public.service_categories where org_id=v_org and name='Wash, straighten & finish';
  select id into c_blowout from public.service_categories where org_id=v_org and name='Wash, blowout & roller set';
  select id into c_press   from public.service_categories where org_id=v_org and name='Silk press & flat iron';
  select id into c_ext     from public.service_categories where org_id=v_org and name='Hair extensions';
  select id into c_wigs    from public.service_categories where org_id=v_org and name='Wig services';
  select id into c_removal from public.service_categories where org_id=v_org and name='Take-down & removal';
  select id into c_colour  from public.service_categories where org_id=v_org and name='Hair colour';
  select id into c_treat   from public.service_categories where org_id=v_org and name='Hair treatments';
  select id into c_cuts    from public.service_categories where org_id=v_org and name='Haircut & trim';
  select id into c_consult from public.service_categories where org_id=v_org and name='Consultation';

  if c_natural is null then
    raise exception 'Run seed-service-tree.sql and recategorise-service-tree.sql first.';
  end if;

  -- ==========================================================
  -- Branch 1 — the pieces this version of the map adds.
  -- ==========================================================
  select id into g_prep from public.service_option_groups where org_id=v_org and name='Hair preparation';
  select id into g_hair from public.service_option_groups where org_id=v_org and name='Braiding hair';
  select id into o_salon_hair from public.service_options
   where org_id=v_org and group_id=g_hair and name='The salon provides it';

  -- "Needs wash + blow-dry" is a fourth answer, and it is longer than a wash
  -- alone because the hair has to be dry before anyone can braid it.
  insert into public.service_options
    (org_id, group_id, name, description, price_delta, duration_delta_minutes, display_order)
  select v_org, g_prep, 'Not washed, and needs drying',
         'We will wash and blow it out before we start.', 0, 75, 4
  where not exists (
    select 1 from public.service_options
    where org_id=v_org and group_id=g_prep and name='Not washed, and needs drying');

  -- Hair type, asked only when the salon is providing the hair — the same
  -- condition the colour question already carries.
  select id into g_hairtype from public.service_option_groups where org_id=v_org and name='Hair type';
  if g_hairtype is null then
    insert into public.service_option_groups (org_id, name, prompt, display_order)
    values (v_org, 'Hair type', 'Which kind of hair?', 7) returning id into g_hairtype;

    insert into public.service_options
      (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_hairtype, 'Kanekalon',        0, 0, 1),
      (v_org, g_hairtype, 'Pre-stretched',   10, 0, 2),
      (v_org, g_hairtype, 'Human hair blend',35, 0, 3),
      (v_org, g_hairtype, 'Water wave',      20, 0, 4);

    insert into public.service_option_group_links
      (org_id, service_id, group_id, depends_on_option_id, display_order)
    select v_org, s.id, g_hairtype, o_salon_hair, 6
    from public.services s
    join public.service_categories c on c.id = s.category_id
    where s.org_id = v_org and s.deleted_at is null and c.name = 'With extensions';
  end if;

  -- ==========================================================
  -- Branch 2 — natural hair styling.
  -- ==========================================================
  insert into public.services
    (org_id, category_id, name, price, price_display, duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_natural, 'Wash & go',            55, 'from',  60, true, 1),
    (v_org, c_natural, 'Twist-out',            70, 'from',  90, true, 2),
    (v_org, c_natural, 'Braid-out',            70, 'from',  90, true, 3),
    (v_org, c_natural, 'Two-strand twists',    85, 'from', 120, true, 4),
    (v_org, c_natural, 'Flat twists',          75, 'from', 105, true, 5),
    (v_org, c_natural, 'Ponytail',             55, 'from',  60, true, 6),
    (v_org, c_natural, 'Bun',                  55, 'from',  60, true, 7),
    (v_org, c_natural, 'Natural hair updo',    95, 'from', 120, true, 9),
    (v_org, c_natural, 'Kids natural style',   45, 'from',  60, true, 10),
    (v_org, c_curls,   'Flexi rod set',        70, 'from',  90, true, 1),
    (v_org, c_curls,   'Curling iron',         55, 'from',  60, true, 2),
    (v_org, c_curls,   'Curling wand',         55, 'from',  60, true, 3),
    (v_org, c_curls,   'Rollers',              60, 'from',  75, true, 4)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  -- ==========================================================
  -- Branch 3 — wash, straighten, finish.
  -- ==========================================================
  insert into public.services
    (org_id, category_id, name, price, price_display, duration_minutes,
     is_bookable_online, display_order, is_included_with_others)
  values
    (v_org, c_blowout, 'Blowout',    45, 'exact', 45, true, 3, true),
    (v_org, c_blowout, 'Roller set', 50, 'exact', 60, true, 4, false),
    (v_org, c_press,   'Silk press', 85, 'from',  90, true, 1, false),
    (v_org, c_press,   'Flat iron',  60, 'from',  60, true, 2, false)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  -- ==========================================================
  -- Branch 4 — hair extensions.
  -- ==========================================================
  select id into c_sewin from public.service_categories
   where org_id=v_org and parent_id=c_ext and name='Sew-in';
  if c_sewin is null then
    insert into public.service_categories (org_id, parent_id, name, display_order)
    values (v_org, c_ext, 'Sew-in', 1) returning id into c_sewin;
  end if;

  select id into c_extmaint from public.service_categories
   where org_id=v_org and parent_id=c_ext and name='Extension maintenance';
  if c_extmaint is null then
    insert into public.service_categories (org_id, parent_id, name, display_order)
    values (v_org, c_ext, 'Extension maintenance', 2) returning id into c_extmaint;
  end if;

  insert into public.services
    (org_id, category_id, name, price, price_display, duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_sewin,    'Traditional sew-in',   150, 'from', 180, true, 1),
    (v_org, c_sewin,    'Closure sew-in',       190, 'from', 210, true, 2),
    (v_org, c_sewin,    'Frontal sew-in',       230, 'from', 240, true, 3),
    (v_org, c_ext,      'Quick weave',          110, 'from', 120, true, 3),
    (v_org, c_ext,      'Tape-in extensions',   180, 'from', 150, true, 4),
    (v_org, c_ext,      'Clip-in extensions',    65, 'from',  45, true, 5),
    (v_org, c_extmaint, 'Extension reinstall',   90, 'from', 120, true, 1),
    (v_org, c_extmaint, 'Extension touch-up',    60, 'from',  75, true, 2),
    (v_org, c_extmaint, 'Extension adjustment',  45, 'from',  45, true, 3)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  -- ==========================================================
  -- Branch 5 — wigs.
  --
  -- The map's leaves under installation and styling are QUESTIONS rather
  -- than separate services: gluing a wig on is not a different appointment
  -- from installing one, it is how this one is installed.
  -- ==========================================================
  insert into public.services
    (org_id, category_id, name, price, price_display, duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_wigs, 'Wig installation',  75, 'from',  75, true, 1),
    (v_org, c_wigs, 'Wig customization', 95, 'from', 120, true, 2),
    (v_org, c_wigs, 'Wig styling',       65, 'from',  60, true, 3),
    (v_org, c_wigs, 'Wig maintenance',   55, 'from',  60, true, 4),
    (v_org, c_wigs, 'Wig removal',       35, 'exact',  30, true, 5)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  select id into g_wiginstall from public.service_option_groups where org_id=v_org and name='Wig hold';
  if g_wiginstall is null then
    insert into public.service_option_groups (org_id, name, prompt, display_order)
    values (v_org, 'Wig hold', 'How would you like it held?', 8) returning id into g_wiginstall;
    insert into public.service_options
      (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_wiginstall, 'Glueless',        0,  0, 1),
      (v_org, g_wiginstall, 'Glue / adhesive',15, 20, 2);
    select id into v_service from public.services where org_id=v_org and name='Wig installation';
    insert into public.service_option_group_links (org_id, service_id, group_id, display_order)
    values (v_org, v_service, g_wiginstall, 1);
  end if;

  select id into g_wigcustom from public.service_option_groups where org_id=v_org and name='Wig customisation';
  if g_wigcustom is null then
    -- 'many' — a customer may want the lace cut AND the hairline plucked, and
    -- these are the first questions in the salon where that is true.
    insert into public.service_option_groups (org_id, name, prompt, selection, display_order)
    values (v_org, 'Wig customisation', 'What would you like done to it?', 'many', 9)
    returning id into g_wigcustom;
    insert into public.service_options
      (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_wigcustom, 'Lace cutting', 20, 20, 1),
      (v_org, g_wigcustom, 'Plucking',     30, 40, 2),
      (v_org, g_wigcustom, 'Styling',      25, 30, 3);
    select id into v_service from public.services where org_id=v_org and name='Wig customization';
    insert into public.service_option_group_links (org_id, service_id, group_id, display_order)
    values (v_org, v_service, g_wigcustom, 1);
  end if;

  select id into g_wigstyle from public.service_option_groups where org_id=v_org and name='Wig style';
  if g_wigstyle is null then
    insert into public.service_option_groups (org_id, name, prompt, display_order)
    values (v_org, 'Wig style', 'How would you like it styled?', 10) returning id into g_wigstyle;
    insert into public.service_options
      (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_wigstyle, 'Straight',  0,  0, 1),
      (v_org, g_wigstyle, 'Curls',    15, 20, 2),
      (v_org, g_wigstyle, 'Waves',    15, 20, 3),
      (v_org, g_wigstyle, 'Updo',     25, 30, 4);
    select id into v_service from public.services where org_id=v_org and name='Wig styling';
    insert into public.service_option_group_links (org_id, service_id, group_id, display_order)
    values (v_org, v_service, g_wigstyle, 1);
  end if;

  -- ==========================================================
  -- Branch 6 — take-down.
  --
  -- ONE service with three questions, not eight services. "Braids" and
  -- "sew-in" are not different appointments; they are the same work taking
  -- different lengths of time, which is exactly what a duration delta is for.
  -- ==========================================================
  insert into public.services
    (org_id, category_id, name, description, price, price_display,
     duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_removal, 'Take-down',
     'Removing what is in your hair now. Price and time depend on what it is and how tangled it has become.',
     35, 'from', 45, true, 1)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  select id into v_service from public.services where org_id=v_org and name='Take-down';

  select id into g_removing from public.service_option_groups where org_id=v_org and name='Removing';
  if g_removing is null then
    insert into public.service_option_groups (org_id, name, prompt, display_order)
    values (v_org, 'Removing', 'What are we taking out?', 11) returning id into g_removing;
    insert into public.service_options
      (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_removing, 'Braids',              0,  45, 1),
      (v_org, g_removing, 'Twists',              0,  30, 2),
      (v_org, g_removing, 'Cornrows',          -10, -15, 3),
      (v_org, g_removing, 'Sew-in',              5,  15, 4),
      (v_org, g_removing, 'Quick weave',         5,  15, 5),
      (v_org, g_removing, 'Tape-in extensions', 10,  30, 6),
      (v_org, g_removing, 'Clip-in extensions',-20, -30, 7),
      (v_org, g_removing, 'Wig',               -20, -30, 8);
    insert into public.service_option_group_links (org_id, service_id, group_id, display_order)
    values (v_org, v_service, g_removing, 1);
  end if;

  select id into g_condition from public.service_option_groups where org_id=v_org and name='Hair condition';
  if g_condition is null then
    insert into public.service_option_groups (org_id, name, prompt, display_order)
    values (v_org, 'Hair condition', 'How tangled is it?', 12) returning id into g_condition;
    insert into public.service_options
      (org_id, group_id, name, description, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_condition, 'Easy',     'Loose, comes out cleanly.',        0,   0, 1),
      (v_org, g_condition, 'Moderate', 'Some matting at the roots.',      15,  45, 2),
      (v_org, g_condition, 'Severe',   'Heavily matted. Bring patience.', 40, 120, 3);
    insert into public.service_option_group_links (org_id, service_id, group_id, display_order)
    values (v_org, v_service, g_condition, 2);
  end if;

  select id into g_after from public.service_option_groups where org_id=v_org and name='After removal';
  if g_after is null then
    insert into public.service_option_groups (org_id, name, prompt, selection, display_order)
    values (v_org, 'After removal', 'And afterwards?', 'many', 13) returning id into g_after;
    insert into public.service_options
      (org_id, group_id, name, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_after, 'Nothing, just the removal',  0,  0, 1),
      (v_org, g_after, 'Wash',                       0, 30, 2),
      (v_org, g_after, 'Wash and blow-dry',          0, 60, 3),
      (v_org, g_after, 'Deep conditioning',         30, 30, 4),
      (v_org, g_after, 'Detangling',                20, 45, 5),
      (v_org, g_after, 'Trim',                      20, 20, 6);
    insert into public.service_option_group_links (org_id, service_id, group_id, display_order)
    values (v_org, v_service, g_after, 3);
  end if;

  -- ==========================================================
  -- Branches 7 to 10 — colour, treatments, cuts, consultation.
  -- Flat lists. No engine needed and none added.
  -- ==========================================================
  insert into public.services
    (org_id, category_id, name, price, price_display, duration_minutes, is_bookable_online, display_order)
  values
    (v_org, c_colour, 'Full colour',              95, 'from', 120, true,  1),
    (v_org, c_colour, 'Root touch-up',            70, 'from',  90, true,  2),
    (v_org, c_colour, 'Highlights',              120, 'from', 150, true,  3),
    (v_org, c_colour, 'Lowlights',               120, 'from', 150, true,  4),
    (v_org, c_colour, 'Balayage',                160, 'from', 180, true,  5),
    (v_org, c_colour, 'Ombre',                   160, 'from', 180, true,  6),
    (v_org, c_colour, 'Fashion colour',          140, 'from', 180, true,  7),
    (v_org, c_colour, 'Colour correction',       200, 'from', 240, false, 8),

    (v_org, c_treat,  'Deep conditioning',        45, 'exact', 45, true, 1),
    (v_org, c_treat,  'Protein treatment',        55, 'exact', 60, true, 2),
    (v_org, c_treat,  'Hydration treatment',      50, 'exact', 45, true, 3),
    (v_org, c_treat,  'Scalp treatment',          55, 'exact', 45, true, 4),
    (v_org, c_treat,  'Damage repair',            75, 'from',  75, true, 5),
    (v_org, c_treat,  'Detox / clarifying',       40, 'exact', 30, true, 6),

    (v_org, c_cuts,   'Haircut',                  45, 'exact', 45, true, 1),
    (v_org, c_cuts,   'Bangs',                    25, 'exact', 20, true, 4),
    (v_org, c_cuts,   'Shape-up',                 25, 'exact', 20, true, 5),
    (v_org, c_cuts,   'Haircut and style',        75, 'from',  75, true, 6),

    (v_org, c_consult,'Hair consultation',         0, 'exact', 20, true, 1),
    (v_org, c_consult,'Colour consultation',       0, 'exact', 20, true, 2),
    (v_org, c_consult,'Extension consultation',    0, 'exact', 20, true, 3),
    (v_org, c_consult,'Wig consultation',          0, 'exact', 20, true, 4),
    (v_org, c_consult,'Braiding consultation',     0, 'exact', 20, true, 5),
    (v_org, c_consult,'Custom style consultation', 0, 'exact', 30, true, 6),
    (v_org, c_consult,'Bridal consultation',       0, 'exact', 45, true, 7)
  on conflict (org_id, name) where deleted_at is null
  do update set category_id = excluded.category_id;

  raise notice 'Full tree seeded.';
end $$;
