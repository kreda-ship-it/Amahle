-- Scans the whole database for anything that breaks the multi-tenant
-- rules in CLAUDE.md and DECISIONS.md.
--
-- NO ROWS MEANS THE DATABASE IS CLEAN. Every row is a problem.
--
-- Run this after every migration. It needs no setup, changes nothing,
-- and creates no test data — paste it into the SQL editor and read the
-- answer.
--
-- Why this exists alongside test-tenant-isolation.sql: that test proves
-- one salon cannot see another's rows, but only for the tables it names,
-- and only when somebody remembers to run it. This one asks the database
-- itself what tables exist and checks every one of them, so a table
-- added in Phase 5 is covered without anyone editing this file. At forty
-- salons a forgotten policy is embarrassing. At a thousand it is a
-- breach.
--
-- Last run against Salon dev on 2026-08-15 — clean.
--
-- Its first run was not clean. It found three foreign keys from
-- migrations 001 and 006 that referenced a tenant table by id alone:
-- profiles.role_id, role_permissions.role_id and audit_log.actor_id.
-- All three predated DECISIONS #21 and were fixed by migration 010.
-- Worth remembering that the rule was already written down and the
-- violations were still there — which is the entire argument for
-- checking mechanically rather than by reading.

select * from (

  -- ----------------------------------------------------------
  -- 1. Every tenant table must carry org_id.
  --
  -- Two documented exceptions (SCHEMA.md): organizations IS the tenant,
  -- and permissions is a shared catalogue of what the software can do
  -- rather than anyone's data.
  -- ----------------------------------------------------------
  select 1 as sort_order,
         'critical'                     as severity,
         'missing org_id'               as check_name,
         c.relname::text                as object_name,
         'Table has no org_id column, so no policy can scope it to one salon.' as detail
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname not in ('organizations', 'permissions')
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid
        and a.attname  = 'org_id'
        and a.attnum   > 0
        and not a.attisdropped
    )

  union all

  -- ----------------------------------------------------------
  -- 2. RLS must be enabled on every table.
  --
  -- Without it, policies are decoration: Postgres hands over every row
  -- to anyone holding a grant.
  -- ----------------------------------------------------------
  select 1,
         'critical',
         'RLS disabled',
         c.relname::text,
         'Row-level security is switched off. Any policies on this table are ignored.'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity

  union all

  -- ----------------------------------------------------------
  -- 3. RLS enabled with zero policies denies everything.
  --
  -- Deliberate on audit_log, which is written by a security definer
  -- trigger and read by nobody until an audit screen earns the right.
  -- Anywhere else it is a table someone forgot to finish, and it fails
  -- as a blank page rather than as an error.
  -- ----------------------------------------------------------
  select 2,
         'warning',
         'RLS on, no policies',
         c.relname::text,
         'Denies all access to everyone. Intended only for audit_log.'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity
    and c.relname <> 'audit_log'
    and not exists (
      select 1 from pg_policy p where p.polrelid = c.oid
    )

  union all

  -- ----------------------------------------------------------
  -- 4. Foreign keys between tenant tables must carry org_id.
  --
  -- DECISIONS #21. RLS says which rows you may read; it does not stop
  -- you pointing at one you may not. A reference to (id) alone lets one
  -- salon's row attach to another salon's row with every policy
  -- satisfied.
  --
  -- References to organizations are exempt and excluded automatically:
  -- that table has no org_id of its own, so the test below skips it.
  -- ----------------------------------------------------------
  select 1,
         'critical',
         'foreign key without org_id',
         (con.conrelid::regclass)::text || '.' || con.conname,
         'References ' || (con.confrelid::regclass)::text ||
         ' by id alone. Should reference (id, org_id) — see DECISIONS #21.'
  from pg_constraint con
  join pg_class     c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where con.contype = 'f'
    and n.nspname = 'public'
    -- the table being pointed AT is tenant-scoped
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = con.confrelid
        and a.attname  = 'org_id'
        and a.attnum   > 0
        and not a.attisdropped
    )
    -- but this key does not include our own org_id column
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = con.conrelid
        and a.attname  = 'org_id'
        and a.attnum   = any (con.conkey)
    )

  union all

  -- ----------------------------------------------------------
  -- 5. Nobody may hold DELETE.
  --
  -- Soft-delete is enforced by the absence of the grant, not by
  -- discipline. service_role is excluded: it bypasses RLS by design and
  -- is never used by the application.
  -- ----------------------------------------------------------
  select 1,
         'critical',
         'DELETE granted',
         g.table_name::text || ' → ' || g.grantee::text,
         'Hard deletes must be impossible through the API. Set deleted_at instead.'
  from information_schema.role_table_grants g
  where g.table_schema   = 'public'
    and g.privilege_type = 'DELETE'
    and g.grantee in ('anon', 'authenticated', 'PUBLIC')

  union all

  -- ----------------------------------------------------------
  -- 6. anon must never hold a table-wide privilege.
  --
  -- Anonymous access is always granted column by column, so that a
  -- column added later is private until someone decides otherwise. A
  -- table-level grant does the opposite: every future column is public
  -- the moment it is created.
  --
  -- Column-level grants do not appear in this view, which is precisely
  -- what makes the check work.
  -- ----------------------------------------------------------
  select 1,
         'critical',
         'anon holds a table-wide grant',
         g.table_name::text || ' → ' || g.privilege_type::text,
         'Anonymous access must be granted per column, or every column added later is public by default.'
  from information_schema.role_table_grants g
  where g.table_schema = 'public'
    and g.grantee      = 'anon'

  union all

  -- ----------------------------------------------------------
  -- 7. Soft-delete needs somewhere to record itself.
  --
  -- permissions is reference data changed by migration; audit_log is
  -- append-only. Neither has anything to soft-delete.
  -- ----------------------------------------------------------
  select 2,
         'warning',
         'missing deleted_at',
         c.relname::text,
         'No deleted_at column, so rows here can only be removed by a hard delete.'
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname not in ('permissions', 'audit_log')
    and not exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid
        and a.attname  = 'deleted_at'
        and a.attnum   > 0
        and not a.attisdropped
    )

  union all

  -- ----------------------------------------------------------
  -- 8. Every security definer function must pin its search_path.
  --
  -- These functions run with their creator's privileges. Without
  -- `set search_path = ''`, anyone able to create objects can shadow a
  -- table name and have the function operate on theirs instead.
  -- ----------------------------------------------------------
  select 1,
         'critical',
         'security definer without search_path',
         p.proname::text,
         'Runs with elevated privileges and resolves names against the caller''s search_path.'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not exists (
      select 1
      from unnest(coalesce(p.proconfig, '{}')) as cfg
      where cfg like 'search\_path=%'
    )

) findings
order by sort_order, check_name, object_name;
