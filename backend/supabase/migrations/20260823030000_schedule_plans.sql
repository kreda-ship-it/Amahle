-- ============================================================
-- 040 — schedule plans
--
-- Phase 5 step 6. A plan is a scratch layer over the real
-- calendar: move things around, save it, come back to it, and
-- nothing reaches the day until Apply.
--
-- THE PLAN STORES CHANGES, NOT A COPY OF THE DAY, and that one
-- choice is what makes the rest free. A booking taken while a plan
-- is open shows through immediately in both modes, because the
-- plan was never holding its own copy of the day to fall out of
-- step with. There is nothing to sync. Stored as a snapshot,
-- "keep the plan current" would have been its own feature, and a
-- buggy one.
--
-- A PLAN RESERVES NOTHING. It is not an appointment, holds no
-- slot, and blocks nobody. Two people can plan the same gap and
-- both be told it is fine; the second Apply is the one that gets
-- refused. That is deliberate — the alternative is holds, and
-- half-finished strangers on the calendar is how staff stop
-- trusting it.
-- ============================================================


-- ------------------------------------------------------------
-- 1. The tables.
--
-- A plan has a NAME and a DATE, so the tabs across the top can be
-- one per day of the coming week AND a second plan for the same
-- day — "Thursday" beside "Thursday, if Fikir is out". Same table
-- either way, which is why the name is not derived from the date.
-- ------------------------------------------------------------
create table public.schedule_plans (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id),
  name        text not null,
  plan_date   date not null,

  -- Who made it. Plans are visible to everybody who can see the
  -- calendar, so the label matters: "look at what I worked out for
  -- Thursday" is half the point of saving one.
  created_by  uuid references public.profiles (id),

  -- Set once Apply succeeds. An applied plan is history, not a
  -- draft, and applying it twice would move everything again.
  applied_at  timestamptz,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  constraint schedule_plans_id_org_key unique (id, org_id)
);

comment on table public.schedule_plans is
  'A scratch layer over the calendar. Holds proposed moves; changes nothing until apply_plan().';

-- One row per visit somebody has dragged. The TARGET is absolute
-- rather than an interval, because a plan has to be able to say
-- "already done" when the visit is where the plan wanted it —
-- which an interval cannot express, since it would apply again.
create table public.schedule_plan_moves (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations (id),
  plan_id          uuid not null,
  visit_id         uuid not null,
  target_starts_at timestamptz not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  -- DECISIONS #21: foreign keys between tenant tables carry org_id,
  -- so a reference cannot cross a salon boundary even though RLS
  -- would happily let you point at a row you cannot read.
  constraint schedule_plan_moves_plan_same_org
    foreign key (plan_id, org_id)
    references public.schedule_plans (id, org_id)
);

comment on column public.schedule_plan_moves.visit_id is
  'The visit to move. Not an appointment id — a braid is several rows and they move together.';

-- One entry per visit per plan. Dragging the same visit twice is a
-- correction, not a second instruction.
create unique index schedule_plan_moves_one_per_visit
  on public.schedule_plan_moves (plan_id, visit_id)
  where deleted_at is null;

create index schedule_plans_org_date_idx
  on public.schedule_plans (org_id, plan_date) where deleted_at is null;

create index schedule_plan_moves_plan_idx
  on public.schedule_plan_moves (plan_id) where deleted_at is null;

create trigger schedule_plans_set_updated_at
  before update on public.schedule_plans
  for each row execute function public.set_updated_at();

create trigger schedule_plan_moves_set_updated_at
  before update on public.schedule_plan_moves
  for each row execute function public.set_updated_at();

alter table public.schedule_plans      enable row level security;
alter table public.schedule_plan_moves enable row level security;


-- ------------------------------------------------------------
-- 2. Column privileges. No anon anywhere near this.
-- ------------------------------------------------------------
revoke all on public.schedule_plans      from anon, authenticated;
revoke all on public.schedule_plan_moves from anon, authenticated;

grant select on public.schedule_plans to authenticated;
grant insert (org_id, name, plan_date, created_by) on public.schedule_plans to authenticated;
grant update (name, deleted_at) on public.schedule_plans to authenticated;

grant select on public.schedule_plan_moves to authenticated;
grant insert (org_id, plan_id, visit_id, target_starts_at)
  on public.schedule_plan_moves to authenticated;
grant update (target_starts_at, deleted_at)
  on public.schedule_plan_moves to authenticated;


-- ------------------------------------------------------------
-- 3. Policies.
--
-- Reading a plan needs appointment.view_all — a plan is a picture
-- of the salon's day, and somebody who may only see their own
-- appointments must not read it whole. Writing needs
-- appointment.manage, the same key that moves an appointment for
-- real. No new permission: DECISIONS #24 only justifies one where
-- the job genuinely differs, and planning a move is managing
-- appointments.
-- ------------------------------------------------------------
create policy schedule_plans_select
  on public.schedule_plans for select to authenticated
  using (deleted_at is null
         and org_id = public.current_org_id()
         and public.has_permission('appointment.view_all'));

