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

## 2026-08-08 — Multi-tenant foundation

**Built:** Supabase CLI installed and linked to Salon dev. Five migrations:
tenancy core (organizations, profiles, roles, permissions, role_permissions),
access control (14 RLS policies, column-level grants, two `security definer`
helper functions, `settings` split into public and private), the permissions
catalogue plus `create_organization()`, timezone/currency moved to New York and
USD, and `create_profile()`. Kedus Hair Salon and Braiding created on dev with
its four system roles, and its first Owner profile. DECISIONS #14–20.

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
no client, no login page.

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
