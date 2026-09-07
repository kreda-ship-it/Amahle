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

### max_overhang_minutes

How far past the end of a working window an appointment may run. Default 120.

The safety net under `services.latest_start_time`: staying a bit late is normal,
staying until dawn is a mistake nobody caught. Note that for long services this
cap, rather than the service's own cutoff, is usually what decides the last
bookable time.

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
| `photo_path` | text | Storage path for the public team page. A path, never a URL — migration 011 |
| `position` | text | e.g. "Senior Stylist" |
| `bio` | text | Public-facing |
| `phone` | text | **Staff personal contact.** Never visible to anon. |
| `email` | text | **Staff personal contact.** Never visible to anon. |
| `is_bookable` | boolean | False means they still appear on the team page but can't be chosen when booking |
| `is_active` | boolean | Still employed |
| `display_order` | int | Order on the team page |

**What anonymous visitors can read:** `id`, `org_id`, `full_name`, `photo_path`,
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
| `category` | text | **Dead.** Nothing reads it. The headings come from `category_id` → `service_categories`. Sixty of eighty-four rows held NULL and the rest carried five headings that predate the salon's real menu, which is why every page printed "More". Kept only because dropping a column is its own migration. |
| `price` | numeric(10,2) | |
| `price_display` | text | `exact` → "$120", `from` → "from $120", `hidden` → no price shown. A flat number is a marketing decision, not a fact — braiding and colour are priced by length. |
| `duration_minutes` | int | How long it takes |
| `buffer_minutes` | int, nullable | Cleanup/prep time after this service. **Null means inherit** the organization's `default_buffer_minutes`; `0` means this service deliberately needs none. **Internal** — never visible to anon. |
| `is_bookable_online` | boolean | False means the service still appears on the public price list, with a "call us" note instead of a Book button. It does **not** hide the service. |
| `image_path` | text | |
| `display_order` | int | |
| `is_active` | boolean | |
| `category_id` | uuid, nullable | The branch of the tree this hangs from. **The only heading anything reads.** Resolved through `/lib/services/categories`, which returns two levels — a top-level heading and its sub-headings. Null lands the service under "More" rather than dropping it. |
| `is_included_with_others` | boolean | Free when booked alongside another chargeable service, full price alone. **The duration always counts.** See below. |
| `lead_minutes` | int, nullable | How long the LEAD stylist is needed. Null means one person does the whole appointment. Less than `duration_minutes` means an assistant finishes it. |
| `latest_start_time` | time, nullable | The latest clock time this service may START. Null keeps the old rule — it must finish inside working hours. |

### The included-with-others rule

Kedus does not charge for a wash and blow-dry alongside other work, and does
charge for one on its own. `is_included_with_others` says so, and
`visit_lines()` applies it: the price becomes zero when the visit holds at
least one other chargeable service.

**Its minutes are never touched.** Free is not instant — the wash still occupies
forty-five minutes of somebody's day. A rule that zeroed the time along with the
money would overbook every braiding appointment by exactly that much.

### Lead and finish

A stylist is not in the chair for the whole of a long braid. At Kedus they found
the style across the scalp — about two and a half hours, three for micro braids,
one for simple cornrows — then move to the next customer while an assistant
works the length down.

`lead_minutes` records that. A service with one produces TWO kinds of
appointment row rather than one: a `lead` row for the stylist carrying the
price, and one or more `finish` rows carrying zero.

Modelling it the old way made braiders look about sixty per cent less productive
than they are. On one Monday, knotless braids went from 3 bookable start times
to 9 for a single stylist.

### The last booking is not the closing time

`latest_start_time` is per service because the answer is per service. A trim at
18:45 finishes a little after close and that is a normal day; the same time for
braids would have somebody here at three in the morning.

The cutoff governs **only the customer's arrival**. When an assistant picks a
head up at 17:00 to finish it, that segment is not a booking and is not tested
against it. `organizations.max_overhang_minutes` (default 120) is the safety net
under all of it.


**What anonymous visitors can read:** `id`, `org_id`, `name`, `description`,
`category`, `price`, `price_display`, `duration_minutes`, `is_bookable_online`,
`image_path`, `display_order` — and only rows that are live and active. `org_id`
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

## The service tree — categories, questions and answers

