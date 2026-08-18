# SCHEMA.md — Amahle

Plain-English description of every table and column. The migration file is the
truth; this file is how you understand it.

**Keep this updated with every migration.** A stale SCHEMA.md is worse than none.

---

## Rules that apply to every table

| Column | Meaning |
|---|---|
| `id` | uuid, primary key |
| `org_id` | uuid, non-null, foreign key to `organizations`. Which business owns this row. |
| `created_at` | timestamp, set automatically |
| `updated_at` | timestamp, updated automatically |
| `deleted_at` | timestamp, null means alive. We never actually delete rows. |

Every table has RLS enabled. Every query is scoped by `org_id`.

**How the database knows your organization.** Two functions in Postgres, used by
every policy:

- `current_org_id()` — the org of the logged-in user, or null when logged out
- `has_permission('some.key')` — true if their role holds that permission

Both are `security definer`, which is what lets them read `profiles` without
tripping `profiles`' own policy and recursing forever. See DECISIONS.md #16.

**RLS hides rows. Grants hide columns.** A policy granting access to a row grants
access to *every column* of it. Where a column must stay hidden — such as
`organizations.private_settings` — that is a column-level `grant`, not a policy.

**Where that rule stops working.** A grant is granted to a *Postgres* role, and
there are only three: `anon`, `authenticated`, `service_role`. It separates the
public internet from logged-in staff. It cannot separate one member of staff from
another, because they all connect as `authenticated`. When a column needs a
different audience *within* the salon, it moves to its own table and the rule
becomes a row-level policy calling `has_permission()`. That is why
`customer_care_notes` exists. See DECISIONS #27.

**Nothing has DELETE.** No role is granted `delete` on any table. Soft-delete is
enforced by the database, not by discipline. Deleting means updating `deleted_at`.

**Foreign keys between tenant tables carry `org_id`.** A reference is written as
`references some_table (id, org_id)`, never `(id)` alone, so each referenced
table also holds a `unique (id, org_id)` constraint. RLS decides which rows you
may *read*; it does not stop you *pointing at* a row you cannot read, and every
`with check` clause only verifies `org_id = current_org_id()`. See DECISIONS #21.
References to `organizations` are exempt — that table has no `org_id` of its own.

**Two scripts check all of this.** `supabase/scripts/audit-tenant-safety.sql`
asks the database what tables exist and reports any that break the rules above —
run it after every migration; no rows means clean.
`supabase/scripts/test-tenant-isolation.sql` proves one salon cannot read
another's rows. The first found three violations of the `org_id` foreign key rule
on its first run, in tables written before the rule existed.

**Two documented exceptions to the `org_id` rule:**

- `organizations` has no `org_id` — it *is* the organization. Its own `id` is the
  tenant key everything else points at.
- `permissions` has no `org_id` — it is a shared catalogue of what the software
  can do, not tenant data. See DECISIONS.md #14. Per-organization customization
  lives in `role_permissions`, which does carry `org_id`.

`audit_log` carries `org_id` and `created_at` but no `updated_at` or
`deleted_at`: it is append-only, so there is nothing to update or soft-delete.

---

## organizations

The businesses using Amahle. Today there is exactly one row. The code must never
assume that.

| Column | Type | Meaning |
|---|---|---|
| `name` | text | Salon name |
| `slug` | text | URL-safe identifier |
| `timezone` | text | e.g. `Africa/Johannesburg` |
| `currency` | text | e.g. `ZAR` |
| `phone` | text | Public contact number |
| `email` | text | Public contact email |
| `address` | text | Street address |
| `public_settings` | jsonb | Branding, colours, public site config. **Readable by anyone on the internet** — the public website needs it before login. Never put secrets here. |
| `private_settings` | jsonb | Internal config. Readable only by members of this organization. |

Anonymous visitors can read this table, but only the columns listed above
excluding `private_settings` — enforced by column-level grants, not by RLS.
See DECISIONS.md #17.

