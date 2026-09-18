-- ============================================================
-- 027 — services stop being a flat menu
--
-- Until now a service was one row with one price and one duration.
-- "Wash & Blow Dry, $40, 45 minutes." That is true of a blow dry and it
-- is not true of anything this salon actually makes its money on.
--
-- Knotless braids are not a price. They are a style, a size, a length,
-- a boho finish or not, whose hair, and what state the hair arrives in
-- — and every one of those answers changes both the price AND how long
-- the chair is occupied. Small braids to the waist is not the same job
-- as medium braids to the shoulder, and today the database cannot tell
-- them apart.
--
-- THE DURATION IS THE POINT, NOT THE PRICE.
--
-- A price that is wrong by forty dollars is an awkward conversation at
-- the till. A duration that is wrong by three hours books a seven-hour
-- braid into a three-hour gap, wrecks the rest of the day, and teaches
-- the staff that the calendar lies. PROJECT.md is explicit that this is
-- the failure that ends the project.
--
-- So the options carry MINUTES as well as money, and migration 028 will
-- make create_appointment() add them up itself rather than trusting a
-- number posted by a form. This migration only builds the shapes.
--
-- WHAT IS NOT HERE. No option is attached to any service by this file,
-- and no category exists when it finishes. The tables are empty on
-- purpose: the shapes belong in migrations because every salon gets
-- them, and Kedus's own tree is one salon's content, which belongs in a
-- script beside seed-kedus.sql. See supabase/scripts/seed-service-tree.sql.
-- ============================================================


-- ------------------------------------------------------------
-- 1. service_categories — the branches of the menu.
--
-- "Braiding", and inside it "With extensions" and "Without". A tree
-- rather than the flat `category` text column services already has,
-- because the mind map this comes from is two levels deep in places and
-- a text column cannot express "inside".
--
-- parent_id references this same table. A top-level category has none.
--
-- The composite foreign key (parent_id, org_id) rather than plain
-- (parent_id) is DECISIONS #21: a key between tenant tables carries
-- org_id, so a row can never point at another salon's row. It needs
-- (id, org_id) to be unique, which is declared below and is trivially
-- true given id is already the primary key.
-- ------------------------------------------------------------
create table public.service_categories (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  parent_id      uuid,
  name           text not null,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint service_categories_id_org_key unique (id, org_id),

  constraint service_categories_parent_same_org
    foreign key (parent_id, org_id)
    references public.service_categories (id, org_id),

  -- A category cannot be its own parent. This does not stop a longer
  -- loop (A -> B -> A), which SQL cannot express as a constraint; the
  -- seed script builds the tree top down and nothing else writes here
  -- yet. Worth knowing rather than assuming it is airtight.
  constraint service_categories_not_own_parent check (parent_id is null or parent_id <> id)
);

comment on table public.service_categories is
  'The branches of the service menu. Two levels in places — Braiding, then with or without extensions.';

