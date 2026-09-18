-- The salon's actual people, from Selam's stylist matrix.
--
-- Everything about staffing before this file was invented. Five employees
-- with plausible Ethiopian names and a job title each, and a set of
-- service assignments derived from those inventions. All of it goes.
--
-- WHAT THE MATRIX SAYS THAT NOTHING ELSE DID.
--
-- Only "Staff" performs a take-out. Not one stylist does. So "take my
-- braids out and put new ones in" — an ordinary booking — cannot be done
-- by one person, and needs the split-visit search from migration 030.
-- The case that search was built for turns out not to be the wash at all.
--
-- STAFF IS A POOL AND IS MODELLED AS ONE PERSON, FOR NOW.
--
-- Selam says several assistants share this work; their names are not known
-- yet. One employee holds it in the meantime, which is honest but has a
-- consequence worth stating: the salon can only ever have ONE take-out
-- happening at a time, so a second customer wanting one at the same hour
-- is told there is no space when there is. Splitting it into one row per
-- assistant is an insert each and nothing else.
--
-- THE DAYS OFF ARE A GUESS. One a week, staggered so the salon is never
-- short of the same skill twice on one day. Real time off replaces this.

do $$
declare
  v_org uuid;
  v_id  uuid;
  v_person record;
  v_hours record;
begin
  select id into v_org from public.organizations
   where slug = 'kedus-hair-salon' and deleted_at is null;

  -- ----------------------------------------------------------
  -- 1. Retire the invented staff.
  --
  -- Soft-delete, and their service assignments with them. Any test
  -- appointment against these names keeps working — an appointment points
  -- at an employee row, and a soft-deleted row is still there.
  -- ----------------------------------------------------------
  update public.employee_services es
  set deleted_at = now()
  from public.employees e
  where es.employee_id = e.id
    and es.org_id = v_org
    and es.deleted_at is null
    and e.full_name in ('Selam Tesfaye','Marta Gebre','Hanna Bekele',
                        'Yonas Haile','Sara Alemu');

  update public.employee_working_hours wh
  set deleted_at = now()
  from public.employees e
  where wh.employee_id = e.id
    and wh.org_id = v_org
    and wh.deleted_at is null
    and e.full_name in ('Selam Tesfaye','Marta Gebre','Hanna Bekele',
                        'Yonas Haile','Sara Alemu');

  update public.employees
  set deleted_at = now(), is_active = false, is_bookable = false
  where org_id = v_org
    and deleted_at is null
    and full_name in ('Selam Tesfaye','Marta Gebre','Hanna Bekele',
                      'Yonas Haile','Sara Alemu');

  -- ----------------------------------------------------------
  -- 2. The real team.
  --
  -- Dagnu and Mimi are the owners and are not on the matrix, so their
  -- services are set from what Selam said they do rather than from a
  -- column: a barber, and a flat-iron and straightening stylist.
  -- ----------------------------------------------------------
  for v_person in
    select * from (values
      ('Maki',            'Stylist',                   1),
      ('Fikir',           'Stylist',                   2),
      ('Ethopi',          'Stylist',                   3),
      ('Jerry',           'Stylist',                   4),
      ('Mekdi',           'Stylist',                   5),
      ('Rani',            'Stylist',                   6),
      ('Sofi',            'Stylist',                   7),
      ('Dagnu',           'Owner & Barber',            8),
      ('Mimi',            'Owner & Straightening',     9),
      ('Salon assistant', 'Washing & take-outs',      10)
    ) as t(name, role, ord)
  loop
    select id into v_id from public.employees
     where org_id = v_org and full_name = v_person.name and deleted_at is null;

    if v_id is null then
      insert into public.employees (org_id, full_name, position, display_order)
      values (v_org, v_person.name, v_person.role, v_person.ord);
    else
      update public.employees
      set position = v_person.role, display_order = v_person.ord
      where id = v_id;
    end if;
  end loop;

  -- ----------------------------------------------------------
  -- 3. Working hours. Salon opens 09:00–19:00, Sunday 09:00–17:00.
  --
  -- day_of_week is Postgres's: 0 = Sunday.
  --
  -- One day off each, spread out. Nobody who does the twists is off on the
  -- same day as everybody else who does them, which is the only thing this
  -- guess tries to get right.
  -- ----------------------------------------------------------
  for v_hours in
    select * from (values
      ('Maki',            1),   -- Monday off
      ('Fikir',           2),
      ('Ethopi',          3),
      ('Jerry',           4),
      ('Mekdi',           5),
      ('Rani',            6),
      ('Sofi',            0),   -- Sunday off
      ('Dagnu',           1),
      ('Mimi',            2),
      ('Salon assistant', 3)
    ) as t(name, day_off)
  loop
    select id into v_id from public.employees
     where org_id = v_org and full_name = v_hours.name and deleted_at is null;

    insert into public.employee_working_hours (org_id, employee_id, day_of_week, start_time, end_time)
    select v_org, v_id, d,
           '09:00'::time,
           case when d = 0 then '17:00'::time else '19:00'::time end
    from generate_series(0, 6) as d
    where d <> v_hours.day_off
      and not exists (
        select 1 from public.employee_working_hours wh
        where wh.employee_id = v_id and wh.day_of_week = d and wh.deleted_at is null);
  end loop;

  raise notice 'Team replaced.';
end $$;