`slug` is deliberately not updatable through the API. Changing it breaks every
URL pointing at that organization.

## profiles

A person who can log in. Linked to a Supabase auth user. Customers do **not**
have profiles — they never log in.

| Column | Type | Meaning |
|---|---|---|
| `user_id` | uuid | Supabase auth user. Unique — one login, one organization. See DECISIONS.md #15. |
| `full_name` | text | |
| `email` | text | |
| `phone` | text | |
| `role_id` | uuid | Which role they hold |
| `is_active` | boolean | Can they still log in |

## roles

Named roles, per organization. Owner, Manager, Receptionist, Stylist. Rows, not
code.

| Column | Type | Meaning |
|---|---|---|
| `name` | text | e.g. `receptionist` |
| `display_name` | text | e.g. "Receptionist" |
| `is_system` | boolean | Built-in roles that can't be deleted |

## permissions

Every distinct thing a person can do. Reference data, shared by all
organizations — **no `org_id`**, and no `updated_at` / `deleted_at`, because rows
are added and changed by migration rather than by the application. See
DECISIONS.md #14.

| Column | Type | Meaning |
|---|---|---|
| `key` | text | e.g. `appointment.create`, `customer.view_financial`. Unique. |
| `description` | text | Plain-English explanation |
| `category` | text | Grouping for the permissions UI |

## role_permissions

Join table. Which role has which permission. This is where "permissions as data"
actually lives.

| Column | Type | Meaning |
|---|---|---|
| `role_id` | uuid | |
| `permission_id` | uuid | |

## employees

A person who performs services. Usually also has a profile, but not always — a
stylist who doesn't use the system still needs to exist on the calendar.

**Never collapse this table into `profiles`.** An employee performs services; a
profile can log in. They usually point at each other, and the cases where they
don't are the ones that matter.

| Column | Type | Meaning |
|---|---|---|
| `profile_id` | uuid, nullable | Their login, if they have one. Null is normal. Unique among live rows. |
| `full_name` | text | Not unique — two people can share a name |
| `photo_url` | text | For the public team page |
| `position` | text | e.g. "Senior Stylist" |
| `bio` | text | Public-facing |
| `phone` | text | **Staff personal contact.** Never visible to anon. |
| `email` | text | **Staff personal contact.** Never visible to anon. |
| `is_bookable` | boolean | False means they still appear on the team page but can't be chosen when booking |
| `is_active` | boolean | Still employed |
| `display_order` | int | Order on the team page |

**What anonymous visitors can read:** `id`, `org_id`, `full_name`, `photo_url`,
`position`, `bio`, `is_bookable`, `display_order` — active, live rows only.
`phone`, `email` and `profile_id` are not granted, so a stylist's mobile number
cannot reach the public site even by accident.

Managed by anyone holding `employee.record.manage` — Owner and Manager by
default. Note that this is a **different permission** from `employee.manage`,
which governs `profiles`, i.e. who can log in. Roster and logins are two jobs.

## employee_working_hours

The regular working week. Migration 013.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | References `employees (id, org_id)` |
| `day_of_week` | int | 0 = Sunday, matching Postgres `extract(dow)` and JavaScript `getDay()`. Do not renumber. |
| `start_time` | time | Local salon time |
| `end_time` | time | Must be later than `start_time` |

**Several rows per day is normal, not a bug.** 09:00–13:00 plus 14:00–18:00 is a
stylist with a long lunch, which is how most salon rotas look. There is
deliberately no unique constraint on `(employee_id, day_of_week)`.

Overlapping rows are therefore possible. Availability unions them, so the result
is correct either way — the row is untidy, not wrong. Refusing the overlap needs
an exclusion constraint and the `btree_gist` extension, which is a database
dependency bought to prevent a cosmetic problem.

**`time`, not `timestamptz`, and that matters.** "Tuesday 9am" is a fact about the
salon's own clock and stays 9am when the clocks change. `organizations.timezone`
turns it into a real moment when availability is computed. Storing it as
`timestamptz` would freeze one particular Tuesday into the rota.

