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

---

## Template for new entries

```
## [n]. [Decision] — [date]
**Decision:**
**Why:**
**Alternative rejected:**
**Revisit when:**
```
