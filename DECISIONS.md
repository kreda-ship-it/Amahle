# DECISIONS.md — Amahle

One entry per decision. Dated. With the reason.

ROADMAP.md holds the plan. This holds **why** — which is the thing that
evaporates between sessions and gets re-litigated three months later.

Format:

```
## [number]. [Decision] — [date]
**Decision:** what we're doing
**Why:** the reasoning
**Alternative rejected:** what we didn't do, and why not
**Revisit when:** the condition that would change this
```

---

## 1. Multi-tenant from day one — _[date]_
**Decision:** Every table carries a non-null `org_id`, even though there is one
salon.
**Why:** The spec commits to a multi-tenant platform. Retrofitting a tenant
boundary onto a live database with real customer and appointment data is one of
the most expensive refactors there is. The column costs nothing now.
**Alternative rejected:** Single-tenant now, add orgs later. Rejected because
"later" means migrating live data and rewriting every query.
**Revisit when:** Never for v1. This is settled.

## 2. Row-level security in Postgres — _[date]_
**Decision:** RLS enabled on every table. Tenant isolation and role access
enforced at the database.
**Why:** UI-layer security is a suggestion. One forgotten `WHERE org_id = ?`
leaks another business's customer data. At the DB layer the leak is impossible
rather than unlikely. Matters more than usual because much of this code is
AI-generated.
**Alternative rejected:** Application-layer filtering only. Faster to write,
one bug away from a data breach.
**Revisit when:** Never.

## 3. Permissions as data, not code — _[date]_
**Decision:** Roles and permissions live in database tables, joined at query
time. No hardcoded role checks in application code.
**Why:** The spec promises per-organization customizable permissions.
Hardcoded booleans make that unbuildable.
**Alternative rejected:** Enum of roles with hardcoded rules. Simpler for one
salon, blocks the product promise.
**Revisit when:** Never.

## 4. Soft-delete everywhere — _[date]_
**Decision:** `deleted_at` timestamp. Never `DELETE`.
**Why:** Appointment and financial records have retention implications. A
deleted customer destroys service history a stylist may need. Deletion is
irreversible; hiding is not.
**Alternative rejected:** Hard delete with backups. Backups are for disasters,
not for undo.
**Revisit when:** If a table grows large enough that soft-deleted rows hurt
performance — solve with archiving, not hard deletes.

## 5. Audit log from day one — _[date]_
**Decision:** Every create, update, and delete writes to `audit_log`. Two tiers
— customer-data and financial actions detailed and permanent; routine
operational actions lighter.
**Why:** Retrofitting an audit trail means retrofitting it into every write path
in the app. Two tiers because logging every calendar scroll drowns the signal.
**Alternative rejected:** Add auditing when a customer asks for it. That's the
expensive version.
**Revisit when:** If log volume becomes a cost problem — adjust tiers, don't
remove.

## 6. Auth isolated in `/lib/auth` — _[date]_
**Decision:** All authentication and permission-checking in one module. Nothing
else calls Supabase auth directly.
**Why:** A previous project scattered identity handling across the codebase and
paid for it with a painful mid-project refactor. One module means auth changes
touch one place.
**Alternative rejected:** Call Supabase auth wherever convenient.
**Revisit when:** Never.

## 7. One canonical creation path per record — _[date]_
**Decision:** `createAppointment()` exists once. Public form, staff form, and
any future import all call it.
**Why:** Duplicate records come from having a second way to make a thing. The
single path owns validation, conflict detection, customer find-or-create, and
the audit write.
**Alternative rejected:** Separate public and admin creation logic.
**Revisit when:** Never.

## 8. Customers have no accounts — _[date]_
**Decision:** Booking takes name, phone, and optional email. No signup, no
password. Profile is created or matched on phone number.
**Why:** Account creation is friction at the exact moment someone has decided to
book. The salon's customers are non-technical and on phones.
**Alternative rejected:** Customer accounts with login. Adds friction, adds
password reset support burden, adds nothing in v1.
**Revisit when:** If customers ask to see their own booking history.