Migration 027. A service used to be one row with one price and one duration.
That is true of a blow dry and false of everything the salon earns on: knotless
braids are a style, a size, a length, a boho finish or not, whose hair, and what
state it arrives in — and each answer changes the price AND the time.

Four tables hold the menu, one holds what a customer chose.

### service_categories

| Column | Type | Meaning |
|---|---|---|
| `parent_id` | uuid, nullable | Self-referencing. Null is a top-level heading. |
| `name` | text | Unique per parent, among live rows |
| `display_order` | int | |
| `is_active` | boolean | |

The ten headings of the salon's mind map, and sub-branches where it has them —
Braiding splits into "With extensions" and "Without". A heading may hold
services directly AND have branches beneath it; Natural hair styling does both.

### service_option_groups — one question

| Column | Type | Meaning |
|---|---|---|
| `name` | text | What staff call it — "Size" |
| `prompt` | text | What the customer reads — "What size would you like?" |
| `selection` | text | `one` or `many` |
| `is_required` | boolean | False lets somebody walk past it |

Defined once, attached to many styles. "Size" is the same question for knotless
braids, box braids and twists; typing it three times is how three versions of it
end up in the database saying slightly different things.

### service_options — one answer, and what it costs

| Column | Type | Meaning |
|---|---|---|
| `group_id` | uuid | The question it answers |
| `price_delta` | numeric(10,2) | **May be negative** |
| `duration_delta_minutes` | int | **May be negative** |
| `lead_delta_minutes` | int | How it changes the LEAD stylist's time specifically |

Negative deltas are deliberate. "Shoulder length, minus an hour" is how a salon
describes it, and forbidding it would force every base price to be the cheapest
possible combination — a lie on a price list. The TOTAL is what must stay
positive, and that is enforced where the total is computed.

**Length adds to the finish; size adds to both.** Mid-back to waist adds an hour
to the appointment and nothing to the founding — the stylist lays the same
braids across the same scalp. Size changes how many braids there are. This is
why a longer booking becomes more of the plentiful person rather than more of
the scarce one.

### service_option_group_links — which questions each style asks

| Column | Type | Meaning |
|---|---|---|
| `service_id` | uuid | |
| `group_id` | uuid | |
| `depends_on_option_id` | uuid, nullable | Ask this question only if that answer was given |
| `display_order` | int | The order asked |

`depends_on_option_id` is the conditional edge of the decision tree: "which
colour?" appears only after "the salon provides the hair". A service that asks
nothing has no rows here — absence, not a flag.

One level of dependency only. A question depending on a question depending on a
question is a flow chart nobody can hold in their head.

### appointment_options — what this customer chose

| Column | Type | Meaning |
|---|---|---|
| `appointment_id` | uuid | The `lead` row, which carries the price |
| `option_id` | uuid, **nullable** | |
| `group_name`, `option_name` | text | Snapshots |
| `price_delta`, `duration_delta_minutes` | | Snapshots |

Snapshotted, for the same reason `appointments.price` is: the salon will put its
prices up, and a booking from March must still add up in June. `option_id` is
nullable so retiring an option cannot take the record of a past booking with it.

No anon access at all — this is one identified person's booking. Written by
`create_appointment()`, which is `security definer` and needs no grant.

## employee_services

Which employees can perform which services, and in which capacity. Unique per
(employee, service, **role**) among live rows.

`role` is `lead` or `assist`. "Fikir can braid" and "Emu can finish a braid" are
different claims and this table could not tell them apart before migration 033.
`lead` means perform it from the start; `assist` means finish one somebody else
has begun.

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
| `for_name` | text, nullable | Who this appointment is for, when it is not the customer themselves — a child, a friend. Null is the normal case. |
| `visit_id` | uuid | Which rows are one trip to the salon. **Always set**, even for a single service. This is the customer's booking reference. |
| `customer_id` | uuid | |
| `employee_id` | uuid | |
| `service_id` | uuid | One row is one service. Several services in a sitting are several rows sharing a `visit_id`. |
| `starts_at` | timestamptz | |
| `ends_at` | timestamptz | Computed from service duration |
| `status` | text | See below |
| `source` | text | `online` or `staff` — how it was booked |
| `price` | numeric | Snapshot at booking time; service price may change later |
| `notes` | text | |
| `created_by` | uuid, nullable | Null when booked online by a customer |
| `employee_requested` | boolean | True when the customer asked for this person **by name**. False when the system assigned them. |
| `phase` | text | `lead` or `finish`. The price sits on the `lead` row; `finish` rows carry zero. |

