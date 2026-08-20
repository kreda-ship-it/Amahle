# ROADMAP.md — Amahle

Last updated: 2026-08-18

---

## The four scope questions

**What problem does this solve?**

A hair salon takes bookings by phone and writes them on paper. Bookings get
lost, double-booked, and are invisible to anyone not standing at the front desk.
Customers can't book outside business hours, can't see services or prices
without calling, and the salon has no web presence at all. Amahle gives them a
public website, lets customers book online, and puts every appointment —
online or phoned in — on one shared calendar the whole team can see.

**Who is it for, specifically?**

One named hair salon: the owner, the receptionist, and the stylists. Plus their
customers, who will mostly be on phones and will never create an account.

Later, other beauty businesses. Not yet.

**What's the smallest version that's actually useful?**

A public website with services and prices, an online booking form, and one
shared calendar that staff can also write to by hand.

**What are we explicitly NOT building in v1?**

payments · inventory · financial management · analytics dashboards · website CMS
· notifications beyond a booking confirmation · task and maintenance center ·
internal notes system · gift cards · blog · product store · multi-location ·
AI features

---

## Stack

- Next.js (App Router), TypeScript, Tailwind
- Supabase — Postgres, Auth, Row-Level Security
- Vercel for deployment
- **One Supabase project for now** — "Salon dev". The dev/prod split is deferred,
  not abandoned; the trigger for creating prod is the first real customer record.
  When it happens, the current project becomes prod and the new one becomes dev.
  See DECISIONS #18.

---

## Phases

### Phase 0 — Foundation
- [x] Foundation docs in repo (PROJECT, CLAUDE, ROADMAP, DECISIONS, SCHEMA, GLOSSARY, SESSION_LOG, CHEATSHEET)
- [x] `git init`, GitHub repo created
- [x] Supabase dev project created
- [ ] Supabase prod project created
- [x] Next.js app scaffolded, running locally
- [ ] Deployed to Vercel (placeholder page is fine)

### Phase 1 — Multi-tenant foundation

Redefined 2026-08-08. This phase was originally "the whole database." It is now
the tenant boundary and the machinery every later table depends on. The remaining
tables moved into the phases that use them — see the note below.

- [x] Tenancy core: organizations, profiles, roles, permissions, role_permissions
- [x] Migrations run on dev, replayable into a fresh project
- [x] SCHEMA.md written in plain English
- [x] RLS enabled on every table
- [x] RLS policies written and reviewed as a separate step
- [x] Column-level grants — RLS hides rows, grants hide columns
- [x] RLS tested: a user from org A cannot read org B's rows. Re-runnable as `supabase/scripts/test-tenant-isolation.sql` — expected counts are in its header and change as migrations land
- [x] **`supabase/scripts/audit-tenant-safety.sql`** — added 2026-08-15. Asks the
      database what tables exist and reports any breaking the tenant rules, so it
      covers tables that don't exist yet. No rows means clean. Run after every
      migration. Found three real violations on its first run
- [x] Supabase CLI wired up
- [x] Permissions catalogue seeded
- [x] `create_organization()` — canonical onboarding path
- [x] `create_profile()` — canonical path to a login
- [x] Kedus organization created on dev, with its first Owner
- [x] **`audit_log` table** — trigger-written, append-only, unforgeable
- [x] **Every write to an audited table is logged** — including direct API updates, which no function-based approach would have caught

**Why `audit_log` was foundation and not a feature.** DECISIONS #5 commits to an
audit trail from day one, precisely because retrofitting one means retrofitting
it into every write path in the app. It was built while there were two write
paths. Two is a cheap number to fix. Ten is not.

Rows created before migration 006 — the Kedus organization, its roles, and the
first Owner profile — are not in the log. Backfilling would mean inventing
timestamps and actors.

**Where the other tables went.** Each table now arrives with the feature that
needs it, so its policies get written against a real use case instead of a
guessed one:

| Table | Now in |
|---|---|
| `services`, `employees`, `employee_services` | Phase 3 |
| `employee_working_hours`, `employee_time_off` | Phase 4 |
| `customers`, `customer_flags`, `appointments` | Phase 4 |

