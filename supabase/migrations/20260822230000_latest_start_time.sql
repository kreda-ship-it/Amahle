-- ============================================================
-- 035 — the last booking is not the closing time
--
-- The rota says 09:00 to 19:00 and the scheduler read that as "an
-- appointment must FINISH by 19:00". So an eight-hour visit could only
-- start between 09:00 and 10:45, and a wash at 18:30 was refused
-- outright.
--
-- Neither matches the salon. Selam: "the latest long hour service that
-- we accept is 4:30pm, or 5pm… of course we will show that we accept
-- appointments at 7pm on a busy day… it does not necessarily have to
-- finish at 7pm."
--
-- Two different rules were being answered by one number:
--
--   WHEN WE CLOSE            when people go home
--   THE LAST WE WILL TAKE    which depends on the service, and is the
--                            thing the salon actually wants to change
--
-- A trim at 18:45 is fine and finishes a little after close. Braids at
-- 18:45 are not, because somebody would be here at three in the morning.
-- The difference is not the hour, it is the job — so the control belongs
-- on the service.
--
-- OPT-IN, so nothing that exists changes meaning. A service with no
-- latest_start_time behaves exactly as everything did before this
-- migration: it must finish inside the working window. A service WITH
-- one may start any time up to it and run past closing, bounded by the
-- salon's own overhang allowance so that "we stay a bit late" cannot
-- quietly become "we stay until dawn".
-- ============================================================


-- ------------------------------------------------------------
-- 1. The two new controls.
-- ------------------------------------------------------------
alter table public.services
  add column latest_start_time time;

comment on column public.services.latest_start_time is
  'The latest clock time this service may START. NULL means the old rule — it must finish inside working hours. Set, it may start up to this time and run past closing.';

alter table public.organizations
  add column max_overhang_minutes int not null default 120
    check (max_overhang_minutes >= 0);

comment on column public.organizations.max_overhang_minutes is
  'How far past the end of a working window an appointment may run. The safety net under latest_start_time: staying late is normal, staying until dawn is a mistake nobody caught.';

grant select (latest_start_time) on public.services to anon;
grant insert (latest_start_time), update (latest_start_time) on public.services to authenticated;


-- ------------------------------------------------------------
-- 2. schedule_permits() learns which service it is being asked about.
--
-- It could not read latest_start_time before, because it was never told
-- what was being booked — only how many minutes. The new argument is
-- optional and defaults to null, so every existing caller keeps exactly
-- the behaviour it had.
-- ------------------------------------------------------------
create or replace function public.schedule_permits(
  p_org_id      uuid,
  p_employee_id uuid,
  p_starts_at   timestamptz,
  p_minutes     int,
  p_service_id  uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_timezone   text;
  v_lead_hours int;
  v_horizon    int;
  v_overhang   int;
  v_latest     time;
  v_day        date;
  v_ends       timestamptz;
begin
  if p_starts_at is null or p_minutes is null or p_minutes <= 0 then
    return false;
  end if;

  select o.timezone,
         coalesce((o.public_settings ->> 'booking_lead_time_hours')::int, 2),
         coalesce((o.public_settings ->> 'booking_horizon_days')::int, 60),
         o.max_overhang_minutes
  into v_timezone, v_lead_hours, v_horizon, v_overhang
  from public.organizations o
  where o.id = p_org_id and o.deleted_at is null;

  if not found then
    return false;
  end if;

  if p_starts_at < now() + make_interval(hours => v_lead_hours) then
    return false;
  end if;

  if (p_starts_at at time zone v_timezone)::date
     > (now() at time zone v_timezone)::date + v_horizon then
    return false;
  end if;

  v_day  := (p_starts_at at time zone v_timezone)::date;
  v_ends := p_starts_at + make_interval(mins => p_minutes);

  if p_service_id is not null then
    select s.latest_start_time into v_latest
    from public.services s
    where s.id = p_service_id and s.org_id = p_org_id and s.deleted_at is null;
  end if;

  if v_latest is null then
    -- The old rule, unchanged: start and finish inside ONE window. Several
    -- rows for a day is a split shift, and the space between its halves is
    -- a lunch break rather than bookable time.
    perform 1
    from public.employee_working_hours wh
    where wh.employee_id = p_employee_id
      and wh.org_id      = p_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from v_day)::int
      and p_starts_at >= (v_day + wh.start_time) at time zone v_timezone
      and v_ends      <= (v_day + wh.end_time)   at time zone v_timezone;
  else
    -- The new rule: START inside the window and no later than the service
    -- allows. The END may run past closing, by no more than the salon's
    -- overhang allowance.
    perform 1
    from public.employee_working_hours wh
    where wh.employee_id = p_employee_id
      and wh.org_id      = p_org_id
      and wh.deleted_at  is null
      and wh.day_of_week = extract(dow from v_day)::int
      and p_starts_at >= (v_day + wh.start_time) at time zone v_timezone
      and p_starts_at <= (v_day + least(wh.end_time, v_latest)) at time zone v_timezone
      and v_ends      <= ((v_day + wh.end_time) at time zone v_timezone)
                         + make_interval(mins => v_overhang);
  end if;

  if not found then
    return false;
  end if;

  perform 1
  from public.employee_time_off t
  where t.employee_id = p_employee_id
    and t.org_id      = p_org_id
    and t.deleted_at  is null
    and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_starts_at, v_ends);

  return not found;
end;
$fn$;

revoke execute on function public.schedule_permits(uuid, uuid, timestamptz, int, uuid) from public;


-- ------------------------------------------------------------
-- 3. employee_is_free() passes it through.
-- ------------------------------------------------------------
create or replace function public.employee_is_free(
  p_org_id        uuid,
  p_employee_id   uuid,
  p_starts_at     timestamptz,
  p_minutes       int,
  p_session_token text default null,
  p_party_index   int  default null,
  p_service_id    uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_ends timestamptz;
begin
  if p_employee_id is null or p_minutes is null or p_minutes <= 0 then
    return false;
  end if;

  if not public.schedule_permits(p_org_id, p_employee_id, p_starts_at,
                                 p_minutes, p_service_id) then
    return false;
  end if;

  v_ends := p_starts_at + make_interval(mins => p_minutes);

  perform 1
  from public.appointments a
  where a.employee_id = p_employee_id
    and a.org_id      = p_org_id
    and a.deleted_at  is null
    and a.status not in ('cancelled', 'no_show')
    and tstzrange(a.starts_at, a.blocked_until) && tstzrange(p_starts_at, v_ends);

  if found then
    return false;
  end if;

  perform 1
  from public.appointment_holds h
  where h.employee_id = p_employee_id
    and h.released_at is null
    and h.expires_at  > now()
    and not (
      h.session_token is not distinct from p_session_token
      and h.party_index is not distinct from p_party_index
    )
    and tstzrange(h.starts_at, h.blocked_until) && tstzrange(p_starts_at, v_ends);

  return not found;
end;
$fn$;

revoke execute on function public.employee_is_free(
  uuid, uuid, timestamptz, int, text, int, uuid) from public;
