-- Add-ons: the last question in the braiding flow.
--
-- WHAT IS AN ADD-ON AND WHAT IS A SERVICE.
--
-- This is the line that matters, and it is easy to put in the wrong place.
-- Both mechanisms can bolt something extra onto a booking, so the test is not
-- "is it extra" — it is:
--
--   Could a DIFFERENT PERSON do it, or could it be booked on its own?
--
-- If yes, it is a SERVICE and belongs in the visit alongside the braiding —
-- added with the + button, given its own row, and free to be performed by
-- somebody else. A wash and blow-dry is the clearest case: the salon has
-- washers who are not stylists (DECISIONS #32), and it is booked alone every
-- day. Deep conditioning and take-down are the same.
--
-- If no — if it only exists as part of this style, done by the same hands, in
-- the same sitting — it is an ADD-ON and belongs here. Beads go in while the
-- braid is being made. They are not an appointment.
--
-- Getting this wrong in the other direction is worse than it looks: a wash
-- modelled as an add-on could never be given to a washer, and the salon's
-- most common visit would go back to occupying a braider for forty-five
-- minutes of work she was not needed for.
--
-- Prices and times are guesses, like everything else in the tree.

do $$
declare
  v_org uuid;
  c_ext uuid; c_noext uuid;
  g_addons uuid;
  v_n int;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  select id into c_ext   from public.service_categories where org_id=v_org and name='With extensions';
  select id into c_noext from public.service_categories where org_id=v_org and name='Without extensions';

  select id into g_addons from public.service_option_groups where org_id=v_org and name='Add-ons';

  if g_addons is null then
    -- 'many', and not required. Somebody who wants nothing extra should be
    -- able to walk past this question rather than answer it — it is the last
    -- thing between them and a time, and every required question there is a
    -- place a booking leaks.
    insert into public.service_option_groups
      (org_id, name, prompt, selection, is_required, display_order)
    values (v_org, 'Add-ons', 'Anything to finish it off?', 'many', false, 14)
    returning id into g_addons;

    insert into public.service_options
      (org_id, group_id, name, description, price_delta, duration_delta_minutes, display_order) values
      (v_org, g_addons, 'Beads or cuffs',
       'Threaded in as the braids are made.',                15, 20, 1),
      (v_org, g_addons, 'Curled ends',
       'Ends set in hot water and curled.',                  20, 30, 2),
      (v_org, g_addons, 'Edge styling',
       'Baby hairs laid and finished.',                      10, 15, 3),
      (v_org, g_addons, 'Scalp oil treatment',
       'Oiled and massaged through before we start.',        15, 15, 4),
      (v_org, g_addons, 'Hair jewellery',
       'Rings and cuffs, your own or ours.',                 20, 25, 5);
  end if;

  -- Last in both braiding branches, after preparation. Somebody who has
  -- already chosen a style, a size, a length and how their hair arrives is
  -- exactly the person who might want beads; asking earlier would be asking
  -- before they have pictured the thing.
  insert into public.service_option_group_links
    (org_id, service_id, group_id, display_order)
  select v_org, s.id, g_addons,
         case when s.category_id = c_ext then 8 else 4 end
  from public.services s
  where s.org_id = v_org and s.deleted_at is null
    and s.category_id in (c_ext, c_noext)
    and not exists (
      select 1 from public.service_option_group_links l
      where l.service_id = s.id and l.group_id = g_addons and l.deleted_at is null);

  get diagnostics v_n = row_count;
  raise notice 'Add-ons attached to % braiding services.', v_n;
end $$;