Run `test-tenant-isolation.sql` after adding any of them. If a new table is
missing its policy, the counts stop matching and you find out immediately.

### Phase 2 — Auth
- [x] `/lib/auth` module: who is this, what may they do
- [x] Login page for staff
- [x] Session handling — `src/proxy.ts` refreshes the token before every page
      load. It was `src/middleware.ts` until 2026-08-17; Next 16 deprecated that
      name in favour of `proxy`
- [x] Permission-checking helper used everywhere — `can()` and
      `requirePermission()` are the only way the app asks, and both delegate to
      `has_permission()` in Postgres. Used by `/staff`; every later page uses
      the same two.
- [x] Confirm nothing outside `/lib/auth` calls Supabase auth — verified by
      `grep -rn '\.auth\.' src`. Re-run it after adding any page.

**Done 2026-08-17, late.** Generated database types now exist and both Supabase
clients take `<Database>`, so a misspelled column is a compile error rather than
a blank page. The cast in `getProfile()` is gone. **Regenerate after every
migration** or the file describes a database that no longer exists:
`npx supabase gen types typescript --linked --schema public >
src/lib/supabase/database.types.ts`

### Phase 3 — Public website
- [x] **`services` table** + RLS policies — anonymous visitors read every *active*
      service, not only the online-bookable ones. `is_bookable_online` controls
      the Book button, not visibility. DECISIONS #23
- [x] **`employees` and `employee_services` tables** + RLS policies. `phone` and
      `email` are never granted to `anon`
- [x] Seed the salon's real services, prices, and team — 24 services with their
      real names, from kedushairsalonandbraiding.com. Prices, durations and all
      five employees are invented and marked as such in `seed-kedus.sql`.
      **Real durations block the Phase 4 booking form. The fictional staff must
      be replaced before this site reaches a real domain.**
- [x] **`gallery_images` table** + RLS policies — added 2026-08-17, migration 011.
      Guarded by `organization.edit` rather than a new key: the gallery is website
      content in the same way the tagline and the opening hours are. The same
      migration renamed `services.image_url` and `employees.photo_url` to
      `image_path` and `photo_path` — a stored URL carries the project's own
      domain and breaks the day the prod project exists
- [x] Homepage — every word read from the database. `getOrganization()` in
      `src/lib/site/organization.ts` is the only place a page learns which salon
      it serves; the slug comes from `SITE_ORG_SLUG`. No page names a salon
- [x] Services and pricing page (driven from database) — `formatPrice()` handles
      all three `price_display` settings, and a service that cannot be booked
      online still appears in full with its price and a note to call.
      DECISIONS #23
- [x] Team page (driven from database) — each person shown with the service
      *categories* they cover rather than all 24 services. An employee with no
      services renders no specialties line at all, which is the receptionist
      case working. Verified that `anon` is refused `employees.phone` outright
- [x] Gallery — the page is built and the empty state is what launches: a link
      to the Instagram account they genuinely keep current, rather than an
      empty grid. Currently holding three stock placeholders; see the launch
      checklist. Not Instagram's own images — those CDN URLs are signed and
      expire within hours
- [x] Contact, hours, map — a link that opens the visitor's own map app rather
      than an embedded map. On a phone it gives directions from where they
      actually are, loads no third-party script, and does not watch the visitor
      on the salon's behalf
- [ ] Mobile layout checked on a real phone
- [x] SEO basics: titles, descriptions, Open Graph — plus `robots.txt`,
      `sitemap.xml`, a share card generated from the salon's own name and
      tagline, and `HairSalon` structured data carrying the address, phone and
      all seven days of opening hours. See the launch checklist below: none of
      it is correct until `NEXT_PUBLIC_SITE_URL` points at a real domain
- [ ] Live at the salon's real domain — see the launch checklist below

---

## Before the site goes live — the launch checklist

Added 2026-08-17. Everything deferred during Phase 3, in one place, so that
"we'll do it before launch" is a list rather than a memory.

**Nothing here blocks building. All of it blocks a real domain.**

### Data the salon has to give us

- [ ] **Replace the five invented employees.** Selam, Marta, Hanna, Yonas and
      Sara are fictional. Real names, real positions, real bios. Someone will
      phone up and ask for Hanna otherwise
