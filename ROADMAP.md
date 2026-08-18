# ROADMAP.md — Amahle

Last updated: 2026-08-17

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
- [ ] **`appointments` table** + RLS policies
- [x] **`employee_working_hours` and `employee_time_off` tables** — migration 013,
      2026-08-17. Rota times are `time` not `timestamptz`, so "Tuesday 9am"
      survives a clock change; several rows per day is a split shift, not a bug.
      No `reason` column on time off — deliberately, see SCHEMA.md. No new
      permission key: editing a rota is `employee.record.manage`. No `anon`
      grants, which is why availability has to be a database function the booking
      form calls rather than a query the browser runs
- [ ] Seed the salon's working hours
- [ ] `createAppointment()` — the one canonical creation path
- [ ] Availability calculation (service duration, buffers, working hours)
- [ ] Conflict detection
- [ ] Customer find-or-create by phone number
- [ ] Public booking form
- [ ] Confirmation page
- [ ] Booking confirmation message
- [ ] Audit log writes on every appointment change

### Phase 5 — Staff calendar
- [ ] Day view
- [ ] Week view
- [ ] **Manual appointment entry** (for phone bookings — critical)
- [ ] Edit and reschedule
- [ ] Cancel (soft-delete)
- [ ] Appointment status changes
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
- [ ] **Phone number normalisation.** `phone_digits` stops punctuation creating
      duplicates. It does not add a missing country code — that is the
      application's job, from an organization setting, in one helper every write
      path calls. Needs deciding when the booking form is built: where the setting
      lives (`public_settings` is the candidate — the public form must read it),
      and whether `libphonenumber-js` is worth a dependency or fifteen hand-written
      lines will do for a US salon
- [ ] Domain name — registered? Who controls it?
- [ ] SMS provider and cost, if we add reminders
- [ ] Does the salon have photos for the gallery, or do we need to arrange them?
- [ ] Deposit / no-show policy — does v1 need to display one?
- [ ] Which country's data protection law applies (GDPR / POPIA / other)?
