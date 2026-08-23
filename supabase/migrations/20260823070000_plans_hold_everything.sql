-- ============================================================
-- 044 — a plan holds everything the calendar can do
--
-- Migration 040 built plans that hold MOVES: a visit and where it
-- should start. Then 041 gave the calendar two more gestures —
-- reassigning one appointment to another person, and changing how
-- long one takes — and a plan could express neither.
--
-- THE GRAIN HAS TO CHANGE, and that is the substance of this
-- migration. A move is a fact about a whole visit; a reassignment
-- and a resize are facts about one appointment inside it. Holding
-- both meant either two kinds of entry or one grain that covers
-- both, and the second is the honest shape: an entry says where
-- ONE appointment should be, who should do it, and how long it
-- should take. Moving a whole visit writes one entry per row,
-- which is what "the whole visit moves" already means.
--
-- The table is emptied first. It is days old, nothing has ever
-- written to it outside development, and rewriting a visit-grained
-- row as an appointment-grained one is guesswork — a visit does
-- not know which of its rows a person meant.
-- ============================================================

delete from public.schedule_plan_moves;

drop index if exists public.schedule_plan_moves_one_per_visit;

alter table public.schedule_plan_moves
  drop column visit_id,
  add column appointment_id     uuid not null,
  add column target_employee_id uuid,
  add column target_minutes     int,

  -- Set when this entry lands, so a partly applied plan says which
  -- half succeeded rather than being applied twice.
  add column applied_at         timestamptz,

  -- Why the database refused it, in the words it used. Kept on the
  -- row rather than reported once and lost, because the point of a
  -- partial apply is that you can see what to fix and try again.
  add column refused_reason     text;

comment on column public.schedule_plan_moves.appointment_id is
  'One appointment, not a visit. Moving a whole visit writes one entry per row.';
comment on column public.schedule_plan_moves.target_employee_id is
  'Null means leave the person alone. Set by dragging into another column.';
comment on column public.schedule_plan_moves.target_minutes is
  'Null means leave the length alone. Set by pulling the bottom edge.';

create unique index schedule_plan_moves_one_per_appointment
  on public.schedule_plan_moves (plan_id, appointment_id)
  where deleted_at is null;

grant insert (org_id, plan_id, appointment_id, target_starts_at,
              target_employee_id, target_minutes)
  on public.schedule_plan_moves to authenticated;

grant update (target_starts_at, target_employee_id, target_minutes, deleted_at)
  on public.schedule_plan_moves to authenticated;


-- ------------------------------------------------------------
-- apply_plan(), rewritten: partial, and it says what refused.
--
-- THIS REVERSES MIGRATION 040 DELIBERATELY. That version was
-- all-or-nothing, on the reasoning that a half-applied plan leaves
-- a day which is neither its old shape nor its new one. That
-- reasoning holds for a machine and fails for a person: a plan of
-- fifteen moves where one has been overtaken by a phone booking is
-- not fifteen bad moves, and refusing all of them means doing the
-- work again to change nothing.
--
-- What makes partial safe is that nothing is lost. An entry that
-- lands is marked applied; an entry that is refused keeps its
-- reason and stays in the plan, so the day is always the plan
-- minus exactly the entries still showing as refused. Somebody
-- fixes those and presses Apply again.
-- ------------------------------------------------------------
create or replace function public.apply_plan(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_entry   record;
  v_count   int := 0;
  v_left    int;
  v_minutes int;
begin
  if not public.has_permission('appointment.manage') then
    raise exception 'You may not apply a plan.';
  end if;

  select p.org_id into v_org
  from public.schedule_plans p
  where p.id = p_plan_id and p.deleted_at is null;

  if v_org is null then
    raise exception 'That plan no longer exists.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'That plan belongs to another salon.';
  end if;

  for v_entry in
    select m.id, m.appointment_id, m.target_starts_at,
           m.target_employee_id, m.target_minutes
    from public.schedule_plan_moves m
    where m.plan_id = p_plan_id
      and m.deleted_at is null
      and m.applied_at is null
    order by m.target_starts_at
  loop
    begin
      -- Gone since the plan was written. Not a failure: a customer
      -- who cancels should not make a plan unusable.
      if not exists (select 1 from public.appointments a
                     where a.id = v_entry.appointment_id
                       and a.deleted_at is null) then
        update public.schedule_plan_moves
        set applied_at = now(),
            refused_reason = 'That booking is gone — nothing to move.'
        where id = v_entry.id;

        continue;
      end if;

      if v_entry.target_employee_id is not null then
        perform public.reassign_appointment(
          v_entry.appointment_id,
          v_entry.target_employee_id,
          v_entry.target_starts_at);
      else
        update public.appointments a
        set starts_at     = v_entry.target_starts_at,
            ends_at       = v_entry.target_starts_at + (a.ends_at - a.starts_at),
            blocked_until = v_entry.target_starts_at + (a.blocked_until - a.starts_at)
        where a.id = v_entry.appointment_id;
      end if;

      if v_entry.target_minutes is not null then
        perform public.resize_appointment(
          v_entry.appointment_id,
          v_entry.target_starts_at + make_interval(mins => v_entry.target_minutes));
      end if;

      -- Force the deferred check now, so the refusal belongs to
      -- THIS entry rather than to the transaction as a whole.
      set constraints public.appointments_no_double_booking immediate;

      update public.schedule_plan_moves
      set applied_at = now(), refused_reason = null
      where id = v_entry.id;

      v_count := v_count + 1;
    exception
      when others then
        -- The savepoint this handler creates rolls back only this
        -- entry, which is exactly the granularity wanted.
        update public.schedule_plan_moves
        set refused_reason = left(sqlerrm, 300)
        where id = v_entry.id;
    end;
  end loop;

  select count(*) into v_left
  from public.schedule_plan_moves
  where plan_id = p_plan_id and deleted_at is null and applied_at is null;

  -- Finished only when nothing is still waiting. A plan with
  -- refusals left in it stays open so it can be fixed and re-run.
  if v_left = 0 then
    update public.schedule_plans set applied_at = now() where id = p_plan_id;
  end if;

  return v_count;
end;
$$;

comment on function public.apply_plan(uuid) is
  'Applies what it can and records why the rest refused. The day is always the plan minus the entries still showing a reason.';
