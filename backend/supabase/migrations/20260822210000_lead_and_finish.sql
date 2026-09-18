-- ============================================================
-- 033 — a braider is not in the chair for six hours
--
-- The system has believed, until now, that a seven-hour braid occupies
-- a stylist for seven hours. It does not. At Kedus the stylist braids
-- the foundation across the whole scalp — two and a half hours, three
-- for micro braids, one for simple cornrows or a child — and then moves
-- to the next customer while an assistant finishes the length.
--
-- The customer is still there for seven hours. The SCARCE PERSON is not.
--
-- This is not a detail. Modelling a braider as occupied for the whole
-- appointment makes them look about sixty per cent less productive than
-- they are: the salon runs five to eight braiding customers per stylist
-- in a day and the software believed it could run one or two. Every
-- Saturday slot it refused was a customer it did not need to turn away.
--
-- THE SHAPE. One service, two phases, in sequence:
--
--   Knotless braids — the customer is here 7h30
--     LEAD    0:00 → 2:30   the stylist
--     FINISH  2:30 → 7:30   an assistant, or several
--
-- Two appointment rows sharing a visit_id, which is the shape multi-
-- service visits already use, so the calendar, the exclusion constraint
-- and the receptionist's day all keep working untouched.
--
-- WHAT THIS MIGRATION DOES AND DOES NOT DO. It adds the columns, teaches
-- the arithmetic to work out a lead time the same way it works out a
-- duration, and records who may finish as opposed to who may lead. It
-- does NOT yet find those times or write those rows — availability and
-- create_appointment come next, and the finish phase needs a chain of
-- assistants covering it, which is its own piece of work.
-- ============================================================


-- ------------------------------------------------------------
-- 1. How long the lead stylist is needed.
--
-- NULL means the whole appointment is one person's job, which is true of
-- a haircut, a silk press and most of the menu. A number means the rest
-- is finished by somebody else.
--
-- Per service rather than one salon-wide cap, because Selam is explicit
-- that it varies: micro braids run to three hours, simple cornrows and
-- children about one. A single number would have been wrong for both
-- ends of the same category.
-- ------------------------------------------------------------
alter table public.services
  add column lead_minutes int check (lead_minutes is null or lead_minutes > 0);

comment on column public.services.lead_minutes is
  'Minutes the lead stylist is needed for. NULL means one person does the whole appointment. Less than the duration means an assistant finishes it.';


-- ------------------------------------------------------------
-- 2. Answers change the lead time too.
--
-- Selam: it varies "depending on the style, and size". Small braids take
-- longer to lay than large ones, and that difference is in the founding
-- as much as in the finishing — so an option carries a lead delta beside
-- the price and duration deltas it already had.
--
-- Zero by default, which keeps every existing answer meaning exactly
-- what it meant before this migration.
-- ------------------------------------------------------------
alter table public.service_options
  add column lead_delta_minutes int not null default 0;

comment on column public.service_options.lead_delta_minutes is
  'How this answer changes the LEAD stylist''s time, as opposed to the whole appointment. Small braids take longer to lay, not just longer overall.';


-- ------------------------------------------------------------
-- 3. Leading and assisting are different claims.
--
-- "Fikir can braid" and "Emu can finish a braid" are not the same
-- sentence, and employee_services could not tell them apart. It can now.
--
-- Default 'lead', so every assignment made before this migration keeps
-- exactly the meaning it had.
-- ------------------------------------------------------------
alter table public.employee_services
  add column role text not null default 'lead'
    check (role in ('lead', 'assist'));

comment on column public.employee_services.role is
  'lead = can perform this service from the start. assist = can finish one a lead stylist has begun.';

drop index if exists employee_services_pair_key;
create unique index employee_services_pair_key
  on public.employee_services (employee_id, service_id, role)
  where deleted_at is null;

grant insert (role), update (role) on public.employee_services to authenticated;
grant select (role) on public.employee_services to anon;


-- ------------------------------------------------------------
-- 4. Which half of the work an appointment row is.
--
-- The lead row carries the price; the finish rows carry zero, so a visit
-- still adds up to what the customer was quoted no matter how many
-- people touched their hair.
-- ------------------------------------------------------------
alter table public.appointments
  add column phase text not null default 'lead'
    check (phase in ('lead', 'finish'));

