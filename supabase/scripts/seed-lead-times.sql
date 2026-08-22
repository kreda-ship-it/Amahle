-- How long the lead stylist is needed, per braiding style.
--
-- GUESSES, shaped by what Selam said: about two and a half hours for most
-- braiding, nearer three for micro braids, about an hour for simple cornrows
-- and children. Only braiding gets a lead phase — everything else stays one
-- person from start to finish, which is what a haircut or a silk press is.
--
-- LENGTH ADDS TO THE FINISH, NOT TO THE LEAD, and that is the whole reason
-- this split earns its keep. Going from mid-back to waist adds an hour to the
-- appointment and nothing to the founding: the stylist lays the same number
-- of braids across the same scalp, and the extra hour is length being worked
-- down by somebody else. So Length carries duration deltas and a lead delta
-- of zero, while Size — which changes how many braids there are, and so how
-- long the founding takes — carries both.
--
-- That is what turns a longer booking from "more of the scarce person" into
-- "more of the plentiful one".
--
-- Every assistant can finish every style with a lead phase, per Selam, so
-- they all get an 'assist' row on each. Their 'lead' assignments elsewhere —
-- washing, take-outs, treatments — are untouched.

do $$
declare
  v_org uuid;
  v_row record;
  v_service uuid;
  v_emp uuid;
  v_name text;
  assist text[] := array['Meski','Miru','Saron','Emu','Seble','Geni','Saba','Weyni'];
begin
  select id into v_org from public.organizations
   where slug='kedus-hair-salon' and deleted_at is null;

  create temporary table _lead (service_name text, lead_minutes int) on commit drop;
  insert into _lead values
    ('Knotless braids',                       150),
    ('Boho braids',                           150),
    ('French curls',                          150),
    ('Twists with extensions',                150),
    ('Micro Braids',                          180),
    ('Fulani braids',                         120),
    ('Ethiopian traditional braids',          120),
    ('Individual braids on natural hair',     120),
    ('Half Cornrows Half Individual Braids',  120),
    ('Circle Half Cornrows Half Curls',       120),
    ('Wave Half Cornrows Half Indiv. Braids', 120),
    ('Twists on natural hair',                 90),
    ('Half Cornrows Half Afro',                90),
    ('Cornrows with extensions',               60),
    ('Kids braiding',                          60),
    ('Braided Ponytail',                       60),
    ('Cornrows on natural hair',               45),
    ('Braided Bun',                            45);

  for v_row in select * from _lead loop
    select id into v_service from public.services
     where org_id=v_org and name=v_row.service_name and deleted_at is null;
    if v_service is null then
      raise exception 'No live service called "%".', v_row.service_name;
    end if;

    -- Never longer than the appointment itself.
    update public.services
    set lead_minutes = least(v_row.lead_minutes, duration_minutes)
    where id = v_service;

    -- Anybody may finish it.
    foreach v_name in array assist loop
      select id into v_emp from public.employees
       where org_id=v_org and full_name=v_name and deleted_at is null;
      insert into public.employee_services (org_id, employee_id, service_id, role)
      select v_org, v_emp, v_service, 'assist'
      where not exists (
        select 1 from public.employee_services es
        where es.employee_id=v_emp and es.service_id=v_service
          and es.role='assist' and es.deleted_at is null);
    end loop;
  end loop;

  -- Size changes how many braids there are, so it changes the founding.
  update public.service_options o
  set lead_delta_minutes = v.d
  from public.service_option_groups g,
       (values ('Small', 30), ('Medium', 0), ('Medium-big', -15), ('Large', -30))
         as v(nm, d)
  where o.group_id = g.id and g.name = 'Size' and o.name = v.nm and o.org_id = v_org;

  -- A boho finish is mostly finishing, but the curls are fed in as the
  -- braid is made, so a little of it lands on the lead.
  update public.service_options o
  set lead_delta_minutes = v.d
  from public.service_option_groups g,
       (values ('No, plain', 0), ('Light', 10), ('Medium', 20), ('Full', 30))
         as v(nm, d)
  where o.group_id = g.id and g.name = 'Boho finish' and o.name = v.nm and o.org_id = v_org;

  raise notice 'Lead times set.';
end $$;
