-- Where the mind map and the salon's own menu name the same job twice, keep
-- the salon's name and retire the map's.
--
-- Seeding the full map created eight services the salon already offers under
-- different names. A blowout and a "Wash & Blow Dry" are one job; so are
-- "Full colour" and "Full Hair Color". Two rows for one job is how a price
-- list ends up disagreeing with itself.
--
-- The SALON'S names win. They are what is on the wall, what the staff say on
-- the phone, and what returning customers look for. The map was a plan for
-- the shape of the menu, not for its wording.
--
-- Soft-delete, per the project rule — deleted_at, never DELETE. These rows
-- have never been booked against, but the rule does not have an exception for
-- that and does not need one: a soft-deleted service disappears from every
-- policy the public site reads through, and its name is freed, because the
-- unique index on (org_id, name) only covers live rows. So if Selam later
-- decides she prefers "Blowout" after all, renaming the surviving service is
-- a one-line update rather than an argument with a constraint.

do $$
declare
  v_org uuid;
  v_gone int;
  v_kept text;
  v_pair record;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  -- Each pair is (the map's name to retire, the salon's name that stays).
  -- The survivor is checked to exist before anything is retired, so a typo
  -- cannot leave the menu with neither.
  for v_pair in
    select * from (values
      ('Blowout',            'Wash & Blow Dry'),
      ('Roller set',         'Wash & Set'),
      ('Flat iron',          'Wash & Set with Flat Iron'),
      ('Full colour',        'Full Hair Color'),
      ('Root touch-up',      'Retouch Color'),
      ('Highlights',         'Highlight (Foil)'),
      ('Deep conditioning',  'Conditioning'),
      ('Haircut',            'Women''s Haircut')
    ) as t(retire, keep)
  loop
    select name into v_kept
    from public.services
    where org_id = v_org and name = v_pair.keep and deleted_at is null;

    if v_kept is null then
      raise exception 'Cannot retire "%": the service meant to replace it, "%", is not on the menu.',
        v_pair.retire, v_pair.keep;
    end if;

    update public.services
    set deleted_at = now()
    where org_id = v_org and name = v_pair.retire and deleted_at is null;
  end loop;

  select count(*) into v_gone
  from public.services
  where org_id = v_org and deleted_at is not null;

  raise notice 'Retired %; the salon''s own names stand.', v_gone;
end $$;
