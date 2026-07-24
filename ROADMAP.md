# ROADMAP.md — Amahle

Last updated: _[fill in date]_

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
- Two Supabase projects: **dev** and **prod**. Never develop against live salon
  data.

---

## Phases

### Phase 0 — Foundation
- [ ] Foundation docs in repo (PROJECT, CLAUDE, ROADMAP, DECISIONS, SCHEMA, GLOSSARY, SESSION_LOG, CHEATSHEET)
- [ ] `git init`, GitHub repo created
- [ ] Supabase dev project created
- [ ] Supabase prod project created
- [ ] Next.js app scaffolded, running locally
- [ ] Deployed to Vercel (placeholder page is fine)

### Phase 1 — Database
- [ ] Schema migration written and reviewed line by line
- [ ] Migration run on dev
- [ ] SCHEMA.md written in plain English
- [ ] RLS enabled on every table
- [ ] RLS policies written and reviewed as a separate step
- [ ] RLS tested: confirm a user from org A cannot read org B's rows
- [ ] Seed data for the real salon (services, employees, hours)

### Phase 2 — Auth
- [ ] `/lib/auth` module: who is this, what may they do
- [ ] Login page for staff
- [ ] Session handling
- [ ] Permission-checking helper used everywhere
- [ ] Confirm nothing outside `/lib/auth` calls Supabase auth

### Phase 3 — Public website
- [ ] Homepage
- [ ] Services and pricing page (driven from database)
- [ ] Team page (driven from database)
- [ ] Gallery
- [ ] Contact, hours, map
- [ ] Mobile layout checked on a real phone
- [ ] SEO basics: titles, descriptions, Open Graph
- [ ] Live at the salon's real domain

### Phase 4 — Booking
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

Notifications (SMS reminders) · CMS · basic revenue reporting · inventory ·
second salon onboarding · analytics · everything else in the spec

Nothing here gets built until the salon has used v1 for real, for weeks.

---

## Open questions

- [ ] Domain name — registered? Who controls it?
- [ ] SMS provider and cost, if we add reminders
- [ ] Does the salon have photos for the gallery, or do we need to arrange them?
- [ ] Deposit / no-show policy — does v1 need to display one?
- [ ] Which country's data protection law applies (GDPR / POPIA / other)?
