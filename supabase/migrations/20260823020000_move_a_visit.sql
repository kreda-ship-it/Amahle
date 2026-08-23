-- ============================================================
-- 039 — moving a visit
--
-- Phase 5 step 5: dragging an appointment to a new time. Two
-- changes, and the first is the one worth reading carefully.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The double-booking constraint becomes DEFERRABLE.
--
-- Not a loosening. `initially immediate` means it behaves exactly
-- as it does today for every existing write path — the second
-- booking on the same stylist is still refused at the moment of
-- the insert, and create_appointment() is untouched.
--
-- What it adds is the ability for ONE transaction to say "check me
-- at the end instead", and move_visit() below is the only thing
-- that ever will.
--
-- WHY IT HAS TO. A chained visit is several rows back to back on
-- one stylist:
--
--   blow dry   10:00 - 10:45   blocked until 10:45
--   trim       10:45 - 11:15   blocked until 11:25
--
-- Shift both forward by thirty minutes and the rows are updated
-- one at a time. The moment the first becomes 10:30 - 11:15, the
-- second is still sitting at 10:45 - 11:15 and the two overlap.
-- The constraint refuses the move — correctly, by its own rules,
-- for a final state that is perfectly legal.
--
-- Rewriting the update to dodge that means ordering the rows so no
-- intermediate state ever overlaps, which is possible moving
-- forward, possible moving backward, and different in each
-- direction. That is a puzzle to re-solve every time the visit
-- shape changes. Deferring is the mechanism Postgres provides for
-- exactly this, and it says what we mean: the visit is one thing,
-- so check it once it IS one thing.
--
-- The cost, so it is a choice and not a freebie: a deferred check
-- fires at commit, so a violation inside move_visit() surfaces as
-- the transaction failing rather than the statement. Same SQLSTATE
-- (23P01), same message to the caller.
-- ------------------------------------------------------------
alter table public.appointments
  drop constraint appointments_no_double_booking;

alter table public.appointments
  add constraint appointments_no_double_booking
  exclude using gist (
    employee_id with =,
    tstzrange(starts_at, blocked_until) with &&
  )
  where (deleted_at is null and status not in ('cancelled', 'no_show'))
  deferrable initially immediate;


-- ------------------------------------------------------------
-- 2. move_visit() — the canonical way an appointment moves.
--
-- THE WHOLE VISIT MOVES, ALWAYS. Since migration 033 a braid is a
-- founding by a stylist and a finishing by an assistant, sharing a
-- visit_id. Dragging the founding two hours later and leaving the
-- finishing where it was would put an assistant on a head nobody
-- has started, possibly after she has gone home. There is no
-- reading of "move this appointment" that means that.
--
-- So the caller names the visit and the new START of it, and every
-- row shifts by the same interval. The internal shape — who founds,
-- who finishes, the gaps between chained services — is preserved
-- exactly, because it is a fact about the work rather than about
-- the clock.
--
-- WHAT IT DOES NOT CHECK, and deliberately. Not the rota, not
-- opening hours, not the lead time. This is staff moving work
-- around, and DECISIONS #30 already establishes that staff are
-- stopped only by the exclusion constraint: the receptionist knows
-- the stylist agreed to stay late and the database does not. The
-- clash with another customer is the thing that is never allowed,
-- and that is the constraint's job, not this function's.
-- ------------------------------------------------------------
create or replace function public.move_visit(
  p_visit_id  uuid,
  p_starts_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_first timestamptz;
  v_shift interval;
begin
  if public.current_profile_id() is null then
    raise exception 'Only signed-in staff may move an appointment.';
  end if;

  if not public.has_permission('appointment.manage') then
    raise exception 'You may not move appointments.';
  end if;

  -- The visit's own start is the earliest row in it, which is the
  -- block somebody dragged. Every other row keeps its offset from
  -- that moment.
  select min(a.starts_at), min(a.org_id)
  into v_first, v_org
  from public.appointments a
  where a.visit_id = p_visit_id
    and a.deleted_at is null;

  if v_first is null then
    raise exception 'That visit no longer exists.';
  end if;

  -- security definer runs as the owner, so RLS is not doing this
  -- for us. Said explicitly rather than relied upon.
  if v_org is distinct from public.current_org_id() then
    raise exception 'That visit belongs to another salon.';
  end if;

  v_shift := p_starts_at - v_first;

  if v_shift = interval '0' then
    return;
  end if;

  -- Check the whole visit once it is a whole visit again. See the
  -- note on the constraint above.
  set constraints public.appointments_no_double_booking deferred;

  update public.appointments a
  set starts_at     = a.starts_at + v_shift,
      ends_at       = a.ends_at + v_shift,
      blocked_until = a.blocked_until + v_shift
  where a.visit_id = p_visit_id
    and a.deleted_at is null;
end;
$$;

comment on function public.move_visit(uuid, timestamptz) is
  'The only way an appointment changes time. Moves every row in the visit by the same interval, so a founding and its finishing stay together. Staff only; stopped only by the double-booking constraint.';

revoke execute on function public.move_visit(uuid, timestamptz) from public, anon;
grant  execute on function public.move_visit(uuid, timestamptz) to authenticated;