create unique index service_categories_org_name_parent_key
  on public.service_categories (org_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
  where deleted_at is null;

create index service_categories_org_id_idx    on public.service_categories (org_id);
create index service_categories_parent_id_idx on public.service_categories (parent_id);

create trigger service_categories_set_updated_at
  before update on public.service_categories
  for each row execute function public.set_updated_at();

alter table public.service_categories enable row level security;


-- ------------------------------------------------------------
-- 2. Two new columns on services.
--
-- category_id sits BESIDE the existing `category` text rather than
-- replacing it. Every public page and the booking picker read that text
-- column today, and swapping them over is a change to five files that
-- has nothing to do with this migration. Nullable, unused until the
-- seed fills it in, and the text column goes when the pages move.
--
-- is_included_with_others is the salon's own pricing rule, written down:
--
--   "Wash and blow dry is included in the braids price. Unless it is
--    just wash and blow dry only, we don't charge extra for doing it
--    with other hair services."
--
-- So the flag means: when this service shares a visit with at least one
-- other chargeable service, its price is zero and the customer is shown
-- "Included". Booked on its own, it costs what it costs.
--
-- ITS DURATION IS ALWAYS COUNTED. Free is not instant. The wash still
-- takes forty-five minutes of a stylist's day whether or not anybody is
-- billed for it, and a rule that zeroed the time along with the money
-- would quietly overbook every braiding appointment in the salon.
--
-- The rule is applied in migration 028, inside the same function that
-- records the price, so the running total a customer sees on the
-- booking page and the number written to the appointment cannot drift
-- apart. It is deliberately not a calculation the website performs.
-- ------------------------------------------------------------
alter table public.services
  add column category_id uuid,
  add column is_included_with_others boolean not null default false;

alter table public.services
  add constraint services_category_same_org
  foreign key (category_id, org_id)
  references public.service_categories (id, org_id);

create index services_category_id_idx on public.services (category_id);

comment on column public.services.category_id is
  'The branch of the menu this service hangs from. Replaces the older `category` text column, which is still read by the public pages.';

comment on column public.services.is_included_with_others is
  'True means free when booked alongside another chargeable service, full price alone. The DURATION always counts either way — see migration 027.';


-- ------------------------------------------------------------
-- 3. service_option_groups — one question.
--
-- "What size?" "How long?" "Boho finish?" A group is the question; the
-- rows in service_options below are its answers.
--
-- Questions are defined once and attached to many styles, which is the
-- entire reason this is a table and not columns on services. "Size" is
-- the same question for knotless braids, box braids and twists. Typing
-- it three times is how three versions of it end up in the database.
--
-- `prompt` is what a customer reads and `name` is what staff call it,
-- because "Length" is a fine label in an admin list and a poor thing to
-- put at the top of a page on its own.
-- ------------------------------------------------------------
create table public.service_option_groups (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations (id),
  name           text not null,
  prompt         text not null,
  selection      text not null default 'one',
  is_required    boolean not null default true,
  display_order  int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,

  constraint service_option_groups_id_org_key unique (id, org_id),

  -- 'one' is a size or a length. 'many' is for a question where more
  -- than one answer is legitimate — no such question exists in the
  -- salon's tree today, and the column is here so that the first one
  -- does not need a migration.
  constraint service_option_groups_selection_valid
    check (selection in ('one', 'many'))
);

comment on table public.service_option_groups is
  'One question asked while booking — size, length, boho finish. Defined once, attached to many services.';

create unique index service_option_groups_org_name_key
  on public.service_option_groups (org_id, name)
  where deleted_at is null;

create index service_option_groups_org_id_idx on public.service_option_groups (org_id);

create trigger service_option_groups_set_updated_at
  before update on public.service_option_groups
  for each row execute function public.set_updated_at();

alter table public.service_option_groups enable row level security;


-- ------------------------------------------------------------
-- 4. service_options — one answer, and what it costs.
--
-- The two delta columns are the whole engine. "Waist" adds $40 and 60
-- minutes; "Small" adds $60 and 120 minutes. A booking's price and
-- duration are the base service plus the deltas of everything chosen.
--
-- Both may be NEGATIVE, and that is not an oversight. "Shoulder length"
-- taking an hour off a style priced at mid-back is the natural way for
-- a salon to describe it, and forbidding it would force every base
-- price to be the cheapest possible combination — which reads as a lie
-- on a price list. Migration 028 is where the total is floored, because
-- the total is the thing that must stay positive, not each part.
-- ------------------------------------------------------------
create table public.service_options (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id),
  group_id               uuid not null,
  name                   text not null,
  description            text,
  price_delta            numeric(10,2) not null default 0,
  duration_delta_minutes int not null default 0,
  display_order          int not null default 0,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,

  constraint service_options_id_org_key unique (id, org_id),

  constraint service_options_group_same_org
    foreign key (group_id, org_id)
    references public.service_option_groups (id, org_id)
);

comment on table public.service_options is
  'One answer to a booking question, carrying what it adds to the price and to the time. Both deltas may be negative.';

comment on column public.service_options.duration_delta_minutes is
  'Minutes this answer adds to the appointment. Negative is allowed; the TOTAL is what must stay positive, and that is enforced where the total is computed.';

create unique index service_options_group_name_key
  on public.service_options (group_id, name)
  where deleted_at is null;

create index service_options_org_id_idx   on public.service_options (org_id);
create index service_options_group_id_idx on public.service_options (group_id);

create trigger service_options_set_updated_at
  before update on public.service_options
  for each row execute function public.set_updated_at();

alter table public.service_options enable row level security;


-- ------------------------------------------------------------
-- 5. service_option_group_links — which questions each style asks.
--
-- Knotless braids ask about size, length and boho finish. A men's
-- haircut asks nothing at all and has no rows here, which is how "no
-- questions" is expressed: by absence, not by a flag.
--
-- depends_on_option_id is the branching in the mind map. "What colour
-- hair?" is only asked once you have answered "the salon provides the
-- hair", so that link row points at that answer. Null means always ask.
--
-- One level of dependency, deliberately. A question that depends on a
-- question that depends on a question is a flow chart nobody can hold
-- in their head, and the salon's tree does not need one.
-- ------------------------------------------------------------
create table public.service_option_group_links (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations (id),
  service_id            uuid not null,
  group_id              uuid not null,
  depends_on_option_id  uuid,
  display_order         int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint service_option_group_links_service_same_org
    foreign key (service_id, org_id)
    references public.services (id, org_id),

  constraint service_option_group_links_group_same_org
    foreign key (group_id, org_id)
    references public.service_option_groups (id, org_id),

  constraint service_option_group_links_depends_same_org
    foreign key (depends_on_option_id, org_id)
    references public.service_options (id, org_id)
);

