-- Pin the order of the braiding questions.
--
-- The branch was built across three scripts and two of them handed out the
-- same position: "hair preparation" and "hair type" both sat at 6, so which
-- came first was down to however Postgres felt like returning them. It showed
-- up as "which kind of hair?" being asked after "how will your hair arrive?",
-- with the colour question stranded three steps from the answer that opens it.
--
-- Colour and hair type belong immediately after "whose hair are we using?",
-- because both are questions ABOUT that hair. Splitting them means asking
-- somebody to remember, two screens later, what they answered.
--
-- Set explicitly rather than nudged, so the order is a stated fact rather
-- than an accident that happens to look right today.

do $$
declare
  v_org uuid;
  c_ext uuid; c_noext uuid;
begin
  select id into v_org from public.organizations
   where slug='kedus-hair-salon' and deleted_at is null;
  select id into c_ext   from public.service_categories where org_id=v_org and name='With extensions';
  select id into c_noext from public.service_categories where org_id=v_org and name='Without extensions';

  update public.service_option_group_links l
  set display_order = v.ord
  from public.service_option_groups g,
       (values
          ('Boho finish',      1),
          ('Size',             2),
          ('Length',           3),
          ('Braiding hair',    4),
          ('Hair colour',      5),
          ('Hair type',        6),
          ('Hair preparation', 7),
          ('Add-ons',          8)
       ) as v(gname, ord),
       public.services s
  where l.group_id = g.id
    and g.name = v.gname
    and l.service_id = s.id
    and s.category_id = c_ext
    and l.org_id = v_org
    and l.deleted_at is null;

  update public.service_option_group_links l
  set display_order = v.ord
  from public.service_option_groups g,
       (values
          ('Size',             1),
          ('Length',           2),
          ('Hair preparation', 3),
          ('Add-ons',          4)
       ) as v(gname, ord),
       public.services s
  where l.group_id = g.id
    and g.name = v.gname
    and l.service_id = s.id
    and s.category_id = c_noext
    and l.org_id = v_org
    and l.deleted_at is null;

  raise notice 'Question order pinned.';
end $$;
