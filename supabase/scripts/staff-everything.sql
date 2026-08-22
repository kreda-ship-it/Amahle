-- The eight assistants by name, and somebody on every service.
--
-- Three things at once, because they are one thought: the assistant pool
-- becomes eight real people, the services nobody was on get somebody, and
-- the file refuses to finish if anything is still unstaffed.
--
-- SIMILAR WORK, SAME PEOPLE. Selam's instruction, and the rule this file
-- follows everywhere the matrix is silent. Micro braids go to whoever does
-- knotless; the half-cornrow styles go to whoever does cornrows; a braided
-- bun goes to whoever does a braided ponytail. Nothing here is a new fact
-- about the salon — it is the matrix extended along the lines the matrix
-- itself draws.
--
-- SIZE IS NOT A SERVICE. "People that do the medium size of the same braid
-- do the large size as well." That is already how this works: size is a
-- question on the style, not a style of its own, so there is nothing here
-- to assign. It is the reason Small, Medium and Large Knotless from the
-- sheet are one row rather than three.
--
-- ALL OF IT IS EDITABLE AND SOME OF IT IS WRONG. Selam said as much and
-- asked for coverage rather than precision, so the aim is that no service
-- is a dead end. Every line is one insert or one delete to correct.

do $$
declare
  v_org uuid;
  v_id uuid;
  v_row record;
  v_service uuid;
  v_emp uuid;
  v_name text;
  v_left int;
  stylists  text[] := array['Maki','Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi'];
  cornrow   text[] := array['Fikir','Ethopi','Jerry','Mekdi','Rani'];
  twists    text[] := array['Maki','Fikir','Ethopi','Mekdi','Rani','Sofi'];
  weaves    text[] := array['Maki','Fikir','Ethopi','Jerry'];
  wigs      text[] := array['Maki','Jerry'];
  straight  text[] := array['Maki','Fikir','Jerry','Mimi'];
  cuts      text[] := array['Maki','Jerry','Mekdi','Rani','Dagnu'];
  curls     text[] := array['Maki','Fikir','Jerry','Rani'];
  assist    text[] := array['Meski','Miru','Saron','Emu','Seble','Geni','Saba','Weyni'];
