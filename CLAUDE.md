# CLAUDE.md — Amahle

**Read PROJECT.md before your first response in any session.** It explains what
this app is, who it's for, and why the architecture is the way it is.

---

## About the developer

Self-taught, learning while building. Explanations in plain English, no
unexplained jargon. The goal is that he understands the code, not just receives
it. When you use a term he may not know, define it in one line the first time.

## Non-negotiable workflow

1. **PLAN first.** Describe what you'll change and which files. Wait for
   approval before writing anything.
2. **SHOW before saving.** Never write a file whose plan he hasn't seen.
3. **ONE feature at a time.** Never bundle. If he asks for two things, do the
   first and stop.
4. After each stage, tell him exactly what to test manually — click by click.
5. Remind him to commit after every working stage.
6. If he pastes an error or output, explain it in plain English before proposing
   a fix.
7. At the end of a work session, offer to write the SESSION_LOG.md entry.

## Hard architectural rules

- Every table has `org_id` (non-null). Every query is scoped by it.
- RLS enabled on every table. Security lives in the database, not the UI.
- Soft-delete only. Set `deleted_at`. Never `DELETE`.
- Permissions come from the database. Never hardcoded booleans. Never
  `if (role === 'owner')` in application code.
- One canonical creation function per record type. Never a second path.
- Every create/update/delete writes to `audit_log`.
- Auth is touched only in `/lib/auth`. No Supabase auth calls anywhere else.
- Server-side data access by default. Client components only where interactivity
  requires it.
- No secrets in client code, ever.

## Naming — see GLOSSARY.md

customer (not client) · employee (not staff/stylist) · appointment (not booking)
· organization (not tenant/salon) · service (not treatment)

Use these exact words in schema, code, comments, and UI copy.

## Stop and ask

- Before any schema change or migration.
- Before adding a dependency.
- Before touching auth or RLS.
- If a fix requires changing more than three files.
- If the request conflicts with anything in PROJECT.md or DECISIONS.md.

## Not in v1 — do not build, do not scaffold for

payments · inventory · financial management · analytics dashboards · website CMS
· notifications beyond a booking confirmation · task and maintenance center ·
internal notes system · gift cards · blog · product store · multi-location ·
AI features

If he asks for one of these, say it's out of v1 scope and ask whether he wants to
change the scope deliberately (which means updating PROJECT.md and DECISIONS.md)
or defer it.

## When you disagree

Say so. Explain the tradeoff and give a recommendation. Don't silently comply
with something you think is a mistake, and don't refuse — lay out the choice and
let him decide.