- [ ] **The real rota.** `seed-working-hours.sql` gives every bookable employee
      the salon's full opening hours with one invented day off. Who actually
      works which days, and whether anyone works part days, is the salon's to
      tell us. Availability is computed from it, so a wrong rota offers customers
      times nobody is there for
- [ ] **Real service durations.** Every duration in the database is invented.
      These also block Phase 4 — availability is computed from them, so a wrong
      duration double-books a stylist
- [ ] **Confirm the prices.** Only the two $40 entries came from the salon's own
      site. Every other number is a guess
- [ ] **Photographs.** The gallery currently holds three stock interiors of
      *other salons*, captioned PLACEHOLDER. Needed: the shopfront, 8–12
      finished styles, and headshots of the real team. Retire the placeholders
      with `update ... set deleted_at = now()` — never DELETE
- [ ] **A hero image and a logo**, then set `hero_image`, `hero_image_alt` and
      `logo` in `public_settings`
- [ ] **Confirm the Instagram handle.** Their site says `kedus_hb`; the TikTok
      is `kedushairsalon`. One of them may be stale

Address confirmed 2026-08-17 — the DC-street-with-Maryland-ZIP question is
settled, and the map link is correct.

### Technical

- [ ] **Deploy to Vercel** — Phase 0 has never been ticked
- [ ] **Set `NEXT_PUBLIC_SITE_URL`** to the real domain. Until it is set, every
      Open Graph tag, the sitemap and the structured data all advertise
      `localhost:3000`. It falls back to Vercel's production URL, which is
      right for a staging check and wrong for a launch
- [ ] **Check the share card for real.** Paste the link into WhatsApp and
      iMessage. This cannot be tested from localhost — those services fetch
      the page from their own servers
- [ ] **Mobile layout on a real phone.** Not a narrowed browser window
- [ ] **Prod Supabase project.** Trigger is the first real customer record, not
      launch day — but a public booking form is how that record arrives. See
      DECISIONS #18

### Ours to write

- [ ] **DECISIONS #25** — how the public site resolves its organization
      (`SITE_ORG_SLUG` now, request hostname later), and the four-step workflow
      for onboarding a second salon. Reasoning is currently only in commit
      `ca0f032`
- [ ] **DECISIONS #26** — theme tokens in, never raw CSS from the database.
      Why the token structure exists now and the database-driven half does not
- [ ] **SESSION_LOG** entry for 2026-08-15 (the app half). Both 2026-08-17
      entries are written

### The salon's own homework

- [ ] **Google Business Profile.** Free, they set it up themselves, and for a
      local salon it is worth more than every piece of SEO in this repo. The
      code helps Google understand the site; the profile is what puts them on
      the map with photos, hours and reviews

---

### Phase 4 — Booking
- [x] **`customers`, `customer_care_notes` and `customer_flags` tables** + RLS
      policies — migration 012, 2026-08-17. Field-level permissions turned out to
      need a *separate table*, not column grants: a grant is granted to a Postgres
      role and all staff share one, so it can say "all staff" or "no staff" but
      never "stylists yes, receptionists no". DECISIONS #27. Four new keys, and
      the first permissions Receptionist and Stylist have ever held. Matching is
      on `phone_digits`, a generated column, so punctuation cannot create a second
      Sara. Proven by `test-tenant-isolation.sql`, extended to cover a customer,
      an allergy and a flag: `1, 4, 21, 0, 0, 0, 0, 0, 0, 0`
- [x] **`appointments` table** + RLS policies — migration 014, 2026-08-17.
      Three timestamps, not two: `blocked_until` is `ends_at` plus the service
      buffer, so the calendar cannot book into the cleanup gap. Times and price
      are filled by a trigger from the service, on both write paths. Stylists
      see their own schedule with no permission key, via `current_employee_id()`
      — pulled forward from Phase 5 because it is a row-level rule and belongs
      with the table
- [x] **`employee_working_hours` and `employee_time_off` tables** — migration 013,
      2026-08-17. Rota times are `time` not `timestamptz`, so "Tuesday 9am"
      survives a clock change; several rows per day is a split shift, not a bug.
      No `reason` column on time off — deliberately, see SCHEMA.md. No new
      permission key: editing a rota is `employee.record.manage`. No `anon`
      grants, which is why availability has to be a database function the booking
      form calls rather than a query the browser runs
