-- Seeds Kedus Hair Salon and Braiding with its service menu and team.
--
-- NOT a migration. This is tenant data, and migrations are replayed by
-- every deployment — salon #7 must not replay salon #1's menu. Run once
-- per project, by hand, in the SQL editor.
--
-- Safe to re-run. Every insert is guarded, so running it twice does not
-- duplicate anything.
--
-- ============================================================
-- WHAT IS REAL AND WHAT IS INVENTED
-- ============================================================
--
-- REAL, taken from kedushairsalonandbraiding.com on 2026-08-15:
--   every service NAME and CATEGORY, the opening hours, the phone and
--   text numbers, the email, the tagline, the about-us text, the
--   founding year, and two prices — Wash & Blow Dry and Wash & Set,
--   both $40.
--
-- CORRECTED BY THE SALON, against what their website says:
--   they do NOT use Facebook, though their site still links a page.
--   They are on Instagram, TikTok (@kedushairsalon), and have Yelp
--   ratings. The Yelp URL is still needed.
--
-- STILL TO CONFIRM:
--   the Instagram handle. Their site says @kedus_hb, which is what is
--   recorded below, but the TikTok is @kedushairsalon — so one of the
--   two may have been renamed and not updated on the old site.
--
-- INVENTED, pending a conversation with the salon:
--   every other PRICE          — plausible for the area, not agreed
--   every DURATION and BUFFER  — nothing on their site states these
--   every EMPLOYEE             — their site names no staff at all
--
-- Two of those matter more than the others:
--
--   DURATIONS are what Phase 4 uses to decide when the next customer
--   may arrive. Micro Braids guessed at 8 hours could be 5 or 12.
--   Confirming real durations is a BLOCKER on the booking form, though
--   not on the website.
--
--   EMPLOYEE NAMES ARE FICTIONAL PEOPLE. Fine for a prototype. Not fine
--   on a live domain, where customers would phone up and ask for them
--   by name. Replace before this site is published.
--
-- The address is also uncertain. Their own site says "7851 Eastern Ave
-- NW, Silver Spring, DC 20910", which cannot all be true at once —
-- Eastern Ave NW is a DC street, 20910 is a Maryland ZIP, and their
-- about page says Silver Spring, Maryland. Recorded below as Maryland.
-- Confirm before it reaches a map or a search engine.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The organization's own row.
--
-- Replaces the South African placeholders the row has carried since
-- 2026-08-08 with the real contact details from their website.
-- ------------------------------------------------------------
update public.organizations
set phone   = '(301) 495-0114',
    email   = 'Kedush7b@gmail.com',
    address = '7851 Eastern Ave, Silver Spring, MD 20910'
where slug = 'kedus-hair-salon';


-- ------------------------------------------------------------
-- 2. Public site content.
--
-- Hours, social links and site copy live in public_settings rather
-- than in their own tables. They are read by anonymous visitors, they
-- change rarely, and nothing queries them — the public website prints
-- them and nothing else. A column of JSON is the right weight for
-- that, and editing it needs no redeploy.
--
-- Opening hours here are the SALON's, for display. They are not the
-- same thing as employee_working_hours, which arrive in Phase 4 and
-- are what availability is actually computed from.
-- ------------------------------------------------------------
update public.organizations
set public_settings = jsonb_build_object(
  'tagline',      'Our vision is directly related to our clients'' satisfaction.',
  'about',        'Welcome to Kedus Hair Salon & Braiding. We''re dedicated to providing you the very best of hairstyles and treatments, with an emphasis on customer care, quality, and comfort.',
  'founded_year', 1990,
  'promotion',    'Discounts available Tuesday through Thursday.',
  'text_number',  '(202) 492-5582',
  'hours', jsonb_build_array(
    jsonb_build_object('day', 'Monday',    'open', '09:00', 'close', '19:00'),
    jsonb_build_object('day', 'Tuesday',   'open', '09:00', 'close', '19:00'),
    jsonb_build_object('day', 'Wednesday', 'open', '09:00', 'close', '19:00'),
    jsonb_build_object('day', 'Thursday',  'open', '09:00', 'close', '19:00'),
    jsonb_build_object('day', 'Friday',    'open', '09:00', 'close', '19:00'),
    jsonb_build_object('day', 'Saturday',  'open', '09:00', 'close', '19:00'),
    jsonb_build_object('day', 'Sunday',    'open', '09:00', 'close', '17:00')
  ),
  -- No Facebook. Their website still links one, but the salon says it
  -- is not a page they use — a good reminder that their old site is a
  -- source, not the truth.
  --
  -- yelp is null until someone sends the URL. The public site skips
  -- any null entry, so a missing link renders as nothing rather than
  -- as a dead icon.
  'social', jsonb_build_object(
    'instagram', 'https://www.instagram.com/kedus_hb/',
    'tiktok',    'https://www.tiktok.com/@kedushairsalon',
    'yelp',      'https://www.yelp.com/biz/kedus-hair-salon-and-braiding-silver-spring-6'
  )
)
where slug = 'kedus-hair-salon';