`employee_requested` exists because the two are indistinguishable once written.
A customer who picks "Anyone" and is given Hanna produces a row saying Hanna,
exactly like one who asked for her — and the receptionist may move the first
without asking but not the second. Recorded at booking time or lost forever.
See DECISIONS #32.

`phase` is why one braid is two or three rows across two or three people. A day
view that shows them flat makes one customer look like three bookings.

**Statuses:** `pending`, `confirmed`, `checked_in`, `in_progress`, `completed`,
`cancelled`, `no_show`, `late_arrival`

`pending` and `confirmed` are not "maybe" and "yes" — every appointment holds its
slot from the moment it exists, because the exclusion constraint says so. They
track the salon's confidence that the customer will *turn up*:

| Status | Meaning |
|---|---|
| `pending` | Booked. The time is held and nobody else can take it. Not yet reconfirmed with the customer. |
| `confirmed` | The salon rang the day before and the customer said yes. |

That is why a customer is told "you're booked" on a `pending` appointment: they
are. Decided 2026-08-18, matching how the salon already works by phone.

**Nothing moves a booking from `pending` to `confirmed` yet.** It is a staff
action and needs the calendar, so every appointment sits at `pending` until
Phase 5.

**A visit of one is still a visit.** `visit_id` is set on every appointment, so
there is no "part of a group" flag and no special case — the same code path
serves a trim and a trim-with-blow-dry, and there is no second path to get
wrong.

**A party is one customer record.** `customers.phone` is the identity and is
unique per salon, so two people cannot share a number — and a child booking with
her mother has none of her own. So the person who can be contacted is the
customer, and each appointment carries `for_name`.

The cost, recorded because it will surface later: the daughter's service history
attaches to her mother's record. When customer screens arrive in Phase 6,
"Amira's hair formula" sits under her mother's name until someone splits them.
That is a merge, and a far easier job than un-picking a nullable identity column
would have been. Decided 2026-08-19.

**Chained services carry no buffer between them.** `buffer_minutes` resets the
station between *customers*, and the same head does not need cleaning up
halfway through. So each row but the last ends exactly where the next begins,
and only the final one is followed by cleanup:

```
45 min blow dry   10:00 - 10:45   blocked until 10:45
30 min trim       10:45 - 11:15   blocked until 11:25   (+10 buffer)
```

The exclusion constraint is content with rows that touch: its ranges are
half-open, so ending where the next starts is not an overlap. Adding a buffer
between them would cost the salon ten minutes on every combined booking and
nobody would ever see it — the day would simply be emptier than it should be.

`source` matters: it tells us how much of the salon's booking has actually moved
online, which is the real measure of whether this project worked.

## How the gap between appointments is decided

Migration 017. `buffer_minutes` is the cleanup time after a service, and it is
the gap a customer never sees but a stylist lives by.

| Value | Meaning |
|---|---|
| `15` | This service takes 15 minutes to clean up after |
| `0` | This service deliberately needs no gap |
| `null` | Use the salon's house rule |

The house rule is `default_buffer_minutes` in the organization's
`public_settings`, falling back to none if unset.

**Why null was worth adding.** The column used to be `not null default 0`, which
made "this service genuinely needs no cleanup" and "nobody has thought about
this service yet" identical to the database. A service added next year by
someone who did not know the column existed would book customers back to back,
and nobody would find out until a stylist was twenty minutes late by lunchtime.

`buffer_minutes_for(service_id)` resolves it, and is the **only** place that rule
lives. Both the appointment trigger and `get_available_slots()` call it, and they
must never disagree: if availability offered a slot computed with one gap while
the exclusion constraint reserved a span computed with another, the form would
offer times the database then refuses — a bug that appears only under load and
only for real customers.

## Which times a customer may choose

`get_available_slots(org, service_ids[], from_date, to_date, employee)`,
migrations 016 and 021. Returns `(slot_starts_at, slot_employee_id)`.

**Several services means one continuous stretch with one stylist.** Total time
is the sum of the durations, the trailing buffer comes from the last service,
and only stylists who perform *every* one are offered — a visit split across two
specialists is a phone call, because finding a chain of stylists whose free time
joins up is a different and much worse problem than finding one gap.