- [x] **Seed the salon's working hours** — `supabase/scripts/seed-working-hours.sql`,
      2026-08-18. **Placeholder, and invented like the five employees it fills in
      for.** Every bookable employee works the salon's own opening hours, read
      live from `public_settings` rather than typed in, with one day off each
      cycling Mon/Tue/Wed/Thu/Sun — never Friday or Saturday. It refuses to run
      twice, because the table has no unique constraint (split shifts are normal)
      and a second run would silently double every rota
- [x] **`createAppointment()` — the one canonical creation path** — migration
      015 plus `src/lib/appointments/create.ts`, 2026-08-18. The rules are in
      Postgres and that is forced, not chosen: a customer booking online arrives
      as `anon`, which has no grant on `customers` or `appointments`, so
      application code cannot write their booking at all. `source` is derived
      from who is calling rather than passed in. Proven by
      `supabase/scripts/test-create-appointment.sql` — five checks, all passing
- [x] **Availability calculation** — migration 016, 2026-08-18.
      `get_available_slots()`, computed live from the rota, time off and
      existing appointments. Nothing precomputed, so there is no cache to go
      stale. Customers only: staff may overrule opening hours and are stopped
      only by the exclusion constraint. Migration 017 made `buffer_minutes`
      nullable — null inherits the salon's `default_buffer_minutes`, so a
      service added later cannot silently claim it needs no gap. Proven by
      `supabase/scripts/test-availability.sql`, eight checks
- [x] **Conflict detection** — migration 014. Not a check: an exclusion
      constraint on `(employee_id, tstzrange(starts_at, blocked_until))`, so the
      second booking is refused by the database. Checking first leaves a gap
      between the check and the insert, which is exactly where the website and
      the receptionist collide. Cancelled and no-show rows stop holding the slot
- [x] **Customer find-or-create by phone number** — migration 015. Fills
      blanks, never overwrites: a returning customer typing "Sara" where the
      salon wrote "Sara T." must not rewrite the record. `normalize_phone()`
      adds a missing country code from the organization's `country_dial_code`
- [~] **Wash-aware scheduling — deferred 2026-08-18.** Specified in full below, not built. Washing is done
      by different people from the stylists, so a customer needing a wash can
      arrive *before* the stylist is free — the washer takes them while the
      stylist finishes the previous client. The salon's rule: start 5 minutes
      before the previous appointment ends, no buffer.
      - A wash takes about **30 minutes**
      - **Three wash sinks**, so at most three customers can be washed at once.
        The count must be editable — sinks get added, and one can be broken
      - Each service carries a **usual answer**, and the booking form asks anyway
        so a customer who washed at home can say so
      - **This needs a schema change.** The exclusion constraint currently
        reserves the stylist from `starts_at` to `blocked_until`; a customer
        arriving before the previous appointment ends makes those overlap and
        the database refuses the booking. When the stylist is *needed* has to
        become separate from when the customer *arrives*
      - **Three sinks is a capacity limit, not a pairwise clash**, so no
        exclusion constraint can express it. It needs a count inside
        `create_appointment()`, and a lock if it is to be airtight
      - **What deferring costs, so it is a choice and not an oversight.**
        Availability currently assumes the stylist is occupied from the moment
        the customer arrives. So the salon keeps the ~10 minutes per changeover
        that the wash model would have recovered, and a customer needing a wash
        is offered the same times as one who does not. Nothing is wrong; the day
        is simply less tightly packed than it could be. The receptionist can
        still squeeze a wash in by phone, because staff bypass availability
      - **Build it as SEGMENTED SERVICES, not as a wash feature.** Added
        2026-08-20. Every established salon platform models a service as a
        sequence — **active, gap, active** — rather than one solid block.
        Colour is applied, it develops for forty minutes with the stylist
        free, then it is rinsed and finished. A wash by a different person is
        the same shape, and so is any assistant-led step. Build it for washes
        alone and it gets built again the first time somebody asks about
        colour processing time. Segments cover all of them, and they also
        cover the case the salon has not raised yet: a stylist starting a
        second client during the first one's development time, which is where
        the recovered revenue actually is
      - **DECISIONS #30 does not block this.** `schedule_permits()` asks
        whether a span fits inside one working window. Segments turn one span
        into several, so the question becomes "does each segment fit" — the
        four rules survive, and nothing else on the write path has to move