## 9. Field-level permissions on customer records — _[date]_
**Decision:** Sensitive customer fields (allergies, formulas, staff safety
flags, outstanding balance) are permissioned per field, not per record.
**Why:** A stylist needs allergies and not financial flags. These are notes
about real people who never consented to an account. Retrofitting field-level
permissions is worse than retrofitting multi-tenancy, and carries legal
exposure.
**Alternative rejected:** All-or-nothing access to the customer record.
**Revisit when:** Never.

## 10. Staff manual entry is a v1 requirement — _[date]_
**Decision:** The staff calendar must support entering a phone booking by hand,
through the same path as online booking.
**Why:** The salon will not stop taking phone calls. A calendar that only sees
online bookings is wrong within a day, staff stop trusting it, and they go back
to paper. This is the feature that decides whether the project survives.
**Alternative rejected:** Online-only booking in v1, manual entry later.
**Revisit when:** Never.

## 11. No CMS in v1 — _[date]_
**Decision:** Website content comes from the database and config files. No
content management UI.
**Why:** The spec says owners should never need a developer. For one salon, we
ARE the developer. A config file is a fraction of the work of a CMS.
**Alternative rejected:** Build the CMS now because the spec says so.
**Revisit when:** The third salon asks to edit their own site.

## 12. No payments in v1 — _[date]_
**Decision:** No payment processing, no deposits, no card storage.
**Why:** The salon takes payment in person today and that works. Money in the
system raises the security and compliance bar significantly.
**Alternative rejected:** Deposits to reduce no-shows. Real problem, wrong time.
**Revisit when:** No-shows become a measured problem the salon complains about.

## 13. Next.js + Supabase + Vercel — _[date]_
**Decision:** Next.js App Router, TypeScript, Tailwind, Supabase, Vercel.
**Why:** Supabase gives Postgres RLS, which is how the DB-layer security
decision gets implemented cheaply, plus built-in auth. Vercel deploys Next.js
with near-zero configuration. All well-documented, which matters when learning.
**Alternative rejected:** Custom backend. More control, far more to build and
understand.
**Revisit when:** Not in v1.

## 14. `permissions` is global reference data, not per-organization — _2026-08-08_
**Decision:** The `permissions` table has no `org_id`. It is a single shared
catalogue of every action the software supports, readable by any authenticated
user. This is a deliberate, documented exception to the "every table has
`org_id`" rule in CLAUDE.md.
**Why:** `permissions` describes what *the software* can do — `appointment.create`,
`customer.view_financial`. It changes when we ship a feature, never when a salon
changes its mind, and it is identical for every organization. It contains no
tenant data: no customer names, no prices, no appointments. Nothing leaks if one
organization can read all of it. The per-organization customization the product
promises lives entirely in `role_permissions`, which *does* carry `org_id` — that
is where "salon A's receptionist sees balances, salon B's does not" is expressed.
**Alternative rejected:** Give `permissions` an `org_id` and copy the catalogue
into every new organization. Rejected because it means every shipped feature
requires inserting the new permission row into every organization, forever. One
missed insert and that salon silently cannot use the feature — a failure mode
that is invisible until a customer complains.
**Revisit when:** If organizations ever need to define their own custom
permission keys, rather than just choosing from ours. That would be a real
product change, not a refactor.

## 15. One login belongs to one organization — _2026-08-08_
**Decision:** `profiles.user_id` is unique. A Supabase auth user maps to exactly
one profile, in exactly one organization.
**Why:** It keeps every permission check to a single lookup with no ambiguity
about which organization the current request is acting inside. Multi-org logins
would mean an org-switcher in the UI and an org context threaded through every
query and RLS policy, for zero v1 benefit.
**Alternative rejected:** Allow one auth user to hold profiles in several
organizations. Correct eventually for a platform; premature now.
**Revisit when:** Someone owns two salons on Amahle and objects to having two
logins. The migration is real but manageable: drop the unique index, add org
context to the session.

## 16. RLS resolves the current organization with a `security definer` function, not JWT claims — _2026-08-08_
**Decision:** Two Postgres functions, `current_org_id()` and
`has_permission(key)`, both `security definer` and `stable`. Every policy calls
them. The organization and permission set are read from the database on each
statement.
**Why:** A policy that looks up `profiles` directly recurses forever, because
reading `profiles` triggers `profiles`' own policy. `security definer` runs the
function with its creator's privileges, skipping RLS on that read and breaking
the loop. Reading live also means a role change takes effect on the very next
query.
**Alternative rejected:** Bake `org_id` and permissions into the JWT via a custom
access token hook. Faster — no database lookup at all — but the claims go stale
until the token refreshes, up to an hour. "I granted the permission and nothing
happened" is a miserable bug to chase, and one salon with a handful of staff will
never notice the lookup cost.
**Revisit when:** Policy lookups show up as a real cost under real load. The
switch replaces the two functions and leaves every policy untouched.

