# SESSION_LOG.md — Amahle

Three lines at the end of every working session. This is what makes tomorrow
resumable.

Newest entry at the top.

---

## Template

```
## [date] — [what you set out to do]
**Built:**
**Broke / unresolved:**
**Next:**
```

---

## 2026-08-15 — Phase 3, the database half

**Built:** Four migrations. `services` (007) with `price_display` taking `exact`,
`from` or `hidden`, so a salon can quote "from $120" or nothing at all rather
than being forced into a flat number. `employees` and `employee_services` (008),
where `profile_id` is nullable because an employee who never logs in still
belongs on the calendar. A regression fix (009). Composite foreign keys on
`roles` and `audit_log` (010). Two new permissions, `service.manage` and
`employee.record.manage`, both backfilled to Kedus, whose roles predate them.

`supabase/scripts/seed-kedus.sql` — 24 services with their real names and
categories, five employees, 66 mappings, the salon's real contact details
replacing the South African placeholders, and hours, socials and site copy in
`public_settings`. Sourced from kedushairsalonandbraiding.com.

`supabase/scripts/audit-tenant-safety.sql` — the session's most useful hour. It
asks the database what tables exist and reports any breaking the tenant rules:
missing `org_id`, RLS off, RLS on with no policies, a foreign key to a tenant
table not carrying `org_id`, `DELETE` granted, `anon` holding a table-wide grant,
missing `deleted_at`, or a `security definer` function without a pinned
`search_path`. No rows means clean. Unlike the isolation test it covers tables
that do not exist yet.

DECISIONS #21–24. Three commits.

**Proven, not just written:** Isolation holds with all three new tables — 1, 4,
8, 0, 0, 0. `select phone from employees` as `anon` is refused by Postgres, so a
stylist's number cannot reach a public page regardless of what any future query
asks for. An attempt to link Kedus's stylist to another salon's service fails on
`employee_services_service_same_org`; without the composite key it would have
succeeded silently with every RLS policy satisfied. A price change logs only the
`price` key with `from` and `to`; a soft delete logs as `entity.deleted` at
`critical` rather than as an update.

**Broke / unresolved:** Migration 007 was pasted into the SQL editor instead of
pushed, so the schema applied but the history table did not know — fixed with
`migration repair`. The rule that avoids it: migrations go through `db push`,
scripts go in the SQL editor.

I reintroduced a bug migration 004 had already fixed. Extending
`create_organization()` in 007 and 008 with `CREATE OR REPLACE`, I carried the
pre-004 signature along, and Postgres permits *adding* a default back — so
onboarding without naming a timezone silently meant Africa/Johannesburg again.
No organization was created in the window. Migration 009 restores it and the
function comment now says why not to.

The audit script found three foreign keys from migrations 001 and 006 pointing
at tenant tables by id alone: `profiles.role_id`, `role_permissions.role_id`,
`audit_log.actor_id`. None was exploitable, because `has_permission()` joins
`role_permissions` on both `role_id` and `org_id` — a profile aimed at another
salon's role gets nothing rather than someone else's access. That is one
undocumented line doing load-bearing work. Fixed in 010. The lesson worth
keeping: DECISIONS #21 was already written down and the violations were still
there.

**The seed's fictional half.** Every service name and category is real, as are
the hours, contacts, socials, tagline and two $40 prices. Every other price,
every duration and all five employees are invented. Two of those bite later:
durations are what Phase 4 computes availability from, so real ones block the
booking form, and the five staff are fictional people who must be replaced before
this site reaches a real domain or someone will phone up asking for Hanna.

The salon's own site is a source, not the truth — it links a Facebook page they
do not use, and gives an address mixing a DC street with a Maryland ZIP. Recorded
as Maryland; needs confirming before it hits a map. Their Instagram handle is
still unverified: the site says `kedus_hb`, the TikTok is `kedushairsalon`.

A stray `insert` ran three times and made three "Test Stylist" rows, because
`full_name` is deliberately not unique — two real people can share a name. Extras
soft-deleted. Guarding against a double-click belongs in the Phase 6 create form,
not in the database.

Still no Vercel deploy and no prod project. Still no generated database types, so
`getProfile()` casts. Docker still not installed, so `db push` warns about a
catalog cache it cannot build; harmless so far.

**Next:** Phase 3's pages — homepage, services and pricing, team, gallery,
contact — all reading from the tables seeded today. The first session with
something on screen.

