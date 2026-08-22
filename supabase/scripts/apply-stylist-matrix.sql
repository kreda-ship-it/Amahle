-- Who performs what, from Selam's stylist matrix.
--
-- The sheet is the authority. Every assignment for the services named below
-- is REPLACED by what the matrix says — assignments not on it are withdrawn,
-- because a stylist matrix that only ever adds is not a matrix, it is a
-- wishlist.
--
-- MAPPED ONTO THE EXISTING MENU, not the other way round. Where the sheet
-- names something the menu does not have, nothing is invented; it is listed
-- for Selam instead. Where the menu splits something the sheet treats as one
-- job — three kinds of sew-in, cornrows with and without extensions — the
-- same people go on all of them, because it is one skill.
--
-- FOUR JUDGEMENTS ARE MARKED IN THE FILE. Say the word and any of them
-- becomes one line different.

do $$
declare
  v_org uuid;
  v_row record;
  v_service uuid;
  v_emp uuid;
  v_name text;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  create temporary table _matrix (service_name text, staff text[]) on commit drop;

  insert into _matrix (service_name, staff) values
    -- Braids ---------------------------------------------------------
    ('Knotless braids',              array['Maki','Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi']),
    ('Boho braids',                  array['Maki','Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi']),
    ('Fulani braids',                array['Fikir','Ethopi','Jerry','Mekdi','Rani']),
    ('Cornrows with extensions',     array['Fikir','Ethopi','Jerry','Mekdi','Rani']),
    -- JUDGEMENT: the sheet says "Cornrows" once. The menu has two rows,
    -- with and without extensions. Same skill, same people.
    ('Cornrows on natural hair',     array['Fikir','Ethopi','Jerry','Mekdi','Rani']),
    ('Kids braiding',                array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi']),
    ('Braided Ponytail',             array['Fikir','Ethopi','Jerry','Mekdi']),
    ('Ethiopian traditional braids', array['Fikir','Mekdi']),
    -- JUDGEMENT: the sheet lists Passion, Senegalese, Marley and Kinki
    -- twists separately and gives all four the SAME seven answers. The menu
    -- has one twists row, so it takes that shared answer.
    ('Twists with extensions',       array['Maki','Fikir','Ethopi','Mekdi','Rani','Sofi']),
    ('Twists on natural hair',       array['Maki','Fikir','Ethopi','Mekdi','Rani','Sofi']),

    -- Wash, straighten, finish ---------------------------------------
    ('Wash & Blow Dry',              array['Maki','Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi','Salon assistant','Mimi']),
    ('Wash & Set',                   array['Maki','Fikir','Jerry','Salon assistant']),
    ('Flexi rod set',                array['Maki','Fikir','Salon assistant']),
    ('Silk press',                   array['Maki','Fikir','Jerry','Mimi']),
    -- JUDGEMENT: the sheet's "Straightening" is the menu's flat-iron row.
    ('Wash & Set with Flat Iron',    array['Maki','Fikir','Jerry','Mimi']),

    -- Extensions and wigs --------------------------------------------
    -- JUDGEMENT: the sheet says "Sew-In" once; the menu has three kinds.
    ('Traditional sew-in',           array['Maki','Fikir','Ethopi','Jerry']),
    ('Closure sew-in',               array['Maki','Fikir','Ethopi','Jerry']),
    ('Frontal sew-in',               array['Maki','Fikir','Ethopi','Jerry']),
    ('Quick weave',                  array['Maki','Fikir','Ethopi','Jerry']),
    ('Wig installation',             array['Maki','Jerry']),
    ('Wig styling',                  array['Maki','Jerry']),
    ('Tape-in extensions',           array['Maki','Fikir','Jerry']),
    ('Clip-in extensions',           array['Maki','Jerry']),

    -- Take-down ------------------------------------------------------
    -- The sheet lists four take-outs and gives every one of them to Staff
    -- alone. The menu has ONE take-down service with a question asking what
    -- is being removed, so all four land here.
    ('Take-down',                    array['Salon assistant']),

    -- Cuts and kids --------------------------------------------------
    -- JUDGEMENT: Fikir's Hair Trim cell is blank on the sheet, neither Y nor
    -- N, so Fikir is left OFF rather than guessed onto it.
    ('Trim',                         array['Maki','Jerry','Mekdi','Rani','Salon assistant','Dagnu']),
    ('Kids natural style',           array['Fikir','Ethopi','Jerry','Mekdi','Rani','Sofi']),

    -- The owners, from what Selam said rather than from a column ------
    ('Men''s Haircut',               array['Dagnu']),
    ('Children''s Haircut',          array['Dagnu']),
    ('Shape-up',                     array['Dagnu']);

  for v_row in select * from _matrix loop
    select id into v_service from public.services
     where org_id = v_org and name = v_row.service_name and deleted_at is null;

    if v_service is null then
      raise exception 'No live service called "%". The matrix and the menu disagree.', v_row.service_name;
    end if;

    -- Withdraw anything the sheet does not say.
    update public.employee_services es
    set deleted_at = now()
    from public.employees e
    where es.service_id = v_service
      and es.org_id     = v_org
      and es.deleted_at is null
      and e.id = es.employee_id
      and not (e.full_name = any(v_row.staff));

    foreach v_name in array v_row.staff loop
      select id into v_emp from public.employees
       where org_id = v_org and full_name = v_name and deleted_at is null;

      if v_emp is null then
        raise exception 'No employee called "%".', v_name;
      end if;

      insert into public.employee_services (org_id, employee_id, service_id)
      select v_org, v_emp, v_service
      where not exists (
        select 1 from public.employee_services es
        where es.employee_id = v_emp and es.service_id = v_service and es.deleted_at is null);
    end loop;
  end loop;

  raise notice 'Matrix applied.';
end $$;