create policy schedule_plans_insert
  on public.schedule_plans for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('appointment.manage'));

create policy schedule_plans_update
  on public.schedule_plans for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('appointment.manage'))
  with check (org_id = public.current_org_id());

create policy schedule_plan_moves_select
  on public.schedule_plan_moves for select to authenticated
  using (deleted_at is null
         and org_id = public.current_org_id()
         and public.has_permission('appointment.view_all'));

create policy schedule_plan_moves_insert
  on public.schedule_plan_moves for insert to authenticated
  with check (org_id = public.current_org_id()
              and public.has_permission('appointment.manage'));

create policy schedule_plan_moves_update
  on public.schedule_plan_moves for update to authenticated
  using (org_id = public.current_org_id()
         and public.has_permission('appointment.manage'))
  with check (org_id = public.current_org_id());


-- ------------------------------------------------------------
-- 4. Audit. Routine, both.
--
-- A plan carries no customer detail — a visit id and a time. The
-- moves it eventually makes are audited at critical tier by the
-- appointments trigger, which is where the record belongs.
-- ------------------------------------------------------------
create trigger schedule_plans_audit
  after insert or update on public.schedule_plans
  for each row execute function public.audit_row('schedule_plan', 'routine');

create trigger schedule_plan_moves_audit
  after insert or update on public.schedule_plan_moves
  for each row execute function public.audit_row('schedule_plan_move', 'routine');


-- ------------------------------------------------------------
-- 5. apply_plan() — all of it, or none of it.
--
-- A plan built at ten and applied at twenty past may be stale: a
-- phone booking took one of the slots in between. A half-applied
-- plan leaves a day that is neither its old shape nor its new one,
-- with nobody knowing which — worse than a plan that refused.
--
-- So this is one transaction, and any refusal aborts the whole
-- thing. That is the opposite of applyStatuses() in the
-- application, where each row is independent and a partial result
-- is a partial result of exactly what was asked.
--
-- NAMING WHAT REFUSED, which is the fiddly part. move_visit()
-- defers the double-booking constraint so a chained visit is
-- checked once it is whole again — but a deferred check fires at
-- COMMIT, by which time every move has been made and the error
-- cannot say which one was impossible. So after each move the
-- constraint is forced back to immediate, inside a block that
-- catches the violation and re-raises it naming the visit. The
-- catch rolls back to its own savepoint; the raise takes
-- everything else with it.
-- ------------------------------------------------------------
create or replace function public.apply_plan(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_applied timestamptz;
  v_move    record;
  v_count   int := 0;
  v_when    text;
begin
  if not public.has_permission('appointment.manage') then
    raise exception 'You may not apply a plan.';
  end if;

  select p.org_id, p.applied_at
  into v_org, v_applied
  from public.schedule_plans p
  where p.id = p_plan_id and p.deleted_at is null;

  if v_org is null then
    raise exception 'That plan no longer exists.';
  end if;

  if v_org is distinct from public.current_org_id() then
    raise exception 'That plan belongs to another salon.';
  end if;

  if v_applied is not null then
    raise exception 'That plan has already been applied.';
  end if;

  for v_move in
    select m.visit_id, m.target_starts_at
    from public.schedule_plan_moves m
    where m.plan_id = p_plan_id and m.deleted_at is null
    order by m.target_starts_at
  loop
    -- Already where the plan wants it: nothing to do, and not a
    -- failure. Somebody may have moved it by hand since.
    if (select min(a.starts_at) from public.appointments a
        where a.visit_id = v_move.visit_id and a.deleted_at is null)
       = v_move.target_starts_at then
      continue;
    end if;

    -- Orphaned: the visit was cancelled or removed while the plan
    -- sat there. Skipped rather than fatal — a plan should not be
    -- unusable because one of its customers rang to cancel.
    if not exists (select 1 from public.appointments a
                   where a.visit_id = v_move.visit_id and a.deleted_at is null) then
      continue;
    end if;

    begin
      perform public.move_visit(v_move.visit_id, v_move.target_starts_at);
      set constraints public.appointments_no_double_booking immediate;
    exception
      when exclusion_violation then
        v_when := to_char(v_move.target_starts_at, 'HH24:MI');
        raise exception
          'Somebody is already booked at %. Nothing was applied.', v_when;
    end;

    v_count := v_count + 1;
  end loop;

  update public.schedule_plans
  set applied_at = now()
  where id = p_plan_id;

  return v_count;
end;
$$;

comment on function public.apply_plan(uuid) is
  'Applies every move in a plan, or none of them. Refuses naming the time that clashed. Staff holding appointment.manage only.';

revoke execute on function public.apply_plan(uuid) from public, anon;
grant  execute on function public.apply_plan(uuid) to authenticated;