`end_time > start_time` means **no overnight shifts** — a salon open past midnight
is two rows on two days. Fine for a hair salon; the constraint to revisit if a
24-hour spa ever onboards.

## employee_time_off

Exceptions — holidays, sick days, blocked time. Migration 013.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | References `employees (id, org_id)` |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz | Must be later than `starts_at` |

`timestamptz` here, unlike the rota above, because a holiday is a real moment
rather than a repeating fact about the clock.

**There is no `reason` column, deliberately.** The calendar needs to know a
stylist is unavailable on the 14th, not why. "Sick" in a free-text box is health
data about an employee, readable by every colleague, and protecting it properly
would mean a third table with its own policies, audit trigger and permission key.
Unlike a customer's allergies — a legal-exposure question about someone who never
consented to be in this database — a reason for leave does not clear that bar for
a five-person salon. If the salon asks to record why, that is a table then, with a
real requirement behind it. Decided 2026-08-17.

## What both availability tables have in common

Reading needs no permission beyond belonging to the organization — everyone needs
to know who is working today; that is the calendar. Editing needs
`employee.record.manage`, the existing roster key. Setting someone's rota is
managing the team, and DECISIONS #24 only justifies a second key where the job
differs.

**No `anon` grants on either, and that shapes the booking form.** The public form
must show free slots, which sounds like it needs to read these tables. It does
not, and must not: a browser that can read working hours can read who works when,
and a browser doing availability arithmetic is one that can be lied to about the
result. Availability is computed by a database function the form calls — same
principle as `createAppointment()` — which returns free slots and nothing else.

Both audit at `routine` tier. They carry no personal detail, which is now true by
construction rather than by good intentions.

## services

What the salon offers. The first table anonymous visitors read.

| Column | Type | Meaning |
|---|---|---|
| `name` | text | Unique per organization, among live rows |
| `description` | text | |
| `category` | text | e.g. "Colour", "Cuts" |
| `price` | numeric(10,2) | |
| `price_display` | text | `exact` → "$120", `from` → "from $120", `hidden` → no price shown. A flat number is a marketing decision, not a fact — braiding and colour are priced by length. |
| `duration_minutes` | int | How long it takes |
| `buffer_minutes` | int | Cleanup/prep time after. **Internal** — never visible to anon. |
| `is_bookable_online` | boolean | False means the service still appears on the public price list, with a "call us" note instead of a Book button. It does **not** hide the service. |
| `image_url` | text | |
| `display_order` | int | |
| `is_active` | boolean | |

**What anonymous visitors can read:** `id`, `org_id`, `name`, `description`,
`category`, `price`, `price_display`, `duration_minutes`, `is_bookable_online`,
`image_url`, `display_order` — and only rows that are live and active. `org_id`
has to be granted because filtering a query by a column requires SELECT
privilege on it.

The anon policy is not scoped to one organization, mirroring
`organizations_select_anon`. Every salon's price list is public by definition.
The application picks the organization by slug and filters.

**Known gap:** `price` is readable by anon even when `price_display` is
`hidden`, because grants are per column and not per row. A presentation
preference, not a secret. The fix, if it ever matters, is a view that nulls the
column. Not built.

Managed by anyone holding `service.manage` — Owner and Manager by default.

## employee_services

Which employees can perform which services. Unique per pair among live rows.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | References `employees (id, org_id)` |
| `service_id` | uuid | References `services (id, org_id)` |

Readable by anonymous visitors — it holds no personal data, and who performs
what is exactly what a customer is trying to find out.

**Both foreign keys carry `org_id`, and that is deliberate.** RLS decides which
rows you may *read*; it does not stop you *pointing at* a row you cannot read.
An insert carrying your own `org_id` but another salon's `service_id` would pass
every policy, because `with check` only verifies `org_id = current_org_id()`.
Referencing `(id, org_id)` makes the database itself reject a reference that
crosses a salon boundary. `profiles`, `services` and `employees` each carry a
`unique (id, org_id)` constraint to support this.