## 17. `organizations.settings` split into public and private halves — _2026-08-08_
**Decision:** `settings` became `public_settings`; `private_settings` was added
alongside it. Anonymous visitors get column-level `select` on the public columns
only.
**Why:** The public website needs the salon's name, address and branding before
anyone logs in, so `organizations` rows must be readable by logged-out visitors.
RLS is row-level — a policy exposing the row exposes every column of it. A single
`settings` blob would therefore have published anything ever stored in it. The
split was done while the column was empty and the rename cost nothing.
**Alternative rejected:** Keep one `settings` column and rely on a documented
convention that nothing private goes in it. Conventions lose to deadlines.
**Revisit when:** Never for the split itself. If a third category appears
(per-employee config, say), it gets its own table rather than a third blob.

## 18. Prod Supabase project deferred — _2026-08-08_
**Decision:** One Supabase project, "Salon dev", for now. The dev/prod split is
postponed.
**Why:** Both existing projects sit in one Supabase organization, and the free
plan allows two — a third means paying roughly $25/month to hold an empty
database months before anyone uses it. The migrations in this repo are the
recipe: creating prod later is create project, link, `db push`, run the
organization script with real details. Perhaps ten minutes.
**Alternative rejected:** Create prod now for the confidence that the replay
works. Real value, but the same confidence is available later and for free by
replaying into a throwaway project and deleting it.
**Revisit when:** **The first real customer record.** Not a date and not a phase.
While the database holds only placeholder data it can be broken freely; the
moment it holds a real person's phone number or allergy note, an experiment gone
wrong destroys something unrecoverable, and by then the split has to already
exist. This is the one entry in this file with a trigger that will arrive without
announcing itself — watch for it.

**When the split happens, the current project becomes prod and the new one
becomes dev** — not the other way around. Moving real data between projects is
slow and risky; standing up an empty dev is `link` plus `db push`. The deployed
app's URL and keys also never change this way. Two conditions attach to it:
rename the project from "Salon dev", since that name is the only warning label
the database carries, and stop running experiments against it from the moment it
holds real data — which is the same moment the new dev project gets created.

## 19. Platform admin area deferred, and it will use the service role — _2026-08-08_
**Decision:** No developer/operator area in v1 — no UI for adding organizations,
no Amahle-level financial management. When it is built, it runs server-side with
the Supabase **service role** rather than introducing a platform-level role into
the tenant model.
**Why:** Onboarding an organization is already one call to
`create_organization()`. A UI saves minutes, once, and costs a page, a form,
validation, and a permissions model to protect it. Amahle's own business finances
are out of v1 twice over — financial management is on the forbidden list, and
running the company is not the product.
The architectural half matters more than the scheduling half: a platform operator
belongs to *no* organization and must see *all* of them, while DECISIONS #15 says
a profile belongs to exactly one and every RLS policy asks "what is your org?".
Bolting a super-admin into the tenant model would weaken the isolation protecting
every salon. The service role sidesteps RLS entirely and stays outside the model
rather than inside it.
**Alternative rejected:** A `is_platform_admin` flag on profiles, or a null
`org_id` meaning "sees everything". Both make the tenant boundary conditional,
and a conditional boundary is the kind that leaks.
**Revisit when:** Onboarding organizations by hand becomes tedious — realistically
the third or fourth salon.

