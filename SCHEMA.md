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
| `settings` | jsonb | Branding, colours, misc. config |

## profiles

A person who can log in. Linked to a Supabase auth user. Customers do **not**
have profiles — they never log in.

| Column | Type | Meaning |
|---|---|---|
| `user_id` | uuid | Supabase auth user |
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

Every distinct thing a person can do. Reference data.

| Column | Type | Meaning |
|---|---|---|
| `key` | text | e.g. `appointment.create`, `customer.view_financial` |
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

| Column | Type | Meaning |
|---|---|---|
| `profile_id` | uuid, nullable | Their login, if they have one |
| `full_name` | text | |
| `photo_url` | text | For the public team page |
| `position` | text | e.g. "Senior Stylist" |
| `bio` | text | Public-facing |
| `phone` | text | |
| `email` | text | |
| `is_bookable` | boolean | Do they appear in booking |
| `is_active` | boolean | Still employed |
| `display_order` | int | Order on the team page |

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

What the salon offers.

| Column | Type | Meaning |
|---|---|---|
| `name` | text | |
| `description` | text | |
| `category` | text | e.g. "Colour", "Cuts" |
| `price` | numeric | |
| `duration_minutes` | int | How long it takes |
| `buffer_minutes` | int | Cleanup/prep time after |
| `is_bookable_online` | boolean | Some services need a phone conversation |
| `image_url` | text | |
| `display_order` | int | |
| `is_active` | boolean | |

## employee_services

Which employees can perform which services.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | |
| `service_id` | uuid | |

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

Every meaningful action. Append-only. Never updated, never deleted.

| Column | Type | Meaning |
|---|---|---|
| `actor_id` | uuid, nullable | Who did it. Null for public booking. |
| `action` | text | e.g. `appointment.created` |
| `entity_type` | text | e.g. `appointment` |
| `entity_id` | uuid | Which row |
| `changes` | jsonb | Before/after for updates |
| `tier` | text | `critical` or `routine` |
| `ip_address` | text | |
| `created_at` | timestamptz | |

**Critical tier:** anything touching customer sensitive data, money, permissions,
or deletions.
**Routine tier:** ordinary operational actions.
