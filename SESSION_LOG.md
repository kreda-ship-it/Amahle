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