## 20. Customer accounts stay out of v1, and will use one-time codes when they come — _2026-08-08_
**Decision:** v1 ships exactly as #8 describes — booking takes a name, phone, and
optional email, and creates no login. When customer access is eventually built,
it authenticates with a **one-time code** sent to the customer, never a password.
**Why:** The question came up as "create the account automatically, and make the
phone number the password." That cannot be built. A phone number is semi-public —
people hand it out constantly — so it proves nothing about who is holding it, and
using it as the password makes the customer list simultaneously a list of
usernames and their passwords. Numbers in an area also follow predictable
patterns, so an attacker needs no specific target.
The disqualifying part is that the account would be created without the customer
asking: someone books a haircut and now holds an account they do not know exists,
with a password they never chose, guarding their allergies, sensitivities, and
hair formulas. Any access to that is a breach involving people who never signed
up for anything.
A one-time code fixes the actual problem — it proves possession of the phone,
which the number alone does not — and needs no password to choose, forget, reset,
or leak.
**Alternative rejected:** Phone number as password, auto-created at booking.
Also rejected for v1: OTP accounts now. The customer records will already exist,
so adding login later is additive rather than a rebuild, and a few weeks of real
use will show whether anyone actually asks.
**Revisit when:** Customers ask to see their own booking history — the same
trigger as #8. Costs to weigh then: SMS is billed per message and every login is
a message, while email codes are cheaper but `customers.email` is optional, so
email-only login would exclude real customers.

## 21. Foreign keys between tenant tables carry `org_id` — _2026-08-15_
**Decision:** `employee_services.service_id` references `services (id, org_id)`,
not `services (id)`. Same for `employee_id`, and for `employees.profile_id`.
`profiles`, `services` and `employees` each carry a `unique (id, org_id)`
constraint to make this possible. Every future table referencing a tenant table
does the same.
**Why:** RLS decides which rows you may *read*. It does not stop you *pointing
at* a row you cannot read. An insert into `employee_services` carrying your own
`org_id` but another salon's `service_id` passes every policy we write, because
`with check` only verifies `org_id = current_org_id()`. Proven on 2026-08-15: the
attempt fails with a foreign key violation, and would have succeeded silently
without the composite key. At 1,000 salons the cost of finding this the other way
is one business's stylist wired to another's service menu.
**Alternative rejected:** Plain foreign keys plus care in application code. That
is precisely the trust this architecture exists to avoid, and it fails the moment
one query is written by someone who has not read this file.
**Revisit when:** Never. Extend it to `appointments` in Phase 4 —
`customer_id`, `employee_id` and `service_id` must all carry `org_id`.

## 22. Employee-to-service assignment is rows, not columns — _2026-08-15_
**Decision:** `employee_services` stays a many-to-many join table: one row per
employee per service. Not one row per employee with a boolean column per service.
**Why:** Columns would make the service menu part of the database's *shape*
rather than its contents. Adding "Knotless Braids" would become a migration and a
deploy instead of an insert, and the salon owner could never do it themselves.
Worse for the platform: menus differ per salon, and a column cannot be
per-tenant. Salon #2's "Balayage" column would sit null on every Kedus row, and
Postgres caps a table near 1,600 columns — roughly 60 salons in. Rows carry
`org_id`; columns cannot.
**Alternative rejected:** One row per employee, a boolean column per service.
Genuinely easier to read as a table, and that readability is worth having — but
as a *screen*, not as storage. The Phase 6 admin UI should render exactly that
grid, generated from whichever services that salon has, with each tick writing
one join row.
**Revisit when:** Never for storage. The grid view is a Phase 6 UI task.

## 23. The public price list shows every active service — _2026-08-13_
**Decision:** Anonymous visitors see all active services. `is_bookable_online`
controls only whether a Book button appears; a phone-only service still shows
with its price and a "call us" note. Alongside it, `price_display` takes `exact`,
`from` or `hidden`, chosen per service.
**Why:** A price list that hides half the menu costs the salon customers. Someone
wanting braids, not finding braids listed, concludes the salon does not do braids
and calls a competitor. Separately, a flat price is a marketing decision rather
than a fact — braiding and colour are priced by length and condition, and forcing
one number would either publish a lie or leave the service off the page. Kedus's
own website already publishes no prices at all, so `hidden` matches what they
chose unaided.
**Alternative rejected:** Show only online-bookable services publicly. Also
rejected: a single `is_price_public` boolean, which would have needed a second
migration the first time someone asked for "from $120".
**Revisit when:** Never expected. Note the known gap: `price` is granted to
`anon` even on a `hidden` service, because grants are per column and not per row.
A presentation preference, not a secret. The fix if it ever matters is a view
that nulls the column.

