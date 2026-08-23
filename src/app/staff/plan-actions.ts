"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Working on a plan.
 *
 * A plan is a scratch layer over the calendar: proposed moves that change
 * nothing until they are applied. Everything here writes to
 * `schedule_plan_moves`, never to `appointments` — the single exception being
 * `applyPlan`, which is the moment the two meet.
 *
 * A PLAN RESERVES NOTHING. Two people can plan the same gap and both be told
 * it is fine; the second Apply is the one refused. The alternative is holds,
 * and half-finished strangers on the calendar is how staff stop trusting it.
 */

export type PlanResult =
  | { ok: true; id?: string; moved?: number }
  | { ok: false; message: string };

/** Start a plan for a day. The name is what the tab says. */
export async function createPlan(
  name: string,
  planDate: string,
  profileId: string,
  orgId: string,
): Promise<PlanResult> {
  await requirePermission("appointment.manage");

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("schedule_plans")
    .insert({
      org_id: orgId,
      name: name.trim() || planDate,
      plan_date: planDate,
      created_by: profileId,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("createPlan failed", error);
    return { ok: false, message: "That plan could not be started." };
  }

  revalidatePath("/staff/plan");

  return { ok: true, id: data.id };
}

/**
 * Record where a visit should end up.
 *
 * Upsert on (plan, visit), because dragging the same visit twice is a
 * correction rather than a second instruction — the unique index in migration
 * 040 says the same thing at the other end.
 *
 * The target is absolute rather than an interval. An interval could not
 * express "already done" when somebody has moved the visit by hand since; it
 * would simply apply again.
 */
export async function setPlannedMove(input: {
  planId: string;
  /** One appointment. Moving a whole visit sends one of these per row. */
  appointmentId: string;
  targetStartsAt: string;
  /** Null leaves the person alone; set by dragging into another column. */
  targetEmployeeId?: string | null;
  /** Null leaves the length alone; set by pulling the bottom edge. */
  targetMinutes?: number | null;
  orgId: string;
}): Promise<PlanResult> {
  await requirePermission("appointment.manage");

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("schedule_plan_moves").upsert(
    {
      org_id: input.orgId,
      plan_id: input.planId,
      appointment_id: input.appointmentId,
      target_starts_at: input.targetStartsAt,
      target_employee_id: input.targetEmployeeId ?? null,
      target_minutes: input.targetMinutes ?? null,
    },
    { onConflict: "plan_id,appointment_id" },
  );

  if (error) {
    console.error("setPlannedMove failed", error);
    return { ok: false, message: "That move could not be added to the plan." };
  }

  revalidatePath("/staff/plan");

  return { ok: true };
}

/** Take one move back out of the plan. Soft, like everything else here. */
export async function dropPlannedMove(
  planId: string,
  appointmentId: string,
): Promise<PlanResult> {
  await requirePermission("appointment.manage");

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("schedule_plan_moves")
    .update({ deleted_at: new Date().toISOString() })
    .eq("plan_id", planId)
    .eq("appointment_id", appointmentId)
    .is("deleted_at", null);

  if (error) {
    console.error("dropPlannedMove failed", error);
    return { ok: false, message: "That move could not be removed." };
  }

  revalidatePath("/staff/plan");

  return { ok: true };
}

/**
 * Apply the plan — all of it, or none of it.
 *
 * The transaction is `apply_plan()` in Postgres, migration 040. It has to be
 * there rather than here: a plan built at ten and applied at twenty past may
 * be stale, and a half-applied plan leaves a day that is neither its old shape
 * nor its new one with nobody knowing which. Several statements from
 * application code cannot promise that; one function can.
 */
export async function applyPlan(planId: string): Promise<PlanResult> {
  await requirePermission("appointment.manage");

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("apply_plan", {
    p_plan_id: planId,
  });

  if (error) {
    // Every refusal inside apply_plan() is a deliberate `raise exception`
    // written to be read by the person at the desk — "Somebody is already
    // booked at 14:30. Nothing was applied." — so it is passed through.
    return {
      ok: false,
      message: error.message || "The plan could not be applied.",
    };
  }

  revalidatePath("/staff/plan");
  revalidatePath("/staff/day");
  revalidatePath("/staff/week");

  return { ok: true, moved: data ?? 0 };
}

/** Throw the plan away. Soft-deleted, so it can be recovered by hand. */
export async function discardPlan(planId: string): Promise<PlanResult> {
  await requirePermission("appointment.manage");

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("schedule_plans")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", planId)
    .is("deleted_at", null);

  if (error) {
    console.error("discardPlan failed", error);
    return { ok: false, message: "That plan could not be discarded." };
  }

  revalidatePath("/staff/plan");

  return { ok: true };
}
