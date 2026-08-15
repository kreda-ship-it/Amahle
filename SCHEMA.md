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

**Nothing has DELETE.** No role is granted `delete` on any table. Soft-delete is
enforced by the database, not by discipline. Deleting means updating `deleted_at`.

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

Regular weekly availability.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | |
| `day_of_week` | int | 0 = Sunday |
| `start_time` | time | |
| `end_time` | time | |

## employee_time_off

Exceptions — holidays, sick days, blocked time.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz | |
| `reason` | text | |

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
| `phone` | text | The matching key — unique per org |
| `email` | text, nullable | |
| `birthday` | date, nullable | |
| `notes` | text | General notes |
| `allergies` | text | **Sensitive** |
| `sensitivities` | text | **Sensitive** |
| `hair_formula` | text | **Sensitive** |
| `preferred_employee_id` | uuid, nullable | |
| `first_visit_at` | timestamptz | |
| `last_visit_at` | timestamptz | |

Sensitive fields are subject to field-level permissions. A stylist sees
allergies. Not everyone sees everything.

## customer_flags

Internal labels. Separate table so each flag can carry its own visibility rule.

| Column | Type | Meaning |
|---|---|---|
| `customer_id` | uuid | |
| `flag_type` | text | e.g. `vip`, `frequent_late`, `staff_safety_alert` |
| `note` | text | |
| `created_by` | uuid | Which profile added it |
| `min_permission` | text | Permission key required to see this flag |

Safety and financial flags are restricted. Preference flags are not.

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

Rows created before migration 006 — the Kedus organization, its roles, and the
first Owner profile — do not appear. Backfilling would mean inventing timestamps
and actors, which is the one thing an audit log must not contain.