-- ------------------------------------------------------------
-- 3. Retire the throwaway test rows.
--
-- Silk Press is not on their menu, and Test Stylist is not a person.
-- Soft-delete, never DELETE — the link row goes first.
-- ------------------------------------------------------------
update public.employee_services
set deleted_at = now()
where deleted_at is null
  and employee_id in (
    select id from public.employees where full_name = 'Test Stylist'
  );

update public.employees
set deleted_at = now()
where full_name = 'Test Stylist' and deleted_at is null;

update public.services
set deleted_at = now()
where name = 'Silk Press' and deleted_at is null;


-- ------------------------------------------------------------
-- 4. The service menu — 24 services, their real names and categories.
--
-- price_display does real work here:
--   'exact'  — a price we are confident about
--   'from'   — braids, colour and updos genuinely vary by hair length
--              and condition, so a flat number would be a lie
--
-- is_bookable_online is false on the longest braiding services. An
-- eight-hour appointment booked by a stranger with no conversation is
-- how a salon loses a day, so those say "call us" instead.
-- ------------------------------------------------------------
insert into public.services
  (org_id, name, description, category, price, price_display,
   duration_minutes, buffer_minutes, is_bookable_online, display_order)
select o.id, v.name, v.description, v.category, v.price, v.price_display,
       v.duration_minutes, v.buffer_minutes, v.is_bookable_online, v.display_order
from public.organizations o
cross join (values
  -- Hairstyles
  ('Wash & Blow Dry',                        'A wash, condition and smooth blow dry.',                    'Hairstyles',     40.00, 'exact',  45,  10, true,  10),
  ('Wash & Set',                             'A wash and a classic roller set.',                          'Hairstyles',     40.00, 'exact',  60,  10, true,  20),
  ('Wash & Set with Flat Iron',              'A wash and set finished with a flat iron for a sleek look.','Hairstyles',     55.00, 'exact',  75,  10, true,  30),
  ('Straw Curl',                             'Tight, springy curls set on straws.',                       'Hairstyles',     65.00, 'exact',  90,  15, true,  40),
  ('Loose Curls',                            'Soft, loose curls with plenty of movement.',                'Hairstyles',     55.00, 'exact',  60,  10, true,  50),
  ('Trim',                                   'A tidy-up of the ends, keeping your length.',               'Hairstyles',     25.00, 'exact',  30,   5, true,  60),
  ('Asymmetric Pixie Cut',                   'A short, sharp cut with a longer side.',                    'Hairstyles',     55.00, 'exact',  45,  10, true,  70),
  ('Updos',                                  'Styled up for a wedding, a party or a special day.',        'Hairstyles',     75.00, 'from',   60,  15, true,  80),

  -- Braids & More
  ('Micro Braids',                           'Fine individual braids. A long appointment — please call so we can plan the day with you.', 'Braids & More', 250.00, 'from', 480, 30, false,  90),
  ('Braided Ponytail',                       'Braided and gathered into a ponytail.',                     'Braids & More',  85.00, 'from',  120,  15, true, 100),
  ('Half Cornrows Half Individual Braids',   'Cornrows at the front, individual braids through the rest.','Braids & More', 180.00, 'from',  300,  20, false, 110),
  ('Braided Bun',                            'Braided and wound into a bun.',                             'Braids & More',  75.00, 'from',   90,  15, true, 120),
  ('Half Cornrows Half Afro',                'Cornrowed at the front, left natural at the back.',         'Braids & More', 150.00, 'from',  240,  20, true, 130),
  ('Circle Half Cornrows Half Curls',        'Circular cornrows with curls through the remainder.',       'Braids & More', 160.00, 'from',  240,  20, true, 140),
  ('Wave Half Cornrows Half Indiv. Braids',  'Wave-pattern cornrows with individual braids.',             'Braids & More', 190.00, 'from',  300,  20, false, 150),

  -- Coloring
  ('Full Hair Color',                        'Colour from root to tip.',                                  'Coloring',       95.00, 'from',  120,  20, true, 160),
  ('Retouch Color',                          'Colour on the regrowth only, matched to your existing shade.','Coloring',     70.00, 'exact',  90,  15, true, 170),
  ('Highlight (Foil)',                       'Lighter pieces placed through the hair in foils.',          'Coloring',      120.00, 'from',  150,  20, true, 180),

  -- Care
  ('Virgin Relaxer',                         'A first relaxer on hair that has never been treated.',      'Care',           85.00, 'exact',  90,  15, true, 190),
  ('Conditioning',                           'A deep conditioning treatment under the steamer.',          'Care',           45.00, 'exact',  45,  10, true, 200),
  ('Retouch Relaxer',                        'A relaxer on the regrowth only.',                           'Care',           70.00, 'exact',  75,  15, true, 210),

  -- Haircuts
  ('Women''s Haircut',                       'A cut and shape, finished with a blow dry.',                'Haircuts',       45.00, 'exact',  45,  10, true, 220),
  ('Men''s Haircut',                         'A cut and clean-up around the neck and edges.',             'Haircuts',       30.00, 'exact',  30,   5, true, 230),
  ('Children''s Haircut',                    'A cut for under-12s, taken at their pace.',                 'Haircuts',       25.00, 'exact',  30,   5, true, 240)
) as v(name, description, category, price, price_display,
       duration_minutes, buffer_minutes, is_bookable_online, display_order)
