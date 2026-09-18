-- ============================================================
-- Placeholder working hours for Kedus.
--
-- EVERY ROW THIS CREATES IS INVENTED. Nobody at the salon has told us
-- who works which days. It exists so the booking form can be built and
-- seen working — availability reads employee_working_hours, and with
-- that table empty every service shows zero times on every day, which
-- looks exactly like a broken function.
--
-- Same status as the five fictional employees in seed-kedus.sql:
-- useful for building against, and it must be replaced before the site
-- reaches a real domain. See the launch checklist in ROADMAP.md.
--
-- WHAT IT ASSUMES
--
--   * Every bookable employee works the salon's own opening hours,
--     read live from public_settings rather than typed in here, so
--     this stays correct if the hours change.
--   * Each gets one day off, spread across the team.
--   * Nobody is off Friday or Saturday. That is deliberate rather than
--     lucky — they are a salon's busiest days, and a rota that empties
--     them is not a plausible placeholder.
--
-- Replacing it later: soft-delete, never DELETE.
--   update employee_working_hours set deleted_at = now()
--   where deleted_at is null;
-- ============================================================


-- ------------------------------------------------------------
-- Refuse to run twice.
--
-- There is deliberately no unique constraint on this table — several
-- rows per day is a split shift, which is normal. That also means a
-- second run would silently double every stylist's rota rather than
-- fail, and a stylist working two overlapping shifts is not something
-- availability would complain about. So check first.
-- ------------------------------------------------------------
do $$
declare
  v_existing int;
begin
  select count(*)
  into v_existing
  from public.employee_working_hours wh
  join public.organizations o on o.id = wh.org_id
  where o.slug = 'kedus-hair-salon'
    and wh.deleted_at is null;

  if v_existing > 0 then
    raise exception
      'There are already % live working-hours rows for this salon. Soft-delete them first if you mean to replace the rota.',
      v_existing;
  end if;
end;
$$;


-- ------------------------------------------------------------
-- The rota.
-- ------------------------------------------------------------
with salon as (
  select id, public_settings
  from public.organizations
  where slug = 'kedus-hair-salon'
    and deleted_at is null
),

-- The salon's own opening hours, turned into day numbers Postgres
-- understands. 0 = Sunday, matching extract(dow) and JavaScript's
-- getDay(), which is why employee_working_hours.day_of_week is
-- numbered that way.
salon_days as (
  select
    case h ->> 'day'
      when 'Sunday'    then 0
      when 'Monday'    then 1
      when 'Tuesday'   then 2
      when 'Wednesday' then 3
      when 'Thursday'  then 4
      when 'Friday'    then 5
      when 'Saturday'  then 6
    end                        as day_of_week,
    (h ->> 'open')::time       as opens_at,
    (h ->> 'close')::time      as closes_at
  from salon,
       lateral jsonb_array_elements(salon.public_settings -> 'hours') as h
),

-- Everyone a customer can actually book. A receptionist with
-- is_bookable = false is part of the team and not part of the rota.
bookable as (
  select e.id,
         e.org_id,
         e.full_name,
         row_number() over (order by e.display_order, e.id) - 1 as n
  from public.employees e
  join salon s on s.id = e.org_id
  where e.deleted_at is null
    and e.is_active
    and e.is_bookable
),

-- One day off each, cycling Monday, Tuesday, Wednesday, Thursday,
-- Sunday. Friday and Saturday are never in the list.
days_off as (
  select b.*,
         (array[1, 2, 3, 4, 0])[(b.n % 5) + 1] as day_off
  from bookable b
)

insert into public.employee_working_hours
  (org_id, employee_id, day_of_week, start_time, end_time)
select d.org_id, d.id, sd.day_of_week, sd.opens_at, sd.closes_at
from days_off d
cross join salon_days sd
where sd.day_of_week is not null
  and sd.day_of_week <> d.day_off;


-- ------------------------------------------------------------
-- What was created. Read it before trusting it.
-- ------------------------------------------------------------
select e.full_name,
       count(*)                                   as days_worked,
       string_agg(
         to_char(date '2026-01-04' + wh.day_of_week, 'Dy'),
         ', ' order by wh.day_of_week
       )                                          as works,
       min(wh.start_time)                         as earliest_start,
       max(wh.end_time)                           as latest_finish
from public.employee_working_hours wh
join public.employees e on e.id = wh.employee_id
join public.organizations o on o.id = wh.org_id
where o.slug = 'kedus-hair-salon'
  and wh.deleted_at is null
group by e.full_name
order by e.full_name;