comment on table public.service_option_group_links is
  'Which questions a service asks, in what order, and which earlier answer makes a question appear at all.';

create unique index service_option_group_links_pair_key
  on public.service_option_group_links (service_id, group_id)
  where deleted_at is null;

create index service_option_group_links_org_id_idx     on public.service_option_group_links (org_id);
create index service_option_group_links_service_id_idx on public.service_option_group_links (service_id);
create index service_option_group_links_group_id_idx   on public.service_option_group_links (group_id);

create trigger service_option_group_links_set_updated_at
  before update on public.service_option_group_links
  for each row execute function public.set_updated_at();

alter table public.service_option_group_links enable row level security;


-- ------------------------------------------------------------
-- 6. appointment_options — what this customer actually chose.
--
-- Everything above describes the menu. This records one person's
-- answers on one day, and it SNAPSHOTS them.
--
-- The name, the money and the minutes are copied onto the row rather
-- than read through the foreign key, for the same reason appointments
-- already snapshot `price`: the salon will put its prices up, and an
-- appointment from March must still add up in June. The foreign key is
-- kept so the two can be compared; the copy is what is trusted.
--
-- appointments needs (id, org_id) unique before it can be referenced
-- that way. Same one-line addition migration 008 made to profiles and
-- services, and trivially true since id is already the primary key.
-- ------------------------------------------------------------
alter table public.appointments
  add constraint appointments_id_org_key unique (id, org_id);

create table public.appointment_options (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations (id),
  appointment_id         uuid not null,
  option_id              uuid,
  group_name             text not null,
  option_name            text not null,
  price_delta            numeric(10,2) not null,
  duration_delta_minutes int not null,
  created_at             timestamptz not null default now(),

  constraint appointment_options_appointment_same_org
    foreign key (appointment_id, org_id)
    references public.appointments (id, org_id),

  -- Nullable, and on purpose. An option the salon later deletes must
  -- not take the record of a past booking with it, and must not stop
  -- that booking being read. The snapshot columns carry the meaning.
  constraint appointment_options_option_same_org
    foreign key (option_id, org_id)
    references public.service_options (id, org_id)
);

comment on table public.appointment_options is
  'The answers one customer gave, with the price and minutes as they were on the day. Snapshots, not lookups.';

create index appointment_options_org_id_idx         on public.appointment_options (org_id);
create index appointment_options_appointment_id_idx on public.appointment_options (appointment_id);

-- No updated_at and no soft delete. A row here is a historical fact
-- about one booking; it is written once by create_appointment() and
-- never edited. Changing an appointment's options means writing the
-- appointment again, which is a decision for migration 028.
alter table public.appointment_options enable row level security;


-- ------------------------------------------------------------
-- 7. Column privileges.
--
-- The four menu tables are the public price list in a different shape,
-- so anon reads them column by column exactly as it reads services.
-- Nothing here is a secret: these are the questions a customer is about
-- to be asked and the prices they are about to be quoted.
--
-- appointment_options is the opposite and gets NOTHING for anon. It is
-- one identified person's booking. It is written by create_appointment()
-- in migration 028, which is security definer and therefore does not
-- need a grant to insert on the caller's behalf.
--
-- DELETE is granted to nobody, as everywhere else.
-- ------------------------------------------------------------
revoke all on public.service_categories          from anon, authenticated;
revoke all on public.service_option_groups       from anon, authenticated;
revoke all on public.service_options             from anon, authenticated;
revoke all on public.service_option_group_links  from anon, authenticated;
revoke all on public.appointment_options         from anon, authenticated;

grant select (id, org_id, parent_id, name, display_order)
  on public.service_categories to anon;
grant select (id, org_id, name, prompt, selection, is_required, display_order)
  on public.service_option_groups to anon;
grant select (id, org_id, group_id, name, description, price_delta,
              duration_delta_minutes, display_order)
  on public.service_options to anon;
grant select (id, org_id, service_id, group_id, depends_on_option_id, display_order)
  on public.service_option_group_links to anon;

