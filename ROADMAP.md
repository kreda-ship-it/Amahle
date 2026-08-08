# ROADMAP.md — Amahle

Last updated: 2026-08-08

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
- [x] RLS tested: a user from org A cannot read org B's rows — passed 1, 4, 4, 0. Re-runnable as `supabase/scripts/test-tenant-isolation.sql`
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
- [ ] `/lib/auth` module: who is this, what may they do
- [ ] Login page for staff
- [ ] Session handling
- [ ] Permission-checking helper used everywhere
- [ ] Confirm nothing outside `/lib/auth` calls Supabase auth

### Phase 3 — Public website
- [ ] **`services` table** + RLS policies (anonymous visitors read the bookable ones)
- [ ] **`employees` and `employee_services` tables** + RLS policies
- [ ] Seed the salon's real services, prices, and team
- [ ] Homepage
- [ ] Services and pricing page (driven from database)
- [ ] Team page (driven from database)
- [ ] Gallery
- [ ] Contact, hours, map
- [ ] Mobile layout checked on a real phone
- [ ] SEO basics: titles, descriptions, Open Graph
- [ ] Live at the salon's real domain

### Phase 4 — Booking
- [ ] **`customers` and `customer_flags` tables** + RLS policies. Sensitive fields — allergies, sensitivities, formulas — so field-level permissions are designed here, against real screens
- [ ] **`appointments` table** + RLS policies
- [ ] **`employee_working_hours` and `employee_time_off` tables** — availability can't be computed without them
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
- [ ] Customer allergies / sensitivities / formulas
- [ ] Field-level permissions on sensitive customer fields
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

- [ ] Domain name — registered? Who controls it?
- [ ] SMS provider and cost, if we add reminders
- [ ] Does the salon have photos for the gallery, or do we need to arrange them?
- [ ] Deposit / no-show policy — does v1 need to display one?
- [ ] Which country's data protection law applies (GDPR / POPIA / other)?