## customers

People who get their hair done. **No login.** Created or matched by phone number
at booking time.

| Column | Type | Meaning |
|---|---|---|
| `full_name` | text | |
| `phone` | text | As the customer gave it, punctuation and all. Displayed and dialled. |
| `phone_digits` | text, **generated** | `phone` with every non-digit stripped. Computed by Postgres. This is what uniqueness is enforced on — unique per org among live rows. |
| `email` | text, nullable | |
| `birthday` | date, nullable | |
| `notes` | text | One free-text operational field — "parks round the back". Not the internal notes system, which is out of v1. |
| `preferred_employee_id` | uuid, nullable | References `employees (id, org_id)` |
| `first_visit_at` | timestamptz, nullable | |
| `last_visit_at` | timestamptz, nullable | |

**Why matching uses `phone_digits`.** `+1 (202) 555-0143` and `+12025550143` are
one person and two strings. A generated column is recomputed by Postgres on every
write, so the second insert is refused by the database — not by a tidy input box
in a browser that an import, a paste, or the SQL editor never sees.

It strips punctuation. It does **not** invent a country code: `202 555 0143` and
`+1 202 555 0143` remain two customers. Teaching the database that ten digits
means American would hardcode one country into a multi-tenant schema. Adding the
dial code is the application's job, from the organization's own setting, in one
helper every write path calls. That arrives with the booking form.

Nobody can write `phone_digits` — Postgres refuses writes to a generated column.
Note that the generated TypeScript types get this wrong and mark it writable and
nullable. Ignore them on this one column.

**No `anon` grants.** Not a restricted list — nothing at all. The public booking
form does not touch this table directly; it goes through `createAppointment()`.

## customer_care_notes

The sensitive half of a customer record: allergies, sensitivities, hair formula.
One live row per customer.

| Column | Type | Meaning |
|---|---|---|
| `customer_id` | uuid | References `customers (id, org_id)`. Unique among live rows. |
| `allergies` | text | |
| `sensitivities` | text | |
| `hair_formula` | text | |

**Why this is a separate table and not three columns on `customers`.** Because
"RLS hides rows, grants hide columns" does not reach this case. A grant is
granted to a *Postgres* role, and every logged-in member of staff connects as the
same one, `authenticated`. A column grant can say "all staff" or "no staff". It
cannot say "stylists yes, receptionists no", which is precisely what DECISIONS #9
requires. Moving the fields to their own table turns field-level into row-level,
where `has_permission()` can be asked directly. See DECISIONS #27.

Reading needs `customer.view_sensitive`. Writing needs that **and**
`customer.manage` — `manage` alone is the Receptionist, who may fix a phone
number and has no business editing a formula she cannot read.

Not to be confused with `customers.notes`, which is general and operational.
Anyone who can see the customer can see that one.

## customer_flags

Internal labels. Separate table so each flag can carry its own visibility rule.

| Column | Type | Meaning |
|---|---|---|
| `customer_id` | uuid | References `customers (id, org_id)` |
| `flag_type` | text | e.g. `vip`, `frequent_late`, `staff_safety_alert`. Free text, not an enum — a salon inventing a label it needs is not a schema change. |
| `note` | text | |
| `created_by` | uuid, nullable | Which profile added it. References `profiles (id, org_id)`. |
| `min_permission` | text | Permission key required to see this flag. Defaults to `customer.view`. |

Safety and financial flags are restricted. Preference flags are not.

`min_permission` **references `permissions (key)`**, so it can only hold a key
that exists. Without that constraint a typo produces a flag nobody on earth can
read — including the owner — and nothing reports it as an error.

The write policies check `has_permission(min_permission)` too, so nobody can
create or edit a flag into an audience they are not in themselves.

## The four customer permissions

| | `customer.view` | `customer.manage` | `customer.view_sensitive` | `customer.view_financial` |
|---|---|---|---|---|
| Owner | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | ✓ | ✓ |
| Receptionist | ✓ | ✓ | — | ✓ |
| Stylist | ✓ | — | ✓ | — |