- [x] **Public booking form** — stages A to E, plus holds
      - [x] **Stage A — the picker.** Service, stylist or anyone, day, time.
            `/book`, state held in the URL so the back button works and times
            never age in a cache
      - [x] **Stage B — details and submit**, 2026-08-18. Name and phone through
            `createAppointment()`. Validation here covers only what a *form*
            knows about — that the boxes are filled in; every real rule is the
            database's, because it holds whatever calls it. On a taken slot the
            same time with a different stylist is offered first, then the
            nearest other times that day. No new query: every slot already
            carries its stylist, which makes "someone else, same time" a filter
            rather than a feature
      - [x] **Stage C — confirmation page**, 2026-08-18, at
            `/book/confirmed/<reference>`. The appointment's own id is the
            reference — the customer has no account and never will, so the link
            is the whole credential. `get_booking_confirmation()` returns no
            customer name, phone, email or notes: the link will be forwarded,
            so everything it returns is written to be harmless in a stranger's
            hands. Not indexed. No cancel button — cancelling online is not in
            v1, and a button that quietly does nothing is worse than none
      - [x] **Stage D — several services for one customer**, 2026-08-19. "Blow dry and trim
            for her." **No buffer between them** — the buffer resets the station
            between *customers*, so a chained booking is duration + duration end
            to end with the buffer applied once at the finish. Getting that
            wrong adds dead minutes to every combined booking. Needs
            availability to take a list of services, atomic creation of one row
            per service, and a group tying them into one visit
      - [x] **Holds**, migrations 022 and 023, 2026-08-19. A slot is reserved
            for fifteen minutes between choosing a time and confirming it, so
            the second customer never sees it rather than being refused at the
            end. Choosing a different time releases the previous hold at once.
            Picking a time is a form rather than a link, because holding is a
            write and a write must not happen because a page was loaded — a
            crawler or a prefetch would start reserving the afternoon
      - [x] **Stage E — more than one person**, 2026-08-19. Specified 2026-08-18. Ask how
            many people up front, then take each person in turn: service,
            stylist, day, time — "like two different people booking". No
            combinatorial search for two simultaneously-free stylists; it is the
            same calculation run twice. Once person 1 holds 10:45 with Hanna,
            person 2's times at 10:45 with anyone else are shown first, labelled
            as matching.
            **Answered 2026-08-19:** person 1's slot is *held*, not booked —
            the holds built in migrations 022 and 023 are exactly the mechanism
            this needed
- [x] **Confirmation page** — stage C above
- [~] **Booking confirmation message — deferred 2026-08-18.** No automated
      message in v1. The confirmation page at `/book/confirmed/<reference>` is
      the confirmation: immediate, permanent, and something the customer can
      come back to. The salon texts by hand from the number it already uses, as
      it does today. DECISIONS #29
      - **Marking a booking confirmed is Phase 5 work.** The salon rings or
        texts the customer the day before; `pending` → `confirmed` is that
        landing. Nothing can make that change today, so every appointment sits
        at `pending` until the calendar exists
- [x] **Audit log writes on every appointment change** — migration 014, at
      `critical` tier, by trigger rather than by application code, so a direct
      API write is logged too

### How times are offered — designed 2026-08-20, not built

Five changes to what the picker shows, in the order they should happen. None of
them touch `schedule_permits()`, which is the point of DECISIONS #30: what is
*offered* can be reshaped freely, and `test-availability.sql` check 9 fails the
moment a change would offer something the write path refuses.