> **Superseded by DECISIONS #32. Still true of `get_available_slots()`, which
> is now a primitive rather than the entry point.** Use `get_visit_slots()` for
> anything that is a visit — see below. The employee is in the result
because `employee` may be null, meaning "anyone who performs this".

**Nothing is precomputed.** No slot table, no nightly job, no cache. Availability
is derived from the rota, time off and existing appointments at the moment
someone asks, so a rota edited at 2pm shows up in the 2:01pm booking form.
Materialising slots would mean every rota edit, cancellation and booking has to
remember to update them, and the day one forgets is the day the salon
double-books someone and stops trusting the software.

**Slots are anchored to real appointments, not to a grid.** Migration 018. The
working window minus every appointment's reserved span and every period of time
off gives a set of free gaps; each gap offers times starting at its own
beginning:

```
previous appointment ends   10:28
plus that service's buffer  10:33
rounded up to a tidy 5      10:35   <- offered
```

Nothing is wasted waiting for a grid line. Postgres does the subtraction itself
with a multirange — a set of ranges treated as one value — so overlapping
bookings merge without any loop to get wrong.

**Empty stretches still need a rhythm.** "After the previous appointment" has no
answer on a day with nothing booked, so each gap steps after its anchor. Two
settings in `public_settings`:

| Setting | Default | What it does |
|---|---|---|
| `slot_rounding_minutes` | 5 | Turns 10:33 into 10:35 |
| `slot_step_minutes` | 105 | An empty day offers 09:00, 10:45, 12:30… |

105 is the salon's own choice, made 2026-08-18: it nudges customers into a tidy
sequence rather than scattering bookings. Its cost is real — on an empty day
someone wanting 09:30 is refused while the stylist sits free. One `update`
changes it if that starts losing bookings.

**A slot must fit its service and its buffer inside the gap**, because the next
appointment begins the moment the gap ends. The exception is the gap running to
closing time, where the service must finish by close but the buffer may
overhang — cleanup after the last customer harms nobody. Without that exception
the last appointment of every day quietly disappears.

**The service must finish by closing time; the buffer may overhang it.** A
one-hour cut at 4pm is offered on a day that shuts at 5, even though cleanup runs
to 5:15. Requiring the buffer to fit inside the working day would silently delete
the last appointment of every day.

**Timezone is the whole risk.** Working hours are stored as `time` — a fact about
the salon's clock, not a moment. `(day + start_time) AT TIME ZONE tz` is what
turns one into the other, and it stays correct across a daylight saving change in
a way that adding a fixed offset never is. This is why migration 013 stored the
rota as `time`.

**Customers only.** Staff never call this. A receptionist squeezing someone in at
6:15 on a day that closes at 6 is real and must keep working — the salon owns its
own calendar and may overrule its own opening hours. Staff are stopped from
double-booking by the exclusion constraint, and by nothing else. That is the
difference between a customer and the person who runs the diary.

Two optional settings in `public_settings`: `booking_lead_time_hours` (default 2,
so nobody books ten minutes from now) and `booking_horizon_days` (default 60).


## Working out a visit — the functions

Everything below is computed in the database, never in the website. The running
total a customer watches and the number written to their appointment have to
come from the same arithmetic or they drift, and a duration computed in a
browser can be edited by anyone with dev tools.

A **selection** is the shape all of these take:

```json
[{ "service_id": "…", "option_ids": ["…", "…"] }, …]
```

One entry per service in the order performed. jsonb rather than parallel arrays
because an option belongs TO a service — "size: medium" means nothing alone, and
a flat list would be ambiguous the moment a visit holds two braiding styles.

| Function | Answers |
|---|---|
| `visit_lines(org, selection)` | One row per service: price, duration, lead minutes, whether the included rule fired |
| `visit_totals(org, selection)` | The two numbers the booking page shows |
| `visit_minutes(org, service_ids, selection)` | How long to look for a gap of |
| `visit_plan(org, service_ids, selection)` | The visit as the scheduler sees it, plus how many people can perform each service — "scarce" is the smallest of that |
| `employee_is_free(org, employee, starts_at, minutes, token, party, latest_start, allow_overhang)` | Rota, time off, existing appointments and other people's holds. **No grant** — it would let the public map the rota one yes/no at a time |
| `schedule_permits(org, employee, starts_at, minutes, latest_start, allow_overhang)` | Just the rota half. **The caller states the rule** rather than the function looking it up, because only the caller knows whether it is a customer arriving or a colleague taking over |
| `get_visit_slots(org, service_ids, from, to, employee, token, party, selection, limit)` | When a whole visit can start, and every row that would be written |