grant select on public.service_categories         to authenticated;
grant select on public.service_option_groups      to authenticated;
grant select on public.service_options            to authenticated;
grant select on public.service_option_group_links to authenticated;
grant select on public.appointment_options        to authenticated;

grant insert (org_id, parent_id, name, display_order, is_active)
  on public.service_categories to authenticated;
grant update (parent_id, name, display_order, is_active, deleted_at)
  on public.service_categories to authenticated;

grant insert (org_id, name, prompt, selection, is_required, display_order, is_active)
  on public.service_option_groups to authenticated;
grant update (name, prompt, selection, is_required, display_order, is_active, deleted_at)
  on public.service_option_groups to authenticated;

grant insert (org_id, group_id, name, description, price_delta,
              duration_delta_minutes, display_order, is_active)
  on public.service_options to authenticated;
grant update (group_id, name, description, price_delta, duration_delta_minutes,
              display_order, is_active, deleted_at)
  on public.service_options to authenticated;

grant insert (org_id, service_id, group_id, depends_on_option_id, display_order)
  on public.service_option_group_links to authenticated;
grant update (depends_on_option_id, display_order, deleted_at)
  on public.service_option_group_links to authenticated;

-- The two new columns on services join the existing lists.
grant select (category_id, is_included_with_others) on public.services to anon;
grant insert (category_id, is_included_with_others) on public.services to authenticated;
grant update (category_id, is_included_with_others) on public.services to authenticated;


-- ------------------------------------------------------------
-- 8. Policies.
--
-- The anon policies are not scoped to one organization, matching
-- services_select_anon: every salon's menu is public by definition, the
-- application picks the salon by slug, and multi-tenancy protects
-- private data rather than a printed price list.
--
-- Writing is gated on service.manage, the permission migration 007
-- created for exactly this — prices and durations. No new permission is
-- added here, because "may edit the braiding options" is not a
-- different job from "may edit the prices".
-- ------------------------------------------------------------
create policy service_categories_select_anon
  on public.service_categories for select to anon
  using (deleted_at is null and is_active);

create policy service_categories_select_member
  on public.service_categories for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy service_categories_insert
  on public.service_categories for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('service.manage'));

create policy service_categories_update
  on public.service_categories for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('service.manage'))
  with check (org_id = public.current_org_id());


create policy service_option_groups_select_anon
  on public.service_option_groups for select to anon
  using (deleted_at is null and is_active);

create policy service_option_groups_select_member
  on public.service_option_groups for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy service_option_groups_insert
  on public.service_option_groups for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('service.manage'));

create policy service_option_groups_update
  on public.service_option_groups for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('service.manage'))
  with check (org_id = public.current_org_id());


create policy service_options_select_anon
  on public.service_options for select to anon
  using (deleted_at is null and is_active);

create policy service_options_select_member
  on public.service_options for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy service_options_insert
  on public.service_options for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('service.manage'));

create policy service_options_update
  on public.service_options for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('service.manage'))
  with check (org_id = public.current_org_id());


create policy service_option_group_links_select_anon
  on public.service_option_group_links for select to anon
  using (deleted_at is null);

create policy service_option_group_links_select_member
  on public.service_option_group_links for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy service_option_group_links_insert
  on public.service_option_group_links for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('service.manage'));

create policy service_option_group_links_update
  on public.service_option_group_links for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('service.manage'))
  with check (org_id = public.current_org_id());


-- Staff read a customer's choices as part of reading the appointment.
-- There is no insert or update policy: rows arrive through
-- create_appointment() and are never edited afterwards.
create policy appointment_options_select_member
  on public.appointment_options for select to authenticated
  using (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 9. Audit.
--
-- 'routine' for the four menu tables, matching services: this is
-- operational configuration, and the money that matters legally is the
-- snapshot copied onto the appointment.
--
-- appointment_options has no audit trigger, and that is deliberate
-- rather than forgotten. Its rows are written only inside
-- create_appointment(), which already writes one audit event for the
-- appointment itself. A second event per option would put six rows in
-- the log for one booking and bury the event that matters.
-- ------------------------------------------------------------
create trigger service_categories_audit
  after insert or update on public.service_categories
  for each row execute function public.audit_row('service_category', 'routine');

create trigger service_option_groups_audit
  after insert or update on public.service_option_groups
  for each row execute function public.audit_row('service_option_group', 'routine');

create trigger service_options_audit
  after insert or update on public.service_options
  for each row execute function public.audit_row('service_option', 'routine');

create trigger service_option_group_links_audit
  after insert or update on public.service_option_group_links
  for each row execute function public.audit_row('service_option_link', 'routine');
