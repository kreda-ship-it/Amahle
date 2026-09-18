-- ============================================================
-- 015 — create_appointment(), the one canonical creation path
--
-- PROJECT.md: "createAppointment() exists once. Website form, staff
-- form, and any future import all call it. Duplicate records come from
-- having a second way to make a thing."
--
-- WHY THIS IS SQL AND NOT TYPESCRIPT
--
-- Not preference. A customer booking online is not logged in — they
-- arrive as `anon`, and migrations 012 and 014 grant `anon` nothing at
-- all on customers and appointments. Application code holding the anon
-- key therefore CANNOT insert their booking, and granting it the
-- privilege would undo the protection those migrations exist for.
--
-- A `security definer` function is the way through: it runs with the
-- rights of the role that created it rather than the caller's, so the
-- checks written below are the only way a row gets in. The staff path
-- could have been TypeScript; the public path could not, and one path
-- for both is the whole point.
--
-- WHAT THIS FUNCTION DOES NOT DO
--
-- It does not check working hours or time off. A booking at 3am on a
-- day the salon is shut will be accepted. That is the availability
-- calculation, the next item in Phase 4 — and until it exists, the
-- booking form must only offer times that are genuinely free.
--
-- It DOES refuse a double-booking, but not by checking: the exclusion
-- constraint from migration 014 raises 23P01 and this function lets it
-- through to the caller untouched.
-- ============================================================


