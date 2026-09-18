-- ============================================================
-- 045 — when it actually happened
--
-- Three nullable columns and one function body. The smallest
-- migration in this project, and the only outstanding one that
-- cannot be done later at the same price.
--
-- WHY IT CANNOT WAIT. Every other item on the list describes work
-- that will cost the same in a month. This one describes a
-- MEASUREMENT, and a measurement not taken is gone. Every day the
-- salon runs without these columns is a day of "the ninety-minute
-- service actually took a hundred and fifteen" that nobody can ever
-- recover.
--
-- WHAT IT UNLOCKS, so it is not three columns for their own sake.
-- DECISIONS #12 defers deposits until no-shows are "a measured
-- problem the salon complains about". DECISIONS #29 defers reminders
-- on a similar trigger. Neither trigger can fire today: `status`
-- records that an appointment WAS completed and nothing records
-- WHEN, so there is no way to say a service overruns by twenty
-- minutes on average, or that Saturdays run late and Tuesdays do
-- not. Three months of these rows turns those from arguments into
-- arithmetic — which is the same reasoning that put marking a
-- no-show into Phase 5's first version rather than a later one.
--
-- NOT REPORTING. Nothing reads these yet, and no screen changes.
-- Analytics is out of v1 and stays out. This is the recording, and
-- the recording is the part with a deadline.
--
-- NO BACKFILL, deliberately. The information does not exist for
-- appointments already in the table, so those rows stay null.
-- Inventing a plausible number would be worse than an honest gap —
-- it would be indistinguishable from a real one forever.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The columns.
--
-- Three, not eight. `pending` and `confirmed` are decisions made
-- ahead of the day rather than events during it, and the audit log
-- already holds when they changed. `cancelled` and `no_show` are
-- coming with the cancellation work and want a reason beside them,
-- which is a different shape and a different migration.
--
-- These three are the ones that bound the actual work: the customer
-- arrived, the work started, the work finished. Two subtractions and
-- you have how long somebody waited and how long the service really
-- took.
-- ------------------------------------------------------------
alter table public.appointments
  add column checked_in_at timestamptz,
  add column started_at    timestamptz,
  add column completed_at  timestamptz;

comment on column public.appointments.checked_in_at is
  'When the customer was last marked as arrived. Written only by set_appointment_status().';

comment on column public.appointments.started_at is
  'When the work was last marked as begun. With checked_in_at, this is how long somebody waited.';

comment on column public.appointments.completed_at is
  'When the work was last marked as finished. With started_at, this is how long the service REALLY took, against the duration the service claims.';


-- ------------------------------------------------------------
-- 2. Column privileges.
--
-- THE LINE THAT MATTERS IS THE ONE THAT IS NOT HERE. Migration 014
-- grants UPDATE on this table as an explicit column list, and these
-- three are not on it and are not being added to it. So no role can
-- write them by any route except set_appointment_status() below —
-- the same shape as `price`, `ends_at` and `blocked_until`. A
-- measurement a direct API call can quietly correct is not a
-- measurement.
--
-- The select grant is redundant and deliberate. Migration 014 grants
-- SELECT on the whole table, which in Postgres covers columns added
-- afterwards, so this changes nothing — it is here because migration
-- 037 did the same for `phase`, and a reader comparing the two
-- should not have to wonder why one column was treated differently.
--
-- No grant to anon. A customer's arrival time is nobody's business
-- but the salon's, and anon holds nothing on this table anyway.
-- ------------------------------------------------------------
grant select (checked_in_at, started_at, completed_at)
  on public.appointments to authenticated;


-- ------------------------------------------------------------
-- 3. set_appointment_status(), which now stamps as well as sets.
--
-- Unchanged from migration 042 above the update. It is already the
-- only path a status changes by, which is why this is three lines
-- rather than a trigger: there is no second writer to keep in step.
--
-- LAST GENUINE MARK WINS. Marking an appointment finished by mistake
-- at 2:15, correcting it back to in-the-chair, then finishing it
-- properly at 3:40 leaves completed_at at 3:40. The correction is
-- the true answer, and a rule where the first tap wins would let one
-- mis-tap poison a number permanently with nothing to show it had.
--
-- Re-marking a status the appointment ALREADY holds stamps nothing.
-- `status is distinct from p_status` reads the OLD value inside a
-- SET clause, so this is a genuine transition or it is nothing. The
-- grid cannot produce that case — mark() returns early when the
-- status is unchanged — but a direct call to this function can, and
-- the function is what holds the rule.
--
-- THE CAVEAT, written down because somebody will meet it. These
-- columns answer "when was this last marked X", and `status` remains
-- the authority on what the appointment IS. A row corrected from
-- finished back to in-the-chair keeps its completed_at. So anything
-- measuring later must filter on the status as well as on the column
-- being present. Clearing stamps on the way back out would be
-- cleaner data and meaningfully more branching inside a security
-- boundary, which is a bad trade for three columns.
-- ------------------------------------------------------------
create or replace function public.set_appointment_status(
  p_appointment_id uuid,
  p_status         text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org      uuid;
  v_employee uuid;
  v_mine     boolean;
begin
  select a.org_id, a.employee_id
  into v_org, v_employee
  from public.appointments a
  where a.id = p_appointment_id and a.deleted_at is null;

  if v_org is null then
    raise exception 'That appointment no longer exists.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'That appointment belongs to another salon.';
  end if;

  v_mine := v_employee is not distinct from public.current_employee_id()
            and public.current_employee_id() is not null;

  if public.has_permission('appointment.manage') then
    null;  -- the desk may set any status on any appointment
  elsif v_mine then
    if p_status not in ('checked_in', 'in_progress', 'completed', 'no_show') then
      raise exception
        'You can mark a customer arrived, in the chair, finished or a no-show. Ask the desk for anything else.';
    end if;
  else
    raise exception 'You may only change your own appointments.';
  end if;

  update public.appointments
  set status        = p_status,
      checked_in_at = case
                        when p_status = 'checked_in'
                         and status is distinct from 'checked_in'
                        then now() else checked_in_at
                      end,
      started_at    = case
                        when p_status = 'in_progress'
                         and status is distinct from 'in_progress'
                        then now() else started_at
                      end,
      completed_at  = case
                        when p_status = 'completed'
                         and status is distinct from 'completed'
                        then now() else completed_at
                      end
  where id = p_appointment_id;
end;
$$;

comment on function public.set_appointment_status(uuid, text) is
  'The only way an appointment status changes. The desk may set any; an employee may set the four operational ones on their own rows. Stamps checked_in_at, started_at and completed_at on a genuine transition.';

revoke execute on function public.set_appointment_status(uuid, text) from public, anon;
grant  execute on function public.set_appointment_status(uuid, text) to authenticated;
