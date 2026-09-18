-- The latest we will take each booking.
--
-- Selam: "the latest long hour service that we accept is 4:30pm, or 5pm…
-- of course we will show that we accept appointments at 7pm on a busy day…
-- it does not necessarily have to finish at 7pm."
--
-- So the cutoff is per service and has nothing to do with closing time. A
-- trim at 18:45 finishes a little after close and that is a normal day. The
-- same 18:45 for braids would have somebody here at three in the morning.
--
-- GUESSES, and the ones most likely to need changing — they decide how late
-- the salon can be asked to stay. The safety net under them is
-- organizations.max_overhang_minutes, which is 120 by default: no booking may
-- run more than two hours past the end of a working window however generous a
-- cutoff is set here.
--
-- A service left NULL keeps the old rule: it must finish inside working
-- hours. That is the right answer for anything nobody has thought about yet.

do $$
declare
  v_org uuid;
  v_row record;
begin
  select id into v_org from public.organizations
   where slug='kedus-hair-salon' and deleted_at is null;

  create temporary table _cutoff (service_name text, latest time) on commit drop;
  insert into _cutoff values
    -- Long braiding. Started at half past four, the founding is done by
    -- seven and an assistant carries the length into the evening.
    ('Knotless braids',                       '16:30'),
    ('Boho braids',                           '16:30'),
    ('French curls',                          '16:30'),
    ('Twists with extensions',                '16:30'),
    ('Fulani braids',                         '16:30'),
    ('Ethiopian traditional braids',          '16:30'),
    ('Individual braids on natural hair',     '16:30'),
    ('Half Cornrows Half Individual Braids',  '16:30'),
    ('Circle Half Cornrows Half Curls',       '16:30'),
    ('Wave Half Cornrows Half Indiv. Braids', '16:30'),
    -- Micro braids are the longest thing on the menu, so they stop earliest.
    ('Micro Braids',                          '15:00'),
    -- Shorter braiding.
    ('Twists on natural hair',                '17:00'),
    ('Half Cornrows Half Afro',               '17:00'),
    ('Cornrows with extensions',              '17:30'),
    ('Cornrows on natural hair',              '17:30'),
    ('Kids braiding',                         '17:00'),
    ('Braided Ponytail',                      '17:30'),
    ('Braided Bun',                           '18:00'),
    -- The quick things, which is where "we accept appointments at 7pm"
    -- actually applies.
    ('Wash & Blow Dry',                       '18:30'),
    ('Wash & Set',                            '18:00'),
    ('Trim',                                  '18:45'),
    ('Men''s Haircut',                        '18:30'),
    ('Children''s Haircut',                   '18:30'),
    ('Shape-up',                              '18:45'),
    ('Silk press',                            '17:00'),
    ('Wash & Set with Flat Iron',             '17:30'),
    ('Take-down',                             '17:00');

  for v_row in select * from _cutoff loop
    update public.services
    set latest_start_time = v_row.latest
    where org_id = v_org and name = v_row.service_name and deleted_at is null;
  end loop;

  raise notice 'Cutoffs set on % services.', (select count(*) from _cutoff);
end $$;