### get_visit_slots, and what it costs

Returns `(slot_starts_at, slot_employee_id, slot_assignment)` where the
assignment is an ARRAY of every row that would be written — service, employee,
phase, start, minutes — because a visit legitimately involves a stylist and
several assistants.

For each service it checks a **lead** (a stylist who performs it, free for the
lead minutes) and then a **finish** (assistants covering the rest, greedily, in
a chain if one person cannot see it through).

The chain is cheap only because the assistants are interchangeable — any of them
can finish any style. That turns what would be a search for people whose free
time joins up into a greedy cover with no backtracking. If they ever specialise,
this becomes the combinatorial problem DECISIONS #32 was written to avoid.

**It walks days × steps × phases and is not a set-based query.** Ask it for the
window being shown — a day, or a few — not a month.

### create_appointment, and what the caller may decide

The caller supplies **who leads**, and nothing else. The times, the phases, the
split between founding and finishing, the choice of finishers and the price are
all recomputed on write.

That is a security boundary, not tidiness: a form posting times and phases back
from what availability offered could otherwise hand a stylist five minutes of a
six-hour braid, or move the money onto a row nobody charges for.

Finishers are chosen at write time rather than taken from the offer, because
minutes pass between somebody seeing a time and pressing the button.

## appointment_holds

A slot reserved for a few minutes while somebody finishes booking it. Migration
022.

| Column | Type | Meaning |
|---|---|---|
| `employee_id` | uuid | References `employees (id, org_id)` |
| `starts_at` | timestamptz | |
| `blocked_until` | timestamptz | Includes the buffer, same span an appointment would reserve |
| `session_token` | text | Which browser this belongs to. Random, in a cookie. |
| `party_index` | int | Which person in the party. 0 is whoever is booking, and the only value for an ordinary booking. |
| `expires_at` | timestamptz | Fifteen minutes by default; `hold_minutes` in `public_settings` |
| `released_at` | timestamptz | Set when the hold ends — used up, replaced, or lapsed |

**No `customer_id`, because there is no customer yet.** At the moment a hold is
made we do not know their name; it arrives with the form. That is also why holds
are not provisional appointments: an appointment appears on the calendar and is
audited, and half-finished strangers on the calendar is how staff stop trusting
it.

**No `deleted_at` either.** `released_at` does that job and says what actually
happened — a hold ended, rather than a record was removed. Released rows are
kept: they cost nothing, they record how often bookings are abandoned, and
DELETE is granted to nobody anywhere in this database.

**An exclusion constraint, the same shape as the one on `appointments`.** Two
people clicking the same time in the same instant is precisely the race this
table exists to fix, so the guarantee is the database's rather than a check
that can be overtaken. Its predicate cannot mention `expires_at` — `now()` is
not immutable and Postgres will not index on it — so stale holds are released
explicitly at the start of `hold_slot()` instead.

**No grants to anyone, in any role.** The table is reached only through
`hold_slot()`, `release_holds()` and `get_hold()`. That is what stops a browser
holding every slot in the salon.

**A hold blocks everyone except the session that made it, for that same
person.** Otherwise a customer who just picked 10:45 would reload the page and
find 10:45 gone — the hold would hide the very slot it is protecting.

The "same person" half matters as much: if the mother is holding Hanna at 10:45,
the daughter must be offered somebody else at 10:45, not Hanna. Her own party's
hold is a real obstacle to her, and the simpler rule would have hidden it. Both `get_available_slots()` and
`create_appointment()` take the session token and use `is distinct from`, which
also gets the null case right: a caller with no token is distinct from every
token, so every live hold counts as busy for them.

## How an appointment gets created

Three functions in Postgres, added by migration 015. Together they are the only
way an appointment comes into existence — PROJECT.md's one-canonical-path rule,
enforced rather than agreed.