where o.slug = 'kedus-hair-salon'
on conflict do nothing;


-- ------------------------------------------------------------
-- 5. The team — FICTIONAL PEOPLE. See the header.
--
-- Contact details follow the same convention as
-- create-kedus-organization.sql: example.com is IANA-reserved and can
-- never belong to anyone, and 555-01xx numbers are reserved for
-- fiction, so nothing here can reach a real person.
--
-- Sara is deliberately not bookable. A receptionist belongs on the
-- team page and not in the booking dropdown, and having one in the
-- data is what proves that distinction actually works.
--
-- NOT ON CONFLICT: full_name is deliberately not unique, because two
-- real people can share a name. The NOT EXISTS guard below is what
-- makes this script safe to re-run.
-- ------------------------------------------------------------
insert into public.employees
  (org_id, full_name, position, bio, phone, email, is_bookable, display_order)
select o.id, v.full_name, v.position, v.bio, v.phone, v.email, v.is_bookable, v.display_order
from public.organizations o
cross join (values
  ('Selam Tesfaye', 'Owner & Master Stylist',
   'Founded Kedus in 1990 and still takes clients six days a week.',
   '555-0101', 'selam@example.com',  true,  10),
  ('Marta Gebre',   'Senior Stylist',
   'Colour and relaxers, with a gentle hand on fragile hair.',
   '555-0102', 'marta@example.com',  true,  20),
  ('Hanna Bekele',  'Braiding Specialist',
   'Cornrows, micro braids and anything that needs patience.',
   '555-0103', 'hanna@example.com',  true,  30),
  ('Yonas Haile',   'Barber',
   'Cuts for men and children, in and out without a fuss.',
   '555-0104', 'yonas@example.com',  true,  40),
  ('Sara Alemu',    'Receptionist',
   'Answers the phone, keeps the book, knows where everyone is.',
   '555-0105', 'sara@example.com',   false, 50)
) as v(full_name, position, bio, phone, email, is_bookable, display_order)
where o.slug = 'kedus-hair-salon'
  and not exists (
    select 1 from public.employees e
    where e.org_id = o.id
      and e.full_name = v.full_name
      and e.deleted_at is null
  );


-- ------------------------------------------------------------
-- 6. Who performs what.
--
-- This is a many-to-many join: one row per stylist per service. A
-- stylist who braids AND flat irons AND colours simply has more rows.
-- Nothing designates a primary skill and nothing caps how many
-- services one person covers — a job title is a label on the team
-- page, not a restriction on what someone is allowed to do.
--
-- Mapped by category rather than service by service, so adding a
-- service to a category the stylist already covers is one insert
-- rather than a rethink.
--
-- In a salon this size most people do most things, so Selam and Marta
-- cover the whole menu. Hanna braids and styles, Yonas cuts. The
-- narrower two exist mainly to prove the booking form really does
-- filter by who can do what, rather than offering everyone for
-- everything.
--
-- Sara appears nowhere, because she is not a stylist. An employee with
-- no services is a legitimate state, not missing data.
-- ------------------------------------------------------------
insert into public.employee_services (org_id, employee_id, service_id)
select e.org_id, e.id, s.id
from public.employees e
join public.services s
  on  s.org_id     = e.org_id
  and s.deleted_at is null
join (values
  ('Selam Tesfaye', 'Hairstyles'),
  ('Selam Tesfaye', 'Braids & More'),
  ('Selam Tesfaye', 'Coloring'),
  ('Selam Tesfaye', 'Care'),
  ('Selam Tesfaye', 'Haircuts'),
  ('Marta Gebre',   'Hairstyles'),
  ('Marta Gebre',   'Braids & More'),
  ('Marta Gebre',   'Coloring'),
  ('Marta Gebre',   'Care'),
  ('Marta Gebre',   'Haircuts'),
  ('Hanna Bekele',  'Braids & More'),
  ('Hanna Bekele',  'Hairstyles'),
  ('Yonas Haile',   'Haircuts')
) as m(full_name, category)
  on  m.full_name = e.full_name
  and m.category  = s.category
where e.deleted_at is null
on conflict do nothing;


-- ------------------------------------------------------------
-- 7. Check what landed.
-- ------------------------------------------------------------
select
  (select count(*) from public.services  where deleted_at is null)  as services,
  (select count(*) from public.employees where deleted_at is null)  as employees,
  (select count(*) from public.employee_services where deleted_at is null) as mappings,
  (select count(*) from public.services  where deleted_at is null
     and price_display = 'from')                                    as priced_from,
  (select count(*) from public.services  where deleted_at is null
     and is_bookable_online = false)                                as phone_only;
