-- ============================================================
-- 029 — the price and the length of a visit, computed in one place
--
-- Migration 027 gave every answer a price_delta and a
-- duration_delta_minutes. Nothing has added them up. The website could,
-- and must not: the running total a customer watches while choosing and
-- the number written to their appointment have to come from the same
-- arithmetic, or one day they disagree and the argument happens at the
-- till. Worse, a duration computed in a browser can be edited by anyone
-- with dev tools, and a seven-hour braid booked into a three-hour gap
-- is the failure PROJECT.md says ends the project.
--
-- So it is here, once, and both paths call it.
--
-- THE INCLUDED RULE LIVES HERE TOO.
--
-- "Wash and blow dry is included in the braids price. Unless it is just
-- wash and blow dry only, we don't charge extra for doing it with other
-- hair services." A service flagged is_included_with_others prices at
-- zero when the visit holds at least one other CHARGEABLE service, and
-- at its own price when it stands alone.
--
-- Its minutes are never touched. Free is not instant: the wash occupies
-- forty-five minutes of somebody's day whether or not anybody is billed
-- for it, and zeroing the time along with the money would overbook
-- every braiding appointment in the salon by exactly that much.
--
-- WHAT A SELECTION LOOKS LIKE.
--
--   [{"service_id": "…", "option_ids": ["…", "…"]}, …]
--
-- One entry per service, in the order they will be performed, each
-- carrying the answers chosen for it. jsonb rather than two parallel
-- arrays because the options belong TO a service — "size: medium" means
-- nothing on its own, and a flat list of option ids would have to be
-- guessed back into services by looking at which questions they belong
-- to, which is ambiguous the moment a visit holds two braiding styles.
-- ============================================================


-- ------------------------------------------------------------
-- 1. visit_lines() — one row per service, priced and timed.
--
-- The workhorse. Everything else in this migration is a thin caller.
--
-- Every option is validated on the way through: it must be live, it
-- must belong to this organization, and it must belong to a question
-- that this service actually asks. That last check is what stops a
-- crafted request from attaching "shoulder length, minus thirty
-- dollars" to a haircut.
-- ------------------------------------------------------------
create or replace function public.visit_lines(
  p_org_id    uuid,
  p_selection jsonb
)
returns table (
  ord              int,
  service_id       uuid,
  price            numeric(10,2),
  duration_minutes int,
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

  -- Only options this service genuinely asks about. An option whose
  -- question is not linked to the service is dropped rather than
  -- rejected: the caller may legitimately still be holding an answer to
  -- a question that stopped applying when an earlier answer changed.
  valid_options as (
    select c.ord,
           o.price_delta,
           o.duration_delta_minutes
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
           s.price                                   as base_price,
           s.duration_minutes                        as base_minutes,
           s.is_included_with_others,
           coalesce(sum(v.price_delta), 0)           as price_delta,
           coalesce(sum(v.duration_delta_minutes), 0) as minute_delta
    from chosen c
    join public.services s
      on  s.id         = c.service_id
      and s.org_id     = p_org_id
      and s.deleted_at is null
    left join valid_options v on v.ord = c.ord
    group by c.ord, c.service_id, s.price, s.duration_minutes, s.is_included_with_others
  ),

  -- Is there anything in this visit that is NOT an included-with-others
  -- service? Two washes and nothing else are still charged: the rule is
  -- about accompanying real work, not about company.
  has_chargeable as (
    select exists (
      select 1 from totals where not is_included_with_others
    ) as yes
  )

  select t.ord,
         t.service_id,
         case
           when t.is_included_with_others and (select yes from has_chargeable)
             then 0::numeric(10,2)
           else greatest(t.base_price + t.price_delta, 0)::numeric(10,2)
         end,
         greatest(t.base_minutes + t.minute_delta, 5)::int,
         (t.is_included_with_others and (select yes from has_chargeable))
  from totals t
  order by t.ord;
$$;

comment on function public.visit_lines is
  'One row per service in a visit, priced and timed from the options chosen. Applies the included-with-others rule to the price and never to the minutes.';


-- ------------------------------------------------------------
-- 2. visit_totals() — the two numbers a customer is shown.
-- ------------------------------------------------------------
create or replace function public.visit_totals(
  p_org_id    uuid,
  p_selection jsonb
)
returns table (
  total_price      numeric(10,2),
  total_minutes    int
)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(price), 0)::numeric(10,2),
         coalesce(sum(duration_minutes), 0)::int
  from public.visit_lines(p_org_id, p_selection);
$$;

comment on function public.visit_totals is
  'What the booking page shows while somebody is choosing. The same arithmetic that create_appointment records, so the two cannot drift.';


-- ------------------------------------------------------------
-- 3. visit_minutes() — how long to look for.
--
-- Separate from visit_totals so availability has something cheap to
-- call that says exactly what it means. Falls back to the plain sum of
-- service durations when no options were chosen, which is every booking
-- made before this migration and every service that asks no questions.
-- ------------------------------------------------------------
create or replace function public.visit_minutes(
  p_org_id      uuid,
  p_service_ids uuid[],
  p_selection   jsonb default null
)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_selection is null or jsonb_array_length(p_selection) = 0
      then (
        select coalesce(sum(s.duration_minutes), 0)::int
        from unnest(p_service_ids) as t(service_id)
        join public.services s on s.id = t.service_id and s.org_id = p_org_id
      )
    else (select total_minutes from public.visit_totals(p_org_id, p_selection))
  end;
$$;

comment on function public.visit_minutes is
  'How many minutes a visit occupies, options included. What availability must look for a gap of.';


revoke all on function public.visit_lines(uuid, jsonb)   from public;
revoke all on function public.visit_totals(uuid, jsonb)  from public;
revoke all on function public.visit_minutes(uuid, uuid[], jsonb) from public;

grant execute on function public.visit_lines(uuid, jsonb)   to anon, authenticated;
grant execute on function public.visit_totals(uuid, jsonb)  to anon, authenticated;
grant execute on function public.visit_minutes(uuid, uuid[], jsonb) to anon, authenticated;
