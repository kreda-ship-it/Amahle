-- ============================================================
-- 013 — employee_working_hours and employee_time_off
--
-- When each person works, and when they are away. Availability is the
-- intersection of those two with what is already booked, so nothing in
-- Phase 4 can be computed until these exist.
--
-- NO ANON GRANTS, AND THAT SHAPES THE BOOKING FORM
--
-- The public booking form has to show free slots, which sounds like it
-- needs to read these tables. It does not, and must not. A browser that
-- can read working hours can read who works when, and a browser that
-- does availability arithmetic is a browser that can be lied to about
-- the result.
--
-- Availability will be computed by a database function the form calls,
-- the same shape as createAppointment(): one path, in the database,
-- where the rules cannot be skipped. These tables stay unreadable to
-- anon and the function returns free slots and nothing else.
--
-- NO NEW PERMISSION KEY
--
-- Editing a rota is managing the team roster, which is exactly what
-- employee.record.manage already means. DECISIONS #24 justifies a
-- second key where the JOB differs, and this is the same job.
-- ============================================================


-- ------------------------------------------------------------
-- 1. employee_working_hours — the regular week.
--
-- SEVERAL ROWS PER DAY IS THE POINT, not a bug to constrain away.
-- 09:00–13:00 plus 14:00–18:00 is a stylist with a long lunch, and it
-- is how most salon rotas actually look. There is deliberately no
-- unique constraint on (employee_id, day_of_week).
--
-- Overlapping rows are therefore possible — 09:00–13:00 and
-- 12:00–18:00 both save. Availability unions them, so the computed
-- result is correct either way; the row is untidy, not wrong. Refusing
-- the overlap outright needs an exclusion constraint and the
-- btree_gist extension, which is a database dependency bought to
-- prevent a cosmetic problem. Decided 2026-08-17.
--
-- TIME, NOT TIMESTAMPTZ, and that is deliberate. "Tuesday 9am" is a
-- fact about the salon's own clock, and it stays 9am when the clocks
-- change. organizations.timezone is what turns it into a real moment,
-- at the point availability is computed. Storing these as timestamptz
-- would freeze one particular Tuesday into the rota.
-- ------------------------------------------------------------
create table public.employee_working_hours (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id),
  employee_id  uuid not null,
  day_of_week  int  not null,
  start_time   time not null,
  end_time     time not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint employee_working_hours_employee_same_org
    foreign key (employee_id, org_id)
      references public.employees (id, org_id),

  constraint employee_working_hours_day_range
    check (day_of_week between 0 and 6),

  -- No overnight shifts. A salon that closes at 21:00 and opens at
  -- 09:00 is two rows on two days, not one row crossing midnight.
  -- If a 24-hour spa ever onboards, this is the constraint to revisit.
  constraint employee_working_hours_end_after_start
    check (end_time > start_time)
);

comment on table public.employee_working_hours is
  'The regular working week. Several rows per day is normal — that is a split shift.';

comment on column public.employee_working_hours.day_of_week is
  '0 = Sunday, matching Postgres extract(dow) and JavaScript getDay(). Do not renumber.';

comment on column public.employee_working_hours.start_time is
  'Local salon time, interpreted in organizations.timezone. Survives a clock change unchanged.';

create index employee_working_hours_org_id_idx
  on public.employee_working_hours (org_id);

create index employee_working_hours_employee_day_idx
  on public.employee_working_hours (employee_id, day_of_week)
  where deleted_at is null;

create trigger employee_working_hours_set_updated_at
  before update on public.employee_working_hours
  for each row execute function public.set_updated_at();

alter table public.employee_working_hours enable row level security;