-- ------------------------------------------------------------
-- 1. normalize_phone() — one spelling of a phone number.
--
-- migration 012 gave customers.phone_digits, which strips punctuation,
-- so "+1 (202) 555-0143" and "+12025550143" already match. What it
-- deliberately could not do is add a MISSING country code, because
-- teaching the database that ten digits means American would hardcode
-- one country into a multi-tenant schema.
--
-- This is where that gets fixed, from the salon's own setting, in one
-- function every write path goes through.
--
--   "+1 (202) 555-0143"  ->  +12025550143   already international
--   "001 202 555 0143"   ->  +12025550143   00 is the other way to write +
--   "(202) 555-0143"     ->  +12025550143   local, dial code added
--   "(202) 555-0143"     ->  2025550143     local, no dial code configured
--
-- The last line is the honest failure mode: with no country_dial_code
-- set on the organization, local numbers are stored as bare digits.
-- They still match each other consistently. They just will not match
-- the same number written internationally.
-- ------------------------------------------------------------
create or replace function public.normalize_phone(
  p_phone      text,
  p_dial_code  text default null
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
  v_code   text;
begin
  if p_phone is null then
    return null;
  end if;

  -- Everything that is not a digit: spaces, brackets, dashes, dots.
  v_digits := regexp_replace(p_phone, '[^0-9]', '', 'g');

  if v_digits = '' then
    return null;
  end if;

  -- Written internationally already. Trust it.
  if left(btrim(p_phone), 1) = '+' then
    return '+' || v_digits;
  end if;

  -- 00 is how much of the world writes +.
  if left(v_digits, 2) = '00' then
    return '+' || substring(v_digits from 3);
  end if;

  -- A local number. Add the salon's country code, if it has one set.
  v_code := nullif(btrim(coalesce(p_dial_code, '')), '');

  if v_code is null then
    return v_digits;
  end if;

  if left(v_code, 1) <> '+' then
    v_code := '+' || v_code;
  end if;

  return v_code || v_digits;
end;
$$;

comment on function public.normalize_phone(text, text) is
  'One spelling of a phone number, using the organization''s country_dial_code for local numbers. The only place that rule lives.';

revoke execute on function public.normalize_phone(text, text) from public;
grant  execute on function public.normalize_phone(text, text) to anon, authenticated;


-- ------------------------------------------------------------
-- 2. find_or_create_customer().
--
-- DECISIONS #8: customers have no accounts. They give a name and a
-- phone number, and we create or match a record from that. The phone
-- number is the identity.
--
-- FILLS BLANKS, NEVER OVERWRITES. A returning customer typing their
-- name slightly differently — "Sara" where the salon wrote "Sara T." —
-- must not rewrite the record. The salon's version is the curated one.
-- An email is added only if the record has none.
--
-- security definer because the public booking form runs as anon, which
-- has no privilege on customers whatsoever.
-- ------------------------------------------------------------
create or replace function public.find_or_create_customer(
  p_org_id     uuid,
  p_phone      text,
  p_full_name  text,
  p_email      text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dial_code   text;
  v_phone       text;
  v_digits      text;
  v_email       text;
  v_customer_id uuid;
begin
  if nullif(btrim(coalesce(p_full_name, '')), '') is null then
    raise exception 'A name is needed to make a booking.';
  end if;

  select nullif(btrim(coalesce(o.public_settings ->> 'country_dial_code', '')), '')
  into v_dial_code
  from public.organizations o
  where o.id = p_org_id
    and o.deleted_at is null;

  if not found then
    raise exception 'That salon does not exist.';
  end if;

  v_phone := public.normalize_phone(p_phone, v_dial_code);

  if v_phone is null then
    raise exception 'A phone number is needed to make a booking.';
  end if;

  v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
  v_email  := nullif(btrim(coalesce(p_email, '')), '');

  select c.id
  into v_customer_id
  from public.customers c
  where c.org_id       = p_org_id
    and c.phone_digits = v_digits
    and c.deleted_at   is null
  limit 1;

  if v_customer_id is not null then
    -- Only ever fills a gap.
    if v_email is not null then
      update public.customers
      set email = v_email
      where id = v_customer_id
        and email is null;
    end if;

    return v_customer_id;
  end if;

  -- Two people booking the same new number in the same instant: one
  -- insert wins, the other trips customers_org_phone_key and lands
  -- here, where the winner's row is now waiting to be found.
  begin
    insert into public.customers (org_id, full_name, phone, email)
    values (p_org_id, btrim(p_full_name), v_phone, v_email)
    returning id into v_customer_id;
  exception
    when unique_violation then
      select c.id
      into v_customer_id
      from public.customers c
      where c.org_id       = p_org_id
        and c.phone_digits = v_digits
        and c.deleted_at   is null
      limit 1;
  end;

  return v_customer_id;
end;
$$;

comment on function public.find_or_create_customer(uuid, text, text, text) is
  'Match a customer by phone number or create one. Fills blanks, never overwrites — the salon''s version of a name is the curated one.';

revoke execute on function public.find_or_create_customer(uuid, text, text, text)
  from public, anon;

-- anon never calls this directly. create_appointment() calls it, and a
-- security definer function calls with its OWNER's rights, not the
-- caller's — so the public booking path works without anon ever being
-- able to create customers on its own.
grant execute on function public.find_or_create_customer(uuid, text, text, text)
  to authenticated;


-- ------------------------------------------------------------
-- 3. create_appointment().
--
-- SOURCE IS DERIVED, NOT ACCEPTED. There is no p_source parameter: if
-- the caller is a logged-in member of staff it is 'staff', otherwise
-- 'online'. PROJECT.md calls that field the real measure of whether
-- this project worked, and a parameter is a way for it to be wrong.
--
-- The same applies to price and the end time — they are not parameters
-- either. The trigger from migration 014 computes them from the
-- service, so a caller cannot quote itself a different price.
-- ------------------------------------------------------------
create or replace function public.create_appointment(
  p_org_id          uuid,
  p_service_id      uuid,
  p_employee_id     uuid,
  p_starts_at       timestamptz,
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_email  text default null,
  p_notes           text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor           uuid := public.current_profile_id();
  v_source          text;
  v_bookable_online boolean;
  v_customer_id     uuid;
  v_appointment_id  uuid;
begin
  v_source := case when v_actor is null then 'online' else 'staff' end;

  -- A logged-in member of staff books into their own salon and no
  -- other. An anonymous visitor has no salon of their own, so this
  -- does not apply to them — the org comes from the website they are
  -- standing on, and every other check below is scoped to it.
  if v_actor is not null and p_org_id is distinct from public.current_org_id() then
    raise exception 'You cannot book into another salon.';
  end if;

  if p_starts_at is null then
    raise exception 'A start time is needed to make a booking.';
  end if;

  select s.is_bookable_online
  into v_bookable_online
  from public.services s
  where s.id         = p_service_id
    and s.org_id     = p_org_id
    and s.deleted_at is null
    and s.is_active;

  if not found then
    raise exception 'That service is not available.';
  end if;

  -- DECISIONS #23: is_bookable_online controls the Book button, not
  -- visibility. Enforced here as well, because a hidden button is not
  -- a rule.
  if v_source = 'online' and not v_bookable_online then
    raise exception 'That service cannot be booked online. Please call the salon.';
  end if;

  perform 1
  from public.employees e
  where e.id         = p_employee_id
    and e.org_id     = p_org_id
    and e.deleted_at is null
    and e.is_active
    and e.is_bookable;

  if not found then
    raise exception 'That member of staff cannot be booked.';
  end if;

  perform 1
  from public.employee_services es
  where es.employee_id = p_employee_id
    and es.service_id  = p_service_id
    and es.org_id      = p_org_id
    and es.deleted_at  is null;

  if not found then
    raise exception 'That member of staff does not perform that service.';
  end if;

  -- Staff may record a booking that already happened; the receptionist
  -- writing up yesterday's walk-in is a real thing. A customer booking
  -- themselves may not.
  if v_source = 'online' and p_starts_at <= now() then
    raise exception 'That time has already passed.';
  end if;

  v_customer_id := public.find_or_create_customer(
    p_org_id, p_customer_phone, p_customer_name, p_customer_email);

  -- ends_at, blocked_until and price are deliberately absent. The
  -- trigger fills them from the service.
  --
  -- If this slot is taken, the exclusion constraint raises 23P01 here
  -- and it is NOT caught: the caller needs to tell those two failures
  -- apart, and in a race the slot genuinely was taken a moment ago.
  insert into public.appointments
    (org_id, customer_id, employee_id, service_id, starts_at,
     source, notes, created_by)
  values
    (p_org_id, v_customer_id, p_employee_id, p_service_id, p_starts_at,
     v_source, nullif(btrim(coalesce(p_notes, '')), ''), v_actor)
  returning id into v_appointment_id;

  return v_appointment_id;
end;
$$;

comment on function public.create_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text) is
  'The only way an appointment is created. Website form and staff form both call this. source is derived from who is calling, never passed in.';

revoke execute on function public.create_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text)
  from public;

grant execute on function public.create_appointment(uuid, uuid, uuid, timestamptz, text, text, text, text)
  to anon, authenticated;
