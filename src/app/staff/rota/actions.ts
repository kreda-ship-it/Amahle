"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Changing who works when.
 *
 * `employee.record.manage` on every call — DECISIONS #24's roster key, the
 * same one that governs adding somebody to the team. Setting a rota is
 * managing the team; migration 013 deliberately did not invent a second key
 * for it.
 *
 * Not the security boundary. Row-level security refuses these independently
 * and would whatever this file did. But a server action is a public HTTP
 * endpoint the moment a client component imports it, so each one states its
 * own requirement rather than inheriting the page's.
 *
 * THE POINT OF THE WHOLE SCREEN: until now a rota change was a SQL statement
 * somebody had to write. The rota is the input to every availability answer in
 * the system — what the booking form offers, what `schedule_permits()` allows,
 * and now what the calendar shades — so a salon that cannot say "Fikir is off
 * next Thursday" without telephoning a developer has not really been handed
 * anything.
 */

export type RotaResult = { ok: true } | { ok: false; message: string };

/** `09:00` and `17:00` as minutes, to compare them honestly. */
function minutes(time: string): number {
  const [hours, mins] = time.split(":").map(Number);

  return (hours ?? 0) * 60 + (mins ?? 0);
}

function check(startTime: string, endTime: string): string | null {
  if (!startTime || !endTime) return "Both times are needed.";

  /*
   * The database has this as a constraint and would refuse it anyway. Saying
   * it here means the answer arrives in the form rather than as a raised
   * exception with a constraint name in it.
   *
   * It also means no overnight shifts, which migration 013 chose on purpose:
   * a salon open past midnight is two rows on two days. Fine for a hair
   * salon, and the thing to revisit if a 24-hour spa ever onboards.
   */
  if (minutes(endTime) <= minutes(startTime)) {
    return "The finish has to be after the start. A shift running past midnight is two shifts, on two days.";
  }

  return null;
}

/** A shift. Several on one day is a split shift, not a mistake. */
export async function addShift(input: {
  employeeId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}): Promise<RotaResult> {
  await requirePermission("employee.record.manage");

  const wrong = check(input.startTime, input.endTime);
  if (wrong) return { ok: false, message: wrong };

  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("employee_working_hours").insert({
    org_id: org.id,
    employee_id: input.employeeId,
    day_of_week: input.dayOfWeek,
    start_time: input.startTime,
    end_time: input.endTime,
  });

  if (error) {
    console.error("addShift failed", error);
    return { ok: false, message: "That shift could not be added." };
  }

  revalidatePath("/staff/rota");
  revalidatePath("/staff/day");
  revalidatePath("/staff/week");

  return { ok: true };
}

export async function updateShift(input: {
  id: string;
  startTime: string;
  endTime: string;
}): Promise<RotaResult> {
  await requirePermission("employee.record.manage");

  const wrong = check(input.startTime, input.endTime);
  if (wrong) return { ok: false, message: wrong };

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("employee_working_hours")
    .update({ start_time: input.startTime, end_time: input.endTime })
    .eq("id", input.id)
    .is("deleted_at", null);

  if (error) {
    console.error("updateShift failed", error);
    return { ok: false, message: "That change could not be saved." };
  }

  revalidatePath("/staff/rota");
  revalidatePath("/staff/day");
  revalidatePath("/staff/week");

  return { ok: true };
}

/**
 * Take a shift off the rota.
 *
 * Soft, like everything else — `deleted_at`, never a DELETE, which is granted
 * to nobody anywhere in this database. A rota that used to say something is
 * worth being able to look back at when somebody asks why a Tuesday in March
 * was booked the way it was.
 */
export async function removeShift(id: string): Promise<RotaResult> {
  await requirePermission("employee.record.manage");

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("employee_working_hours")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    console.error("removeShift failed", error);
    return { ok: false, message: "That shift could not be removed." };
  }

  revalidatePath("/staff/rota");
  revalidatePath("/staff/day");
  revalidatePath("/staff/week");

  return { ok: true };
}