begin
  select id into v_org from public.organizations
   where slug='kedus-hair-salon' and deleted_at is null;

  -- ----------------------------------------------------------
  -- 1. The eight assistants, and the pool row retired.
  --
  -- One row could only ever have one take-out running at a time, so a
  -- second customer wanting one at the same hour was told there was no
  -- space when there was. Eight rows, eight parallel take-outs.
  -- ----------------------------------------------------------
  foreach v_name in array assist loop
    if not exists (select 1 from public.employees
                   where org_id=v_org and full_name=v_name and deleted_at is null) then
      insert into public.employees (org_id, full_name, position, display_order)
      values (v_org, v_name, 'Assistant', 20);
    end if;
  end loop;

  -- Everything the pool row was on passes to all eight.
  for v_row in
    select distinct es.service_id
    from public.employee_services es
    join public.employees e on e.id = es.employee_id
    where es.org_id=v_org and es.deleted_at is null and e.full_name='Salon assistant'
  loop
    foreach v_name in array assist loop
      select id into v_emp from public.employees
       where org_id=v_org and full_name=v_name and deleted_at is null;
      insert into public.employee_services (org_id, employee_id, service_id)
      select v_org, v_emp, v_row.service_id
      where not exists (select 1 from public.employee_services x
                        where x.employee_id=v_emp and x.service_id=v_row.service_id
                          and x.deleted_at is null);
    end loop;
  end loop;

  update public.employee_services es set deleted_at = now()
  from public.employees e
  where es.employee_id=e.id and es.org_id=v_org and es.deleted_at is null
    and e.full_name='Salon assistant';

  update public.employees set deleted_at=now(), is_active=false, is_bookable=false
   where org_id=v_org and full_name='Salon assistant' and deleted_at is null;

  -- Working hours, one day off each, spread across the week so the salon
  -- is never short of washing hands two days running.
  for v_row in
    select name, (row_number() over ()) % 7 as day_off
    from unnest(assist) as t(name)
  loop
    select id into v_id from public.employees
     where org_id=v_org and full_name=v_row.name and deleted_at is null;
    insert into public.employee_working_hours (org_id, employee_id, day_of_week, start_time, end_time)
    select v_org, v_id, d, '09:00'::time,
           case when d=0 then '17:00'::time else '19:00'::time end
    from generate_series(0,6) as d
    where d <> v_row.day_off
      and not exists (select 1 from public.employee_working_hours wh
                      where wh.employee_id=v_id and wh.day_of_week=d and wh.deleted_at is null);
  end loop;

  -- ----------------------------------------------------------
  -- 2. Everybody else onto everything else.
  -- ----------------------------------------------------------
  create temporary table _fill (service_name text, staff text[]) on commit drop;

  insert into _fill values
    -- Braiding, by likeness to what is already on the matrix -----------
    ('Micro Braids',                          stylists),
    ('French curls',                          stylists),
    ('Individual braids on natural hair',     stylists),
    ('Braided Bun',                           array['Fikir','Ethopi','Jerry','Mekdi']),
    ('Half Cornrows Half Individual Braids',  cornrow),
    ('Half Cornrows Half Afro',               cornrow),
    ('Circle Half Cornrows Half Curls',       cornrow),
    ('Wave Half Cornrows Half Indiv. Braids', cornrow),

    -- Natural hair. The assistants are on the simple ones because they
    -- already wash and blow-dry, and Selam says they do kids' hair.
    ('Wash & go',            twists || assist),
    ('Twist-out',            twists),
    ('Braid-out',            twists),
    ('Two-strand twists',    twists),
    ('Flat twists',          twists),
    ('Ponytail',             array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi'] || assist),
    ('Bun',                  array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi'] || assist),
    ('Updos',                array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi']),
    ('Natural hair updo',    array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi']),
    ('Straw Curl',           curls),
    ('Loose Curls',          curls),
    ('Curling iron',         curls),
    ('Curling wand',         curls),
    ('Rollers',              curls || assist),

    -- Colour. Selam: the assistants do retouches, Maki does highlights.
    -- The rest of the colour work follows Maki, who is the only person
    -- named as doing any of it.
    ('Retouch Color',        array['Maki'] || assist),
    ('Highlight (Foil)',     array['Maki']),
    ('Full Hair Color',      array['Maki']),
    ('Lowlights',            array['Maki']),
    ('Balayage',             array['Maki']),
    ('Ombre',                array['Maki']),
    ('Fashion colour',       array['Maki']),
    ('Colour correction',    array['Maki']),

    -- Treatments — Selam: by staff.
    ('Conditioning',         assist),
    ('Protein treatment',    assist),
    ('Hydration treatment',  assist),
    ('Scalp treatment',      assist),
    ('Damage repair',        assist),
    ('Detox / clarifying',   assist),

    -- Relaxers sit with straightening, which is the same chemistry and
    -- the same people.
    ('Virgin Relaxer',       straight),
    ('Retouch Relaxer',      straight),

    -- Wigs and extensions follow their matrix rows.
    ('Wig customization',    wigs),
    ('Wig maintenance',      wigs),
    ('Wig removal',          wigs || assist),
    ('Extension reinstall',  weaves),
    ('Extension touch-up',   weaves),
    ('Extension adjustment', weaves),

    -- Cuts follow Hair Trim, plus Dagnu.
    ('Women''s Haircut',     cuts),
    ('Asymmetric Pixie Cut', cuts),
    ('Bangs',                cuts),
    ('Haircut and style',    cuts),

    -- Consultations: the owners and the two most broadly skilled stylists.
    ('Hair consultation',         array['Maki','Fikir','Dagnu','Mimi']),
    ('Colour consultation',       array['Maki','Mimi']),
    ('Extension consultation',    array['Maki','Jerry']),
    ('Wig consultation',          array['Maki','Jerry']),
    ('Braiding consultation',     array['Fikir','Ethopi','Mekdi']),
    ('Custom style consultation', array['Maki','Fikir','Dagnu','Mimi']),
    ('Bridal consultation',       array['Maki','Fikir','Mimi']),

    -- Kids' work, which Selam says the assistants share.
    ('Kids braiding',        array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi'] || assist),
    ('Kids natural style',   array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi'] || assist);

  for v_row in select * from _fill loop
    select id into v_service from public.services
     where org_id=v_org and name=v_row.service_name and deleted_at is null;
    if v_service is null then
      raise exception 'No live service called "%".', v_row.service_name;
    end if;

    foreach v_name in array v_row.staff loop
      select id into v_emp from public.employees
       where org_id=v_org and full_name=v_name and deleted_at is null;
      if v_emp is null then
        raise exception 'No employee called "%".', v_name;
      end if;
      insert into public.employee_services (org_id, employee_id, service_id)
      select v_org, v_emp, v_service
      where not exists (select 1 from public.employee_services x
                        where x.employee_id=v_emp and x.service_id=v_service
                          and x.deleted_at is null);
    end loop;
  end loop;

  -- ----------------------------------------------------------
  -- 3. The guard. A service nobody performs offers no times and looks
  --    broken to a customer, so the whole file rolls back rather than
  --    leaving one behind.
  -- ----------------------------------------------------------
  select count(*) into v_left
  from public.services s
  where s.org_id=v_org and s.deleted_at is null
    and not exists (select 1 from public.employee_services es
                    where es.service_id=s.id and es.deleted_at is null);

  if v_left > 0 then
    raise exception '% service(s) still have nobody able to perform them.', v_left;
  end if;

  raise notice 'Everything is staffed.';
end $$;