-- ------------------------------------------------------------
-- 2. employee_time_off — the exceptions.
--
-- timestamptz here, unlike the rota above, because a holiday is a real
-- moment rather than a repeating fact about the clock.
--
-- NO REASON COLUMN, DELIBERATELY.
--
-- The calendar needs to know a stylist is unavailable on the 14th. It
-- does not need to know why. "Sick" in a free text box is health data
-- about an employee, readable by every colleague, and protecting it
-- properly would mean a third table with its own policies, audit
-- trigger and permission key — real machinery, so that a five-person
-- salon can hide a word from four people who already know it.
--
-- Unlike a customer's allergies, which are a legal-exposure question
-- about someone who never consented to be in this database, a reason
-- for leave does not clear that bar at this size. If the salon later
-- asks to record why, that is a table then, with a real requirement
-- behind it rather than a guessed one. Decided 2026-08-17.
-- ------------------------------------------------------------
create table public.employee_time_off (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations (id),
  employee_id  uuid not null,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,

  constraint employee_time_off_employee_same_org
    foreign key (employee_id, org_id)
      references public.employees (id, org_id),

  constraint employee_time_off_end_after_start
    check (ends_at > starts_at),

  -- Nothing references this table yet. The key costs nothing and is
  -- what every other tenant table already carries.
  constraint employee_time_off_id_org_key unique (id, org_id)
);

comment on table public.employee_time_off is
  'Holidays, sick days, blocked time. Records THAT someone is away, never why.';

create index employee_time_off_org_id_idx
  on public.employee_time_off (org_id);

-- Availability asks "is this person off between X and Y", so the range
-- is what gets searched, per employee.
create index employee_time_off_employee_range_idx
  on public.employee_time_off (employee_id, starts_at, ends_at)
  where deleted_at is null;

create trigger employee_time_off_set_updated_at
  before update on public.employee_time_off
  for each row execute function public.set_updated_at();

alter table public.employee_time_off enable row level security;


-- ------------------------------------------------------------
-- 3. Column privileges.
--
-- No anon grants, for the reason in the header.
-- ------------------------------------------------------------
revoke all on public.employee_working_hours from anon, authenticated;
revoke all on public.employee_time_off      from anon, authenticated;

grant select on public.employee_working_hours to authenticated;

grant insert (org_id, employee_id, day_of_week, start_time, end_time)
  on public.employee_working_hours to authenticated;

grant update (day_of_week, start_time, end_time, deleted_at)
  on public.employee_working_hours to authenticated;

grant select on public.employee_time_off to authenticated;

grant insert (org_id, employee_id, starts_at, ends_at)
  on public.employee_time_off to authenticated;

grant update (starts_at, ends_at, deleted_at)
  on public.employee_time_off to authenticated;


-- ------------------------------------------------------------
-- 4. Policies.
--
-- Reading needs no permission beyond being in the salon. Everyone
-- needs to know who is working today — that is the calendar. Editing
-- needs employee.record.manage, the roster key.
-- ------------------------------------------------------------

create policy employee_working_hours_select
  on public.employee_working_hours for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy employee_working_hours_insert
  on public.employee_working_hours for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('employee.record.manage'));

create policy employee_working_hours_update
  on public.employee_working_hours for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('employee.record.manage'))
  with check (org_id = public.current_org_id());


create policy employee_time_off_select
  on public.employee_time_off for select to authenticated
  using (deleted_at is null and org_id = public.current_org_id());

create policy employee_time_off_insert
  on public.employee_time_off for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('employee.record.manage'));

create policy employee_time_off_update
  on public.employee_time_off for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('employee.record.manage'))
  with check (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 5. Audit.
--
-- Both routine. Operational scheduling, carrying no personal detail —
-- which is now true by construction rather than by good intentions,
-- because there is no reason column to hold any.
-- ------------------------------------------------------------
create trigger employee_working_hours_audit
  after insert or update on public.employee_working_hours
  for each row execute function public.audit_row('employee_working_hours', 'routine');

create trigger employee_time_off_audit
  after insert or update on public.employee_time_off
  for each row execute function public.audit_row('employee_time_off', 'routine');