1. **A clock-aligned grid, alongside the anchored times.** Today a free stretch
   beginning at 11:35 offers 11:35, 12:05, 12:35 — and never 12:00, which is
   free the whole time. The sequence inherits its offset from wherever the
   previous appointment happened to end, so one customer's straw curl sets the
   rhythm of the rest of the day. Nobody chose that; it is a side effect.
   Offering both the anchored time and a round grid gives the salon its packing
   and the customer a time they would say out loud.
   **What it costs, so it is a choice and not a freebie:** someone books 12:00
   instead of 11:35, leaving 25 dead minutes — and the person who would have
   taken 11:35 now cannot, because their trim would run past 12:00. Offering
   the round number can destroy the tight one. Worth it here: an offered time
   that converts beats a tight time nobody picks. Note the limit in the
   comment — wall-clock alignment uses the same epoch arithmetic as
   `round_up_to_minutes()`, which is exact for any timezone whose offset
   divides evenly by the grid. Fine for 30 minutes anywhere in the US; Nepal's
   5:45 offset would drift
2. **One button per time, not per stylist.** With "anyone" chosen the picker
   renders a separate button for every qualified stylist at every time — four
   buttons all saying 09:00. At today's 105 minute step that is about 24
   buttons a day; at 30 it becomes 80 on a phone. Show each time once and
   assign the stylist on tap. The full list stays server-side, so "someone else
   at the same time" keeps working — it reads the list, not the buttons
3. **`slot_step_minutes` to 30.** One `UPDATE`, no migration, but only after 2
   or the page gets worse rather than better. **Write down the rule and not the
   number: the step should be about as long as the shortest bookable service.**
   30 is right because Trim, Men's Haircut and Children's Haircut are all 30
   minutes. Add a 20 minute service next spring and that reasoning expires
   silently unless the rule is recorded
4. **Morning / afternoon / evening grouping.** Two-level narrowing, which is
   what a long list actually needs. Considered and rejected: an alarm-clock
   style hour-and-minute picker with unavailable values greyed out. A wheel is
   a grid, and migration 018 deliberately threw the grid away — the valid
   minutes are irregular ({10, 40} in the morning, {45}, then {15, 45}) because
   they are anchored to when the previous appointment ended plus *that
   customer's* buffer. The minute column would re-grey on every hour change and
   hold one or two live values out of sixty. Once the clock grid in 1 exists
   the two designs largely converge, and this becomes a layout preference
   rather than a correctness question
5. **Short services on the menu.** Nothing to build — the gap model already
   fits any duration into any stretch that will hold it, because availability
   subtracts busy ranges rather than stepping a grid. Two things to remember
   when they arrive: give a short service an **explicit** buffer rather than
   letting it inherit the house default (migration 019's comment already warns
   that a 10 minute default is half of a 20 minute service), and revisit the
   step rule in 3. The cleaner end state is probably to drop the salon-wide
   step entirely and step by each service's own length — self-tuning, with the
   grid in 1 providing the tidiness the step was invented for

### Phase 5 — Staff calendar
- [ ] Day view
- [ ] Week view
- [ ] **Manual appointment entry** (for phone bookings — critical)
- [ ] Edit and reschedule
- [ ] Cancel (soft-delete)
- [ ] Appointment status changes
- [ ] **Marking a no-show — in the FIRST version of the calendar, not a later
      one.** Added 2026-08-20. DECISIONS #12 defers deposits until "no-shows
      become a measured problem the salon complains about", and DECISIONS #29
      defers reminders on a similar trigger. Neither trigger can fire today:
      nothing in the system can set an appointment to `no_show`, so there is no
      number to measure. Salon no-show rates typically run 15–25%; reminders
      cut that by around a third, and reminders plus a deposit take it under
      ten percent. Three months of real rows turns that from an argument into
      arithmetic. Costs nothing to include now and cannot be backfilled later
- [ ] Stylist sees only their own schedule; owner sees all

### Phase 6 — Records and permissions
- [ ] Customer list and detail view
- [ ] Customer history (past appointments)
- [ ] Customer allergies / sensitivities / formulas — the screen. The data and
      its policies landed in migration 012
- [x] **Field-level permissions on sensitive customer fields** — done in the
      database by migration 012, ahead of this phase, because the tables had to
      be built and there is no such thing as building them without deciding
      this. Enforced as a separate table rather than column grants; DECISIONS #27.
      What remains here is a screen, not a mechanism
- [ ] Employee list and profiles
- [ ] Working hours and availability management
- [ ] Roles and permissions management UI

