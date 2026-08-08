# PROJECT.md — What Amahle Is and Where It's Going

> Read this file before your first response in any session.
> CLAUDE.md tells you *how to behave*. This file tells you *what you're
> building and why the decisions were made*.

---

## What we're building

Amahle is a business operating system for beauty businesses — salons,
barbershops, spas. The long-term vision is a multi-tenant platform where any
beauty business signs up and gets a public website, online booking, customer
records, staff management, inventory, finances, and analytics, all connected,
with data isolated per business.

That is the destination. It is not what we are building now.

## What we're actually building right now

One real hair salon. They currently take bookings by phone and write them on
paper. They have no website. Nothing is lost to them if our software is rough,
because they aren't giving up a system to use it — they're adding one.

v1 is:

1. A public website with services, prices, staff, and contact info
2. An online booking form for their customers
3. One shared calendar their staff can also write to by hand
4. Customer and employee records
5. Role-based permissions

That's it.

## The most important thing to understand about v1

The salon will keep taking phone bookings. They will not stop. If our calendar
only receives bookings made through the website, it will be wrong within one
day, staff will stop trusting it, and they will go back to paper.

So: **ONE calendar, TWO entry paths.** The public booking form and the staff
manual-entry form must write to the same place, through the same code path,
with the same validation and conflict detection. Staff manual entry is not an
admin convenience feature — it is the feature that decides whether this project
survives contact with reality.

## Who uses it

- **Salon owner** — sees everything, manages staff and services
- **Receptionist** — front desk, enters phone bookings, checks people in
- **Stylist** — sees their own schedule and their customers' notes
- **Customer** — never logs in; books through the public site by giving a name,
  phone, and optionally email

Customers having no accounts is deliberate. Account creation is friction at the
exact moment someone has decided to book. We create or update their profile from
the phone number instead.

## Why the architecture looks over-built for one salon

Several decisions cost more today than a single-salon app needs. They are
deliberate, and here is the reasoning so nobody "simplifies" them later.

**org_id on every table, always.** The platform is multi-tenant by design.
Retrofitting a tenant boundary onto a live database with real customer and
appointment data is one of the most expensive refactors in software. Adding the
column now costs almost nothing. There is exactly one organization in the
database today; the code must never assume that.

**Row-level security in Postgres, not checks in the UI.** UI-layer security is a
suggestion. A bug in a query, a new endpoint, an AI-generated route that forgets
a filter — any of these leak one business's data to another. At the database
layer, the leak is impossible rather than unlikely.

**Permissions as database rows, not hardcoded booleans.** The spec commits to
per-organization customizable permissions. `if (role === 'owner')` scattered
through the codebase makes that literally unbuildable. Roles and permissions are
data, joined at query time.

**Soft-delete everywhere.** Appointment and financial records have legal
retention implications, and a deleted customer record destroys service history a
stylist may need. Set `deleted_at`. Never DELETE.

**Audit log from day one.** Every create, update, and delete writes an event.
Two tiers: financial and customer-data actions are permanent and detailed;
routine operational actions are lighter. Retrofitting an audit trail means
retrofitting it into every write path in the app.

**Auth isolated in one module.** All authentication and permission-checking
lives in `/lib/auth`. Nothing else calls Supabase auth directly. A previous
project scattered identity handling and paid for it with a painful mid-project
refactor.

**One canonical creation path per record type.** `createAppointment()` exists
once. Website form, staff form, and any future import all call it. Duplicate
records come from having a second way to make a thing.

## Sensitive data — handle with care

Customer records include allergies, sensitivities, hair formulas, and internal
staff flags. Some flags are operational ("Prefers morning appointments"). Some
are serious — "Staff Safety Alert," "Outstanding Balance," "Do Not Book Online."

These are notes about real people who never consented to an account and will
never see the system. They need field-level permission control: a stylist sees a
customer's allergies, not their outstanding balance. This is decided now because
retrofitting field-level permissions is worse than retrofitting multi-tenancy,
and because getting it wrong has real legal exposure.

## What we are deliberately NOT building in v1

Do not build these. Do not scaffold for them. Do not add "just a small
placeholder" for them.

payments · inventory · financial management · analytics dashboards · website CMS
· notifications beyond a booking confirmation · task and maintenance center ·
internal notes system · gift cards · blog · product store · multi-location ·
every AI feature

The full specification describes eighteen modules and twelve AI features. That
document is a destination, not a build order. Most of those modules are
downstream of having months of real appointment data — building them now means
building against imagined usage.

Specifically on the CMS: the spec says owners should never need a developer to
edit their website. True eventually. For one salon, we ARE the developer, and a
config file is far faster to build than a content management system. The CMS
gets built when the third salon asks for it.

## Build order

1. Foundation documents and schema
2. RLS policies
3. Auth module
4. Public website (needs to be live at a real domain)
5. Services and staff data driven from the database
6. Online booking form
7. Staff calendar with manual entry
8. Role-based permissions UI

The website ships first and standalone because the salon needs a web presence
regardless of whether booking is finished.

## Stack

Next.js (App Router), TypeScript, Tailwind, Supabase (Postgres, Auth, RLS),
deployed on Vercel.

**One Supabase project for now — "Salon dev".** The eventual shape is still two
projects, dev and prod, with development never touching the salon's live data.
That split is deferred, not abandoned: a second project costs money on Supabase's
plan limits, and there is no real data to protect yet.

The trigger for creating prod is **the first real customer record** — not a date,
and not a phase. Until then Salon dev holds placeholder data and can be broken
freely. From the moment a real person's phone number or allergy note is in there,
a careless migration destroys something that cannot be recovered, and the split
must already exist. See DECISIONS.md #18.

## How we work

See CLAUDE.md for the enforced workflow. In short: plan before building, one
feature at a time, show before saving, explain in plain English, commit between
stages. The developer is self-taught and learning — the goal is that he
understands every piece of this, not that it gets built fast.