Receptionist gets financial because they are the person at the desk when someone
owes money, and no clinical detail because a receptionist has no use for a hair
formula. Stylist gets allergies because they put chemicals on people.

These are **starting rows in `role_permissions`**, not fixed rules — the owner
changes who holds what by changing that data, and the screen for it arrives in
Phase 6. Note the granularity: permissions attach to a *role*, not to a person.
Per-staff-member overrides do not exist. See the open question in ROADMAP.

`customer.view_financial` is a visibility key for a *flag*. It is not the start of
financial management, which stays out of v1.

Reading `customers` requires `customer.view`, not merely membership of the
organization. That is a deliberate difference from `services` and `employees`,
where any member may read because the internet already could. Nothing about a
customer is public.

## appointments

The core table. Written only through `createAppointment()`.

| Column | Type | Meaning |
|---|---|---|
| `customer_id` | uuid | |
| `employee_id` | uuid | |
| `service_id` | uuid | |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz | Computed from service duration |
| `status` | text | See below |
| `source` | text | `online` or `staff` — how it was booked |
| `price` | numeric | Snapshot at booking time; service price may change later |
| `notes` | text | |
| `created_by` | uuid, nullable | Null when booked online by a customer |

**Statuses:** `pending`, `confirmed`, `checked_in`, `in_progress`, `completed`,
`cancelled`, `no_show`, `late_arrival`

`source` matters: it tells us how much of the salon's booking has actually moved
online, which is the real measure of whether this project worked.

## audit_log

Every meaningful action. Append-only. Never updated, never deleted — no
`updated_at`, no `deleted_at`.

| Column | Type | Meaning |
|---|---|---|
| `actor_id` | uuid, nullable | Which profile did it. Null for public booking, migrations, and service-role scripts — that null is meaningful, not missing. |
| `action` | text | e.g. `appointment.created`, `organization.updated` |
| `entity_type` | text | e.g. `appointment` |
| `entity_id` | uuid | Which row |
| `changes` | jsonb | On insert, the whole new row under `after`. On update, only the keys that actually changed, each as `{from, to}`. |
| `tier` | text | `critical` or `routine` |
| `ip_address` | text | Always null for now. Postgres sees Supabase's connection, not the caller's — the app must pass it in as a session setting, which lands with the Next.js work. |
| `created_at` | timestamptz | |

**Critical tier:** anything touching customer sensitive data, money, permissions,
or deletions.
**Routine tier:** ordinary operational actions.

**Written by triggers, never by application code.** `audit_row()` is attached to
each audited table and fires on every insert and update regardless of what caused
it — API call, SQL editor, service-role script, or code neither of us has written
yet. The RLS policies allow authenticated users to update these tables *directly*
through the API with no function in the path, so anything relying on application
code to log would be quietly incomplete.

`audit_row()` is `security definer`. `audit_log` grants INSERT to nobody, which
is what makes it unforgeable; without elevated privileges the audit insert would
be denied and would take the user's legitimate update down with it.

A soft delete is an update that sets `deleted_at`, and is recorded as
`entity.deleted` at `critical` tier rather than as an update. An update that
changes nothing but `updated_at` is not recorded at all.

**Nothing can read it yet** — RLS is on with no policies and no grants. It
collects data now and becomes readable when a screen needs it and earns an
`audit.view` permission.

**Since migration 012 this table holds copies of allergies and hair formulas**,
inside `changes`. That is correct and it is what an audit trail is for. It is
also why "nothing can read it yet" now matters more than it did: whenever the
viewing screen is built, its gate must be at least as strict as
`customer.view_sensitive`, or it becomes the back door around every policy on
`customer_care_notes`.

Rows created before migration 006 — the Kedus organization, its roles, and the
first Owner profile — do not appear. Backfilling would mean inventing timestamps
and actors, which is the one thing an audit log must not contain.
