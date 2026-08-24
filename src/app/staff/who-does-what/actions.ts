"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Editing the matrix.
 *
 * `employee_services` has decided who can be booked for what since migration
 * 014, and until now nothing in the application could write to it — the pairs
 * came from `apply-stylist-matrix.sql`, run by hand. The screen next door has
 * been printing "these styles have nobody to lead them, nothing can be booked
 * against them" without offering any way to say who does.
 *
 * A plain table write rather than a function, the same call as `saveService()`
 * and for the same reason: the rule is about a role, not a row. "May you
 * manage the roster, yes or no" is exactly what `employee_services_insert`
 * and `employee_services_update` already say, and the column grants already
 * name the three fields a caller may set. A function would be ceremony around
 * a policy that is already correct.
 *
 * THE PERMISSION IS employee.record.manage, NOT service.manage. This looks
 * like a services screen and it is not one. Nothing here changes what a style
 * costs or how long it takes; it changes who on the roster is allowed to
 * perform it, which is the same question as who works here and what they do.
 * Migration 014 made that call and this follows it.
 *
 * WHAT ELSE MOVES WHEN THIS DOES, because it is not obvious and it is real:
 * `getDayColumns()` derives the calendar's columns from who holds a `lead`
 * row. Giving an assistant her first lead service gives her a column on the
 * day grid. That is arguably correct — she can now be booked directly — but
 * it is a consequence worth knowing before pressing the box.
 */

export type MatrixResult = { ok: true } | { ok: false; message: string };

/** `lead` performs a style from the start; `assist` finishes one. */
export type MatrixRole = "lead" | "assist";

/**
 * Say that this person performs this service.
 *
 * Insert rather than revive, deliberately. A pair that was removed leaves a
 * soft-deleted row behind, and `employee_services_pair_key` is partial —
 * `where deleted_at is null` — so a fresh row is free to exist beside it.
 * Reviving the old one would be tidier by one row and would erase the fact
 * that somebody once took this away, which is the whole point of soft-delete.
 *
 * It also could not be done: `employee_services_select_member` filters
 * `deleted_at is null`, so a signed-in caller cannot read a dead row to
 * revive it in the first place.
 */
export async function setWhoDoes(
  serviceId: string,
  employeeId: string,
  role: MatrixRole,
): Promise<MatrixResult> {
  const profile = await requirePermission("employee.record.manage");

  const supabase = await createSupabaseServerClient();

  /* Already true is not an error. Two people ticking the same box a second
     apart should both be told yes, rather than one meeting a unique
     violation from an index they have never heard of. */
  const { data: existing } = await supabase
    .from("employee_services")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("service_id", serviceId)
    .eq("role", role)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing) return done();

  const { error } = await supabase.from("employee_services").insert({
    org_id: profile.org_id,
    employee_id: employeeId,
    service_id: serviceId,
    role,
  });

  if (error) {
    console.error("setWhoDoes failed", error);

    /* The race the check above cannot close: both callers read nothing, both
       insert, the index refuses the second. The answer they wanted is still
       true, so say so rather than reporting a failure that isn't one. */
    if (error.code === "23505") return done();

    return { ok: false, message: error.message || "That could not be saved." };
  }

  return done();
}

/** Say that this person no longer performs it. Soft, as everywhere. */
export async function clearWhoDoes(
  serviceId: string,
  employeeId: string,
  role: MatrixRole,
): Promise<MatrixResult> {
  await requirePermission("employee.record.manage");

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("employee_services")
    .update({ deleted_at: new Date().toISOString() })
    .eq("employee_id", employeeId)
    .eq("service_id", serviceId)
    .eq("role", role)
    .is("deleted_at", null);

  if (error) {
    console.error("clearWhoDoes failed", error);

    return { ok: false, message: error.message || "That could not be saved." };
  }

  return done();
}

/**
 * Everything that reads the matrix, invalidated together.
 *
 * A longer list than it looks, because this table is read far from here.
 * `get_visit_slots()` will not offer a time for a service its lead does not
 * perform, `create_appointment()` refuses the booking outright, the staff
 * entry form builds its stylist dropdown from it, the public team page names
 * each person's specialities from it, and `getDayColumns()` decides who gets
 * a column on the calendar from it. Ticking one box moves all five.
 */
function done(): MatrixResult {
  revalidatePath("/staff/who-does-what");
  revalidatePath("/staff/book");
  revalidatePath("/staff/day");
  revalidatePath("/staff/week");
  revalidatePath("/book");
  revalidatePath("/team");

  return { ok: true };
}