| Function | What it does |
|---|---|
| `normalize_phone(phone, dial_code)` | One spelling of a phone number. Strips punctuation, keeps a `+` prefix, turns a leading `00` into `+`, and adds the salon's country code to a local number. |
| `find_or_create_customer(org, phone, name, email)` | Match a customer by phone or make one. |
| `create_appointment(org, service_ids[], …)` | Every rule, then one row per service, back to back. Returns the **visit id**. |

**Why these are in the database and not in `/lib`.** A customer booking online
is not logged in — they arrive as `anon`, which has no grant on `customers` or
`appointments` at all. Application code cannot write their booking, and giving
it the privilege would undo the point of those grants. `security definer` is the
way through: the function runs with its owner's rights, so its checks are the
only way in. See DECISIONS #28.

**`source` is derived, never passed.** If `current_profile_id()` is null the
booking is `online`, otherwise `staff`. PROJECT.md calls that column the real
measure of whether this project worked, and a parameter is a way for it to be
wrong. `price`, `ends_at` and `blocked_until` are likewise not parameters — the
trigger computes them, so no caller can quote itself a different price.

**The slot is not checked, it is claimed.** `create_appointment()` does not look
to see whether the time is free. It inserts, and the exclusion constraint
refuses a clash. Checking first leaves a gap between the check and the insert,
which is exactly where the website and the receptionist collide. The caller sees
SQLSTATE `23P01` and turns it into "that time was just taken".

**What it does not do.** Working hours and time off are not consulted. A booking
at 3am on a closed Sunday is accepted. That is the availability calculation, and
until it exists the booking form must only offer times that are genuinely free.

**`find_or_create_customer` fills blanks and never overwrites.** A returning
customer typing "Sara" where the salon wrote "Sara T." must not rewrite the
record — the salon's version is the curated one. An email is added only where
there is none.

**Set `country_dial_code`** in the organization's `public_settings`, or local
numbers are stored as bare digits and will not match the same number written
internationally. It is tenant data, so no migration writes it.

## Changing an appointment after it exists — migrations 038 to 044

Everything in this section was built on 2026-08-23 and was missing from this
document until 2026-09-07. Two tables and five functions, several of them
security boundaries.

### set_appointment_status — the only way a status changes

Migration 042. Replaces a direct `update` from application code, which was
correct and became insufficient.

`appointments_update` requires `appointment.manage`. A Stylist does not hold it
and should not — it also permits rescheduling and cancelling anybody's booking.
But a stylist marking her own client arrived is obviously reasonable, and that
rule **cannot be written as a policy at all**: `has_permission()` answers "may
this ROLE do this", and the question here is "may this PERSON do this, to THIS
row".

| Caller | May set |
|---|---|
| Holds `appointment.manage` | any status, on any appointment |
| The employee the row belongs to | `checked_in`, `in_progress`, `completed`, `no_show` |
| Anyone else | nothing |

`cancelled` is deliberately not on the second list — a cancellation has a
customer on the other end of it and belongs with the desk. Nor is `confirmed`,
which is the day-before call round.

`security definer`, granted to `authenticated` only. It is the **only** path, not
a second one beside the update — so a stylist marking her own client done and a
receptionist cancelling a booking travel the same code and audit identically.

### update_my_employee_details — your own contact details

Migration 042. `employee.record.manage` governs the whole roster and is
all-or-nothing, so a stylist could not correct her own phone number without an
owner doing it.

**The column list is the entire security model**, which is why this is a function
with four named parameters rather than a policy over the row: `phone`, `email`,
`bio`, `photo_path`. Not `position` (a job title belongs to whoever decides job
titles), not `display_order`, and not `is_bookable` or `is_active` — a stylist
quietly taking herself off the roster on a Saturday morning is not a feature.
`full_name` is left out too: it is how the salon refers to somebody across every
customer record, and a rename is something the desk should know about.

Null means "leave alone"; an empty string clears.

### move_visit, reassign_appointment, resize_appointment

Migrations 039 and 041. The three ways a booking changes shape once it exists.

| Function | Grain | What it does |
|---|---|---|
| `move_visit(visit, starts_at)` | the whole visit | Shifts every row by the same interval, so a founding and its finishing stay together |
| `reassign_appointment(appointment, employee, starts_at)` | one row | Gives one piece of work to somebody else. Refuses anyone who does not perform that service in that capacity — a `lead` row needs a lead, a `finish` row needs an assistant |
| `resize_appointment(appointment, ends_at)` | one row | Changes a length. Whatever follows it in the same visit shifts with it |