## 24. The team roster and login management are separate permissions — _2026-08-15_
**Decision:** `employee.manage` continues to govern `profiles` — who can log in.
A new `employee.record.manage` governs `employees` and `employee_services` — the
roster, including people who never log in. Owner and Manager hold both.
**Why:** They are different jobs against different tables, and a single key would
mean granting someone the ability to create logins in order to let them add a
stylist to the team page.
**Alternative rejected:** Reuse `employee.manage` for both and reword its
description. Recommended at the time on the grounds that managing the team is one
job; overruled deliberately in favour of precision.
**Revisit when:** Someone is granted one and not the other and finds the split
confusing rather than useful. If they are always granted together in practice,
merging them is a migration and a policy edit.

## 27. Field-level permissions are built as a separate table, not column grants — _2026-08-17_
**Decision:** The sensitive customer fields — allergies, sensitivities, hair
formula — live in `customer_care_notes`, their own table with its own RLS policy
guarded by `customer.view_sensitive`. `customer_flags` follows the same pattern,
carrying a `min_permission` per row. Field-level permissions are implemented as
row-level ones.
**Why:** Every earlier table enforced column visibility with grants — "RLS hides
rows, grants hide columns." That tool does not reach this case. A grant is
granted to a *Postgres* role, and every logged-in member of staff connects as the
same one, `authenticated`. A column grant can say "all staff" or "no staff"; it
cannot say "stylists yes, receptionists no", which is the entire requirement of
DECISIONS #9. A separate table turns the question into one the database can
already answer, through `has_permission()` — machinery that exists, is used by
every other policy, and is covered by `test-tenant-isolation.sql`.
**Alternative rejected:** Keep one `customers` table and read it through a view
that blanks the columns you may not see (`case when has_permission(...) then
allergies end`). It genuinely gives per-*column* granularity rather than
per-*group*, which is closer to the literal wording of #9. Rejected because the
base table then has to be ungranted to `authenticated`, writes need a separate
path, and view/RLS interaction is subtle enough that the next person to touch it
is likely to get it wrong. Consistency with `customer_flags` — always going to be
a separate table for exactly this reason — settled it.
**Consequence accepted:** granularity is per *group* of fields. Splitting
allergies from hair formula later means another table, not another column. And
the audit log now holds copies of these values, so an audit-viewing screen must
be gated at least as tightly or it is the back door around all of this.
**Revisit when:** A field needs an audience that matches none of the others in
its table, and adding a third table for one column starts to look absurd. That is
where the view earns its complexity.