### Phase 7 — Handover
- [ ] Train the salon staff
- [ ] Watch them use it for one real day, take notes, fix what breaks
- [ ] Decide v2 scope based on what they actually asked for

---

## After v1 — candidate order, not committed

Notifications (SMS reminders) · **customer login via one-time code, so customers
can see their own booking history** (DECISIONS #20) · CMS · basic revenue
reporting · inventory · second salon onboarding · **platform admin area, built on
the service role** (DECISIONS #19) · analytics · everything else in the spec

Nothing here gets built until the salon has used v1 for real, for weeks.

---

## Open questions

- [ ] **Permissions per staff member, not just per role.** Raised 2026-08-17 while
      approving the customer permission grid. Today `role_permissions` attaches a
      permission to a *role*: change what a Stylist can see and every stylist
      changes with them. The ask was to vary it per person — "Hanna can see
      financial flags, other stylists can't." Not built, and deliberately not
      smuggled into migration 012: it means a new table of per-profile overrides
      and a rewrite of `has_permission()`. Decide it in Phase 6 alongside the
      permissions UI, and write it up as a DECISIONS entry either way — including
      if the answer is "roles are enough, make more roles".

      **Why this one is safe to defer, when `org_id` and `audit_log` were not.**
      Asked 2026-08-17: are we accumulating structure we will regret by putting
      the permissions work late? No — and the reason is worth keeping. Multi-
      tenancy and the audit trail had to be day-one because they touch every
      table and every write path; retrofitting means retrofitting everywhere.
      Every policy in this database asks `has_permission()`, and that is **one
      function**. Adding per-profile overrides later changes that function and
      adds a table. No policy changes. The single chokepoint was built on purpose
      so this decision could wait, and it can.

      Note also what would *not* have helped: building the Phase 6 permissions UI
      early. It is a screen over `role_permissions`, and would not have removed a
      single split table — those come from Postgres granting columns to database
      roles, which no amount of application code changes
- [x] **Phone number normalisation** — settled 2026-08-18. `normalize_phone()`
      in migration 015, reading `country_dial_code` from the organization's
      `public_settings`. No dependency: `libphonenumber-js` was not worth it for
      a US salon, and the rule is about twenty lines. The limit to remember is
      that it cannot know a country drops a leading zero when the code is added
      — revisit if a salon outside the US onboards
- [ ] Domain name — registered? Who controls it?
- [ ] **SMS provider, cost, and A2P 10DLC.** Deferred 2026-08-18, not
      dismissed. Whenever automated texts are wanted, US carriers require A2P
      10DLC registration — the business and then the campaign — before messages
      from an ordinary 10-digit number are delivered reliably. Unregistered
      traffic is **silently filtered**, not rejected, so it looks like it works.
      Days to weeks, waiting on someone else's queue, so it is the item to start
      first rather than last
- [ ] Does the salon have photos for the gallery, or do we need to arrange them?
- [ ] **Does the receptionist get `service.manage`?** Raised 2026-08-20. The
      assumption in conversation was that the owner *and receptionist* can
      change how long a service takes. The database does not allow that today:
      `service.manage` is held by Owner and Manager only. One row in
      `role_permissions` changes it — but note the same key also controls
      **prices**, because its description is "Add and edit services, prices and
      durations". There is no way to hand over durations without handing over
      prices unless a second key is created, which is the same shape of
      decision as DECISIONS #24. Recommendation: one key is enough and the
      receptionist should have it — they are the person who knows a particular
      customer's colour runs long. Decide it in Phase 6 with the permissions
      UI and write it up either way
- [ ] **Teach `audit-tenant-safety.sql` about `appointment_holds`.** Raised
      2026-08-20. It now reports two warnings that are both deliberate and both
      documented in migration 022: no `deleted_at` (because `released_at` does
      that job and says what actually happened) and RLS on with no policies
      (because the table is reached only through `hold_slot()` and
      `get_holds()`, which is what stops a browser reserving every slot in the
      salon). The script's own promise is "no rows means clean". While that is
      false, people learn to scroll past the output, which costs more than the
      warnings are worth
- [ ] Deposit / no-show policy — does v1 need to display one?
- [ ] Which country's data protection law applies (GDPR / POPIA / other)?