comment on column public.appointments.phase is
  'lead = the stylist founding the style. finish = an assistant completing it. The price sits on the lead row.';

grant select (phase) on public.appointments to authenticated;
grant insert (phase), update (phase) on public.appointments to authenticated;


-- ------------------------------------------------------------
-- 5. The arithmetic learns about lead time.
--
-- visit_lines() gains a column rather than a caller: everything that
-- needs to know how long the scarce person is needed asks the same
-- function that already says how long the whole thing takes.
--
-- Dropped and recreated because the return type changes. The bodies of
-- the functions that call it are strings to Postgres, so nothing depends
-- on it in a way that requires a cascade.
--
-- The lead is CAPPED AT THE DURATION. An answer that adds an hour of
-- founding to a style whose total did not grow would otherwise produce a
-- lead phase finishing after the appointment does.
-- ------------------------------------------------------------
drop function if exists public.visit_lines(uuid, jsonb);

create or replace function public.visit_lines(
  p_org_id    uuid,
  p_selection jsonb
)
returns table (
  ord              int,
  service_id       uuid,
  price            numeric(10,2),
  duration_minutes int,
  lead_minutes     int,
  was_included     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with chosen as (
    select (row_number() over ())::int          as ord,
           (entry ->> 'service_id')::uuid       as service_id,
           coalesce(
             array(select (value #>> '{}')::uuid
                   from jsonb_array_elements(entry -> 'option_ids')),
             '{}'::uuid[]
           )                                    as option_ids
    from jsonb_array_elements(coalesce(p_selection, '[]'::jsonb)) as entry
  ),

  valid_options as (
    select c.ord,
           o.price_delta,
           o.duration_delta_minutes,
           o.lead_delta_minutes
    from chosen c
    join unnest(c.option_ids) as picked(option_id) on true
    join public.service_options o
      on  o.id         = picked.option_id
      and o.org_id     = p_org_id
      and o.deleted_at is null
      and o.is_active
    join public.service_option_group_links l
      on  l.group_id   = o.group_id
      and l.service_id = c.service_id
      and l.org_id     = p_org_id
      and l.deleted_at is null
  ),

  totals as (
    select c.ord,
           c.service_id,
           s.price                                    as base_price,
           s.duration_minutes                         as base_minutes,
           s.lead_minutes                             as base_lead,
           s.is_included_with_others,
           coalesce(sum(v.price_delta), 0)            as price_delta,
           coalesce(sum(v.duration_delta_minutes), 0) as minute_delta,
           coalesce(sum(v.lead_delta_minutes), 0)     as lead_delta
    from chosen c
    join public.services s
      on  s.id         = c.service_id
      and s.org_id     = p_org_id
      and s.deleted_at is null
    left join valid_options v on v.ord = c.ord
    group by c.ord, c.service_id, s.price, s.duration_minutes, s.lead_minutes,
             s.is_included_with_others
  ),

  has_chargeable as (
    select exists (select 1 from totals where not is_included_with_others) as yes
  )

  select t.ord,
         t.service_id,
         case
           when t.is_included_with_others and (select yes from has_chargeable)
             then 0::numeric(10,2)
           else greatest(t.base_price + t.price_delta, 0)::numeric(10,2)
         end,
         greatest(t.base_minutes + t.minute_delta, 5)::int,
         case
           when t.base_lead is null then null
           else least(
                  greatest(t.base_lead + t.lead_delta, 5),
                  greatest(t.base_minutes + t.minute_delta, 5)
                )::int
         end,
         (t.is_included_with_others and (select yes from has_chargeable))
  from totals t
  order by t.ord;
$$;

comment on function public.visit_lines is
  'One row per service, priced and timed from the answers chosen — including how much of that time the LEAD stylist is needed for. Applies the included-with-others rule to the price and never to the minutes.';

revoke all on function public.visit_lines(uuid, jsonb) from public;
grant execute on function public.visit_lines(uuid, jsonb) to anon, authenticated;