---

## 2026-08-09 — Phase 2, the application half

**Built:** The Next.js app now talks to Supabase. Browser and server clients
from `@supabase/ssr`, with `.env.local.example` committed so the required
variables are documented. `/lib/auth` holding `getUser`, `getProfile`, `can`,
`requireProfile`, `requirePermission` — `can()` delegates to `has_permission()`
in Postgres, so the app and the RLS policies cannot disagree. Staff login at
`/login` through a server action, so the password is never handled by browser
JavaScript. Middleware refreshing the session token before every page load.
`/staff`, the first page the database guards. Five commits.

**Proven, not just written:** signed in as the Kedus Owner in a real browser and
got three yeses from the permissions catalogue. `/staff` typed straight into the
address bar while signed out redirects to `/login`. `grep` confirms the only
three `.auth.` calls in `src/` sit inside `/lib/auth`.

**Broke / unresolved:** `env.ts` first read variables as `process.env[name]`.
Next.js substitutes values by finding the literal text at build time, so that
would have arrived empty inside middleware — caught before it shipped, fixed by
naming each variable in full. The Owner password was lost and reset directly in
`auth.users` with SQL; acceptable on dev, not a habit to carry to prod. No
generated database types, so `getProfile()` casts. Session refresh works but
nothing tests it automatically — proving it needs an hour of waiting. Still no
Vercel deploy and no prod project.

**Next:** Phase 3, the public website. The `services` and `employees` tables
with their RLS policies come first, then the pages that read them.

---

## 2026-08-08 — Multi-tenant foundation

**Built:** Supabase CLI installed and linked to Salon dev. Six migrations:
tenancy core (organizations, profiles, roles, permissions, role_permissions),
access control (14 RLS policies, column-level grants, two `security definer`
helper functions, `settings` split into public and private), the permissions
catalogue plus `create_organization()`, timezone/currency moved to New York and
USD, `create_profile()`, and `audit_log`. Kedus Hair Salon and Braiding created
on dev with its four system roles, and its first Owner profile. DECISIONS #14–20.

`audit_log` is written by triggers rather than by application code, because the
RLS policies allow direct table updates through the API with no function in the
path — a function-based approach would have been quietly incomplete. The trigger
is `security definer` so it can write to a table that grants INSERT to nobody.
Verified: a real edit logs one row containing only what changed; an edit that
changes nothing logs nothing.

Phase 1 was redefined mid-session. It was written as "the whole database"; it is
now the multi-tenant foundation, with the remaining five tables moved into the
phases that use them. Phase 1 is complete, 14 of 14.

**Proven, not just written:** a second organization created inside a rolled-back
transaction is invisible to the Kedus owner — 1, 4, 4, 0. The permissions chain
resolves end to end from login through role to a yes/no, and an unknown
permission key denies rather than errors. Kept as
`supabase/scripts/test-tenant-isolation.sql`; re-run after adding any table.

**Broke / unresolved:** The first two migrations were run in the SQL editor
before the CLI worked, so the migration history needed repairing twice — schema
changes go through `db push` from now on. No prod project; deferred deliberately,
with the trigger recorded as the first real customer record. Remaining tables not
built — employees, services, customers, appointments, audit_log. Docker isn't
installed, so `supabase db dump` and local development don't work; not needed so
far. Nothing in the Next.js app talks to Supabase yet — no environment variables,
no client, no login page. The Kedus row's phone and address still hold the
original South African placeholders while `create-kedus-organization.sql` says
the US ones, so the script no longer reproduces the row — one update statement
fixes it. An unused throwaway auth user may exist in the dashboard; delete it if
so.

**Next:** Phase 2, the application half — environment variables, Supabase
browser and server clients, the `/lib/auth` module, and a staff login page.
`@supabase/supabase-js` and `@supabase/ssr` approved but not yet installed.

---

## [date] — Project setup

**Built:** Foundation documents added to repo. Nothing else yet.

**Broke / unresolved:** Nothing.

**Next:** git init, GitHub repo, Supabase dev + prod projects, Next.js scaffold,
first deploy to Vercel.

---

<!--
How to use this file:

At the START of a session, paste the top entry into Claude Code so it knows
where you left off.

At the END of a session, ask Claude Code to write the new entry. It knows what
it built. Check it, then commit it.

Be honest in "Broke / unresolved." A log that only records successes is a log
that lies to you in three weeks.
-->