**The whole visit always moves, and that answers an open question.** Dragging a
`lead` row carries its `finish` rows at the same offset; a lead cannot be moved
alone. An assistant booked to work on hair the stylist has not released yet is
not a schedule, it is a fault.

**`appointments_no_double_booking` became `deferrable` for this.** Shifting a
chained visit trips the constraint mid-statement on a final state that is
perfectly legal, so the check is deferred to commit. Same SQLSTATE `23P01`, same
meaning to the caller — it simply arrives at commit rather than at the statement.

### schedule_plans and schedule_plan_moves

Migrations 040 and 044. Planning mode: proposed changes over the live calendar,
which change nothing until they are applied.

`schedule_plans` — `name`, `plan_date`, `created_by`, `applied_at`. A plan
belongs to a date and has a name, which is what makes "Thursday" and "Thursday,
if Fikir is out" two tabs rather than a feature. `applied_at` is set once Apply
succeeds: an applied plan is history, not a draft, and applying twice would move
everything again.

`schedule_plan_moves` — one row per proposed change:

| Column | Meaning |
|---|---|
| `appointment_id` | Which row moves. **Not `visit_id`** — migration 044 changed the grain |
| `target_starts_at` | Absolute, never an interval |
| `target_employee_id` | Null leaves the person alone |
| `target_minutes` | Null leaves the length alone |
| `refused_reason` | Why the database would not take it, kept rather than dropped |
| `applied_at` | Set per row when Apply lands it |

**The plan stores changes, not a copy of the day.** This is the choice that makes
everything else free: a booking taken while a plan is open simply shows through,
because the plan was never holding its own copy of Thursday to fall out of step
with. There is nothing to sync.

**The target is absolute rather than an interval**, so "already done" is
expressible — somebody who moved the visit by hand since leaves a proposal that
shrinks to nothing rather than applying a second time.

**Migration 044 moved the grain from visit to appointment**, because reassigning
and resizing are facts about one row and keeping two kinds of entry would have
meant two code paths. Unique per `(plan_id, appointment_id)` among live rows:
dragging the same block twice is a correction, not a second instruction.

`apply_plan(plan)` is **one transaction, deliberately**. A plan built at ten and
applied at twenty past may be stale, and a half-applied plan leaves a day that is
neither its old shape nor its new one with nobody knowing which. Its refusals are
`raise exception` written to be read by the person at the desk, so the caller
passes the message straight through.

**A plan reserves nothing.** It is not an appointment, holds no slot and blocks
nobody. Two people can plan the same gap and both be told it is fine; the second
Apply is the one refused.

## Who holds which permission

Twelve keys, four roles. This grid is what `create_organization()` seeds and
what migrations 007, 008, 012 and 014 backfilled. It is **starting data, not a
fixed rule** — permissions are rows, and an owner changes who holds what.

| Permission | Owner | Manager | Receptionist | Stylist |
|---|:--:|:--:|:--:|:--:|
| `appointment.view_all` | yes | yes | yes | — |
| `appointment.create` | yes | yes | yes | — |
| `appointment.manage` | yes | yes | yes | — |
| `customer.view` | yes | yes | yes | yes |
| `customer.manage` | yes | yes | yes | — |
| `customer.view_sensitive` | yes | yes | **—** | **yes** |
| `customer.view_financial` | yes | yes | yes | **—** |
| `employee.manage` | yes | yes | — | — |
| `employee.record.manage` | yes | yes | — | — |
| `service.manage` | yes | yes | — | — |
| `organization.edit` | yes | — | — | — |
| `role.manage` | yes | — | — | — |

The two emphasised rows are DECISIONS #9 working: **a stylist sees a customer's
allergies and not their outstanding balance; a receptionist sees the balance and
not the allergies.**

**A Stylist holds no appointment permission at all**, and this is the single
easiest thing in the schema to misread. Her access to the calendar is
row-level, through `appointments_select` — `appointment.view_all OR employee_id
= current_employee_id()`. So a stylist gets her own column and a receptionist
the whole salon out of identical code, with no role check on any screen.

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