## 28. The booking path is a database function, not application code — _2026-08-18_
**Decision:** `create_appointment()` and `find_or_create_customer()` live in
Postgres as `security definer` functions. `src/lib/appointments/create.ts` is a
thin wrapper that calls one of them and translates errors for a form.
**Why:** Not a preference — it is forced by decisions already made. A customer
booking online is not logged in and reaches the database as `anon`, which
migrations 012 and 014 grant *nothing at all* on `customers` and `appointments`.
Application code holding the anon key therefore cannot write their booking, and
granting it the privilege would undo the protection those migrations exist for.
A `security definer` function runs with its owner's rights, so the checks inside
it are the only way a row gets in. The staff path could have been TypeScript;
the public path could not, and PROJECT.md requires one path for both.
**Alternative rejected:** The whole path in TypeScript, using the service role
key on the server. It would work, and it bypasses *every* RLS policy in the
database to do it — trading a boundary the database enforces for one that holds
only as long as nobody writes a careless query. Also rejected: giving `anon`
narrow insert privileges, which reopens direct writes to the two tables most
worth protecting.
**Consequence accepted:** the rules are written in a language the developer
knows less well, and are harder to debug than TypeScript would be. Mitigated by
`supabase/scripts/test-create-appointment.sql`, which exercises the whole path
inside a transaction that rolls back.
**Revisit when:** Never for the public path. If customer accounts ever arrive
(DECISIONS #20), a logged-in customer would have privileges of their own and the
argument changes shape — but the function would stay, because by then there
would be three callers rather than two.

## 29. No automated messages in v1 — _2026-08-18_
**Decision:** Nothing is sent to a customer automatically. The confirmation page
at `/book/confirmed/<reference>` is the confirmation, and the salon texts or
rings by hand from the number it already uses.
**Why:** The page is immediate, permanent, and returnable — more than the
customer gets from most salons. Against that, an automated text costs a
provider account, a per-message fee, and A2P 10DLC registration before US
carriers will deliver it reliably; unregistered traffic is silently filtered
rather than rejected, so the failure mode is believing it works. That is a
multi-week external dependency bought to automate something the salon already
does by hand and does well.
**Alternative rejected:** Email, which needs no registration and could ship in
an afternoon — but email is deliberately optional on the booking form
(DECISIONS #8), so it would reach only some customers while looking like it
reached all of them. A partial notification is worse than an honest absence.
**Revisit when:** The salon is doing enough online bookings that texting each
one by hand is a chore, or no-shows become a measured problem that reminders
would address. Start the 10DLC registration before writing any code — it waits
on someone else's queue and nothing we build shortens it.

## 30. The rota is enforced on the write path, as a predicate rather than a re-run of availability — _2026-08-20_
**Decision:** `schedule_permits(org, employee, starts_at, minutes)` answers four
questions — is this person working then, are they away, is it too soon, is it
too far out — and both `hold_slot()` and `create_appointment()` ask it before
writing anything. Online bookings only; staff bypass it. It is granted to
nobody, and is reachable only from inside the two `security definer` functions
that call it.
**Why:** Until migration 026, `get_available_slots()` was the only function in
the database that read `employee_working_hours` or `employee_time_off`. The
booking form posts `starts_at` as a hidden field, so a request carrying a time
the picker never offered was held and booked: three in the morning, a Sunday the
salon is shut, or the middle of a stylist's booked holiday. Time off is not an
appointment, so the exclusion constraint never saw it either — nothing at all
refused that row.

The obvious fix is to check the time appears in the list availability offered,
and it is wrong. Migration 018 deliberately stopped offering times on a grid:
each free stretch starts its own sequence from wherever the previous appointment
ended, which is what packs the day. So the offered list changes shape as
bookings arrive. A customer holding 10:45 while somebody else books 09:00–10:30
would find 10:45 had vanished from the list — not because it was taken, but
because the stretch it is measured from now begins somewhere else. Membership
would refuse a booking that is perfectly valid and held.

The rota did not move. So the check asks the rota.

The property that makes this safe is that availability can only ever offer times
which already satisfy all four rules. `schedule_permits()` therefore permits a
**superset** of what is offered, and can never refuse something a customer was
legitimately shown. That relationship is the design, and `test-availability.sql`
check 9 asserts it directly rather than trusting it — which is what lets the
offering rules change freely afterwards. A clock-aligned grid, a different step,
a twenty-minute service on the menu: none of them touch this function, and the
test says so the moment one of them would.

Two smaller choices inside it. It takes **minutes rather than service ids**,
because `appointment_fill_from_service()` deliberately supports an explicit
override — "this customer's colour always takes an extra hour" — and a check
that looked the service up itself could not test an appointment whose length was
set by hand. Phase 5's calendar is exactly where those appear. And it is
**granted to nobody**: a `security definer` function runs as its owner and so
does everything it calls, so the two booking functions reach it while `anon`
cannot. Granting it would hand the public a way to map the staff rota one yes/no
at a time, which is precisely what migration 013 revoked those tables to prevent.
**Alternative rejected:** Checking membership in `get_available_slots()`, for the
reason above. Also rejected: copying the four rules into each of the two callers
— two copies to keep in step, and no test that would notice them drifting. Also
considered and rejected: having `get_available_slots()` call `schedule_permits()`
per candidate so the rules live in exactly one place. That is three queries per
candidate row across hundreds of candidates, where availability currently
narrows the whole date range in bulk. The duplication is real, but it is between
a bulk filter and a single-row check, and check 9 is what keeps them honest.
**Revisit when:** The buffer stops being a simple trailing pad. Wash-aware or
segmented scheduling separates when the stylist is *needed* from when the
customer *arrives*, and "does the service fit inside one working window" becomes
"does each segment fit". The four rules survive that; what changes is what a
span means.

## 31. The buffer is dropped only when nothing follows it — _2026-08-20_
**Decision:** No mid-day exception to the buffer. Availability continues to
require a service *and* its buffer to fit between two appointments. The one
place the buffer may overhang is the end of the working day, which
`get_available_slots()` already does and `schedule_permits()` deliberately
mirrors.
**Why:** The proposal was to strip the buffer when a gap is nearly big enough —
20 to 25 minutes — so something can be squeezed in. Two reasons not to.

The arithmetic does not work. Every bookable service is 30 minutes or longer, so
a 25 minute hole fits nothing even with the buffer removed. The window where it
would change anything at all is 30 to 34 minutes.

And in that window it is still wrong. The buffer is not slack in the schedule;
it is sweeping hair off the floor and wiping down the chair. That work does not
disappear when the time stops being reserved — the stylist either does it and
runs late into the next customer, or skips it and the next customer sits down in
the last person's hair. Removing the buffer does not create thirty minutes, it
sells thirty minutes the salon does not have and moves the cost somewhere the
calendar cannot see. It would also fire at the worst possible moment: a 30
minute hole between two bookings means the day is already tight, which is
exactly when a stylist is most likely to run over and when the cushion is doing
the most work.

The end-of-day exception is safe for the opposite reason, and it is the reason
worth remembering: **nothing comes after it.** The stylist still sweeps up, at
18:05 rather than 17:55, and no customer is waiting.
**Alternative rejected:** An automatic exception for gaps of 30–34 minutes.
Rejected above. Two better routes to the same minutes, neither needing code:
shorten the buffer on that service deliberately — it is per-service and
editable, so if a trim genuinely needs three minutes of cleanup rather than
five, say so once and consistently — or put a genuinely short service on the
menu, which fills the hole honestly and gives the customer something that
actually fits it. Staff can also still squeeze anyone in by hand at any time,
and that judgement sits with the person who can see the room.
**Revisit when:** The salon says a specific service needs no cleanup gap. That
is them telling us the buffer is wrong, and the fix is the buffer rather than an
exception to it.

---

## 32. A visit may be split across two employees, anchored on the scarce one — _2026-08-22_
**Decision:** One visit may be performed by more than one employee, one per
service. `appointments` already carries `employee_id` per row, so this is a
change to how times are found and booked, not to how they are stored.
Availability finds slots for the SCARCE service first — the long one, the one
with few people who can do it — and then filters those candidates by whether
somebody free can do the short service in the gap beside it. Service order
inside a visit becomes a rule rather than an accident: the wash comes before the
braid.

This reverses the line in SCHEMA.md and migration 021 that says "a visit split
across two specialists is a phone call".

**Why:** The salon employs washers and blow-dry staff who are not stylists.
Braiding plus a wash is not an edge case there, it is the ordinary booking, and
under the old rule it would offer only employees linked to *both* services —
which is nobody, or accidentally only the stylists. The most common visit in the
salon was the one the software refused to schedule.

The reason the old decision gave is still true: searching for a chain of
employees whose free time joins up is much worse than finding one gap. What it
missed is that the two resources are not equal. Six hours of a braider is the
constraint; forty-five minutes of a washer is not, because washers are more
numerous and interchangeable. Anchoring on the scarce service turns a
combinatorial search into the existing search plus a cheap filter — and it is
how the salon already thinks about its own day.

A second column falls out of this and is part of the same decision:
`appointments.employee_requested`. When a customer picks "Anyone" and the system
assigns Hanna, the row says Hanna and is indistinguishable from a row where the
customer asked for Hanna by name. The receptionist rearranges the day constantly
and may move the first but not the second, so the difference has to be recorded
at booking time or it is lost.

**Alternative rejected:** Keep one employee per visit and require the stylist to
do the wash. That is the status quo and it is what the salon does not do — it
puts a six-hour braider on a forty-five minute wash and wastes the scarcest
resource in the building. Also rejected: full multi-employee chain search, which
is the expensive general case, buys nothing this salon needs, and would make
availability slow in the one place it must stay fast.

**Revisit when:** A visit needs three or more employees, or the short service
stops being interchangeable — a named colourist who must personally do a step
before another named stylist continues. Both break the anchor, because there is
then no single scarce resource to anchor on.

---

## Template for new entries

```
## [n]. [Decision] — [date]
**Decision:**
**Why:**
**Alternative rejected:**
**Revisit when:**
```
