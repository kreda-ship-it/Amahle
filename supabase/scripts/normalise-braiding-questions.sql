-- Give every braiding service the same questions.
--
-- The braiding branch was built in two passes and ended up uneven: the eleven
-- styles created from the mind map ask the full set, while the five older
-- services adopted into the same branch — Micro Braids and the half-cornrow
-- styles — ask nothing at all.
--
-- That is not a cosmetic difference. "Which kind of hair?" only appears once
-- somebody answers "the salon provides it", so on a service that never asks
-- whose hair it is, the question can never appear and the link is dead weight.
-- Worse, a customer booking micro braids would be asked no questions and
-- quoted a flat price for a job whose length varies by five hours.
--
-- Safe to run repeatedly: it inserts only what is missing.

do $$
declare
  v_org uuid;
  c_ext uuid; c_noext uuid;
  g_boho uuid; g_size uuid; g_length uuid; g_hair uuid;
  g_col uuid; g_type uuid; g_prep uuid;
  o_salon uuid;
  v_added int;
begin
  select id into v_org from public.organizations
   where slug='kedus-hair-salon' and deleted_at is null;

  select id into c_ext   from public.service_categories where org_id=v_org and name='With extensions';
  select id into c_noext from public.service_categories where org_id=v_org and name='Without extensions';

  select id into g_boho   from public.service_option_groups where org_id=v_org and name='Boho finish';
  select id into g_size   from public.service_option_groups where org_id=v_org and name='Size';
  select id into g_length from public.service_option_groups where org_id=v_org and name='Length';
  select id into g_hair   from public.service_option_groups where org_id=v_org and name='Braiding hair';
  select id into g_col    from public.service_option_groups where org_id=v_org and name='Hair colour';
  select id into g_type   from public.service_option_groups where org_id=v_org and name='Hair type';
  select id into g_prep   from public.service_option_groups where org_id=v_org and name='Hair preparation';
  select id into o_salon  from public.service_options
   where org_id=v_org and group_id=g_hair and name='The salon provides it';

  -- With extensions: the whole set, colour and type gated on the salon
  -- providing the hair.
  insert into public.service_option_group_links
    (org_id, service_id, group_id, depends_on_option_id, display_order)
  select v_org, s.id, q.group_id, q.depends_on, q.ord
  from public.services s
  cross join (values
      (g_boho,   null::uuid, 1),
      (g_size,   null,       2),
      (g_length, null,       3),
      (g_hair,   null,       4),
      (g_col,    o_salon,    5),
      (g_type,   o_salon,    6),
      (g_prep,   null,       7)
    ) as q(group_id, depends_on, ord)
  where s.org_id = v_org and s.deleted_at is null and s.category_id = c_ext
    and not exists (
      select 1 from public.service_option_group_links l
      where l.service_id = s.id and l.group_id = q.group_id and l.deleted_at is null);

  get diagnostics v_added = row_count;
  raise notice 'with-extensions links added: %', v_added;

  -- Without extensions: no boho, and nothing about added hair, because there
  -- is none to ask about.
  insert into public.service_option_group_links
    (org_id, service_id, group_id, display_order)
  select v_org, s.id, q.group_id, q.ord
  from public.services s
  cross join (values (g_size, 1), (g_length, 2), (g_prep, 3)) as q(group_id, ord)
  where s.org_id = v_org and s.deleted_at is null and s.category_id = c_noext
    and not exists (
      select 1 from public.service_option_group_links l
      where l.service_id = s.id and l.group_id = q.group_id and l.deleted_at is null);

  get diagnostics v_added = row_count;
  raise notice 'without-extensions links added: %', v_added;
end $$;
