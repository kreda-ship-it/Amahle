"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Changing what an appointment's status says.
 *
 * Until this file, nothing in the system could move an appointment off
 * `pending` — every booking ever taken sat there, because the status column
 * existed and no screen wrote to it. That is why DECISIONS #12 and #29 could
 * not fire: both defer work until no-shows are "a measured problem", and
 * nothing could record a no-show to measure.
 *
 * NO NEW DATABASE FUNCTION, DELIBERATELY. `appointments_update` from migration
 * 014 already permits an update to anyone holding `appointment.manage`, and
 * the audit trigger already logs it at `critical` tier — including the old and
 * new value, because it is written by trigger rather than by application code.
 * A `security definer` function here would add a second write path to a table
 * that already has a working one, which is the thing this codebase keeps
 * refusing to do.
 *
 * What that leaves out is a STYLIST marking their own appointment done: they
 * hold no appointment permission at all, so the policy refuses them. That case
 * genuinely does need a migration, and it is not smuggled in here.
 */

/** One appointment and what its status should become. */
export type StatusChange = { id: string; status: string };

export type ApplyResult =
  | { ok: true; changed: number }
  | { ok: false; message: string };

/**
 * Apply a batch of status changes.
 *
 * Takes a list of (id, status) pairs rather than a list of ids and one status,
 * so that UNDO is the same operation as marking. Undoing a batch means writing
 * each row's previous value back, and those values differ per row — the same
 * tap can turn a pending and a confirmed appointment into two cancelled ones,
 * and putting them both back to `pending` would be a quiet corruption rather
 * than an undo.
 *
 * Not a transaction, and it does not need to be. Each row is independent, a
 * partial application is a partial application of exactly what was asked, and
 * the caller is told how many landed. This is the opposite of Apply in
 * planning mode, where the moves depend on each other and half a plan is worse
 * than none.
 */
export async function applyStatuses(
  changes: StatusChange[],
): Promise<ApplyResult> {
  await requirePermission("appointment.manage");

  if (changes.length === 0) return { ok: true, changed: 0 };

  const supabase = await createSupabaseServerClient();

  /*
   * One update per distinct status, not one per row. Marking twelve
   * appointments cancelled is a single statement; the batching is by value
   * because that is the only thing the rows have in common.
   */
  const byStatus = new Map<string, string[]>();

  for (const change of changes) {
    const existing = byStatus.get(change.status);
    if (existing) existing.push(change.id);
    else byStatus.set(change.status, [change.id]);
  }

  let changed = 0;

  for (const [status, ids] of byStatus) {
    const { data, error } = await supabase
      .from("appointments")
      .update({ status })
      .in("id", ids)
      .is("deleted_at", null)
      .select("id");

    if (error) {
      console.error("applyStatuses failed", error);

      return {
        ok: false,
        message:
          changed > 0
            ? `Only ${changed} of ${changes.length} could be changed. Reload and try the rest.`
            : "Those could not be changed. Reload and try again.",
      };
    }

    changed += data?.length ?? 0;
  }

  // The day view is force-dynamic, but the router still holds a client-side
  // cache of it; without this, going back to a day just marked shows it
  // unmarked.
  revalidatePath("/staff/day");

  return { ok: true, changed };
}

/**
 * Tidy a row away — a soft delete, never a DELETE.
 *
 * DIFFERENT FROM CANCELLING, and the distinction is the one migration 014
 * wrote down: a cancelled appointment is a fact about the business and stays
 * on the day struck through, while a deleted one is a mistake being removed —
 * a double entry, a booking taken against the wrong customer. Cancelling is a
 * status; this is not.
 *
 * `deleted_at` is set and the row stops appearing. Nothing is ever removed:
 * DELETE is granted to nobody anywhere in this database.
 */
export async function softDeleteAppointment(
  id: string,
): Promise<ApplyResult> {
  await requirePermission("appointment.manage");

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("appointments")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null);

  if (error) {
    console.error("softDeleteAppointment failed", error);
    return { ok: false, message: "That row could not be removed." };
  }

  revalidatePath("/staff/day");

  return { ok: true, changed: 1 };
}

export type MoveResult =
  | { ok: true; shiftedMinutes: number }
  | { ok: false; message: string };

/**
 * Move a whole visit by an interval.
 *
 * Takes a SHIFT rather than a new start time, because the caller is a block on
 * a grid and knows only how far it was dragged. The visit's real start is
 * whatever its earliest row says, and the browser may not be looking at that
 * row — the week view shows one person, so a braid's founding can be on screen
 * while the assistant's finishing is not. Working the new start out from what
 * happens to be rendered would move a visit to the wrong place, and only for
 * the visits that span two people.
 *
 * So the anchor is read here. Anyone who may call this holds
 * `appointment.manage`, and every role that holds it also holds
 * `appointment.view_all` — Owner, Manager and Receptionist — so the earliest
 * row is genuinely visible to the query below rather than merely to the
 * database. If a role is ever created with manage but not view_all, this
 * becomes wrong, which is why the assumption is written down rather than
 * assumed.
 *
 * The move itself is `move_visit()` in Postgres, migration 039. It shifts
 * every row by the same interval so a founding and its finishing stay
 * together, and it defers the double-booking constraint so a chained visit is
 * checked once it is a whole visit again.
 */
export async function moveVisit(
  visitId: string,
  shiftMinutes: number,
): Promise<MoveResult> {
  await requirePermission("appointment.manage");

  if (shiftMinutes === 0) return { ok: true, shiftedMinutes: 0 };

  const supabase = await createSupabaseServerClient();

  const { data: anchor, error: anchorError } = await supabase
    .from("appointments")
    .select("starts_at")
    .eq("visit_id", visitId)
    .is("deleted_at", null)
    .order("starts_at")
    .limit(1)
    .maybeSingle();

  if (anchorError || !anchor) {
    return { ok: false, message: "That visit could not be found. Reload." };
  }

  const startsAt = new Date(
    new Date(anchor.starts_at).getTime() + shiftMinutes * 60_000,
  ).toISOString();

  const { error } = await supabase.rpc("move_visit", {
    p_visit_id: visitId,
    p_starts_at: startsAt,
  });

  if (error) {
    /*
     * A clash is the expected refusal, not a fault — somebody is already in
     * that slot. Because the constraint is deferred inside move_visit(), it
     * surfaces at commit rather than at the statement, but with the same
     * SQLSTATE and the same meaning.
     */
    if (error.code === "23P01") {
      return {
        ok: false,
        message: "Somebody else is already booked then. Nothing was moved.",
      };
    }

    console.error("moveVisit failed", error);

    return {
      ok: false,
      message: error.message || "That could not be moved. Reload and try again.",
    };
  }

  revalidatePath("/staff/day");
  revalidatePath("/staff/week");

  return { ok: true, shiftedMinutes: shiftMinutes };
}
