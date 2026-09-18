import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The booking engine, reached from TypeScript.
 *
 * Migrations 027 to 038 built a scheduler that understands the salon: a
 * service is a tree of questions whose answers change the price and the time,
 * a visit can need two people, and a braid is founded by a stylist and
 * finished by an assistant. Until this file, nothing in the application could
 * call any of it — the public form still asks `get_available_slots()`, which
 * knows none of it.
 *
 * As everywhere else, the arithmetic is Postgres's. The running total on
 * screen and the price written to the appointment come from the same function,
 * `visit_lines()`, so they cannot drift; and a duration computed in a browser
 * is a duration anyone with dev tools can edit.
 */

/** One service and the answers chosen for it. The shape every function takes. */
export type VisitSelection = {
  serviceId: string;
  optionIds: string[];
};

/**
 * One row that would be written if this slot were booked — which service,
 * which person, founding or finishing, and for how long.
 *
 * A visit is legitimately several rows across several people: the stylist
 * founds the braid, an assistant works the length down. The form shows this so
 * the receptionist can tell the customer who they will be with.
 */
export type SlotAssignment = {
  service_id: string;
  employee_id: string;
  phase: string;
  starts_at: string;
  minutes: number;
};

export type VisitSlot = {
  /** ISO instant. Format with the salon's timezone before showing anyone. */
  startsAt: string;
  /** Who leads it — the person the customer would name. */
  employeeId: string;
  assignment: SlotAssignment[];
};

export type VisitTotals = {
  price: number;
  minutes: number;
};

/** The wire format `visit_lines()` and friends expect. */
function toSelectionJson(selection: VisitSelection[]): Json {
  return selection.map((entry) => ({
    service_id: entry.serviceId,
    option_ids: entry.optionIds,
  })) as Json;
}

/**
 * What this visit costs and how long it takes, given the answers so far.
 *
 * Called on every change while somebody is choosing, which is why it is a
 * `stable` SQL function and not a walk of the calendar.
 */
export async function getVisitTotals(
  orgId: string,
  selection: VisitSelection[],
): Promise<VisitTotals> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("visit_totals", {
    p_org_id: orgId,
    p_selection: toSelectionJson(selection),
  });

  if (error) {
    console.error("visit_totals failed", error);
    return { price: 0, minutes: 0 };
  }

  const row = data?.[0];

  return {
    price: row?.total_price ?? 0,
    minutes: row?.total_minutes ?? 0,
  };
}

/**
 * When a whole visit can start, and every row that would be written.
 *
 * **Ask for the window being shown — a day, or a few.** This walks days by
 * steps by phases and is not a set-based query; asking it for a month is a
 * request to check several thousand possibilities one at a time.
 *
 * `employeeId` optional means "anyone who can lead it", and every slot still
 * says which stylist it belongs to.
 *
 * Note what this is to a member of staff: **a suggestion, not a rule.** Staff
 * bookings bypass the lead's availability inside `create_appointment()`, so a
 * receptionist may book a time this function never offered. What they cannot
 * bypass is the finishing chain, which needs a real assistant to be genuinely
 * free — see the note in `book/actions.ts`.
 */
export async function getVisitSlots(input: {
  orgId: string;
  serviceIds: string[];
  fromDate: string;
  toDate?: string;
  employeeId?: string | null;
  selection?: VisitSelection[];
  limit?: number;
}): Promise<VisitSlot[]> {
  if (input.serviceIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_visit_slots", {
    p_org_id: input.orgId,
    p_service_ids: input.serviceIds,
    p_from_date: input.fromDate,
    p_to_date: input.toDate ?? undefined,
    p_employee_id: input.employeeId ?? undefined,
    p_selection: input.selection ? toSelectionJson(input.selection) : undefined,
    p_limit: input.limit ?? undefined,
  });

  if (error) {
    /*
     * An empty list renders as "no times", which is both true and the right
     * thing to show somebody holding a telephone. The detail goes to the
     * server log, where it is useful and where it is not their problem.
     */
    console.error("get_visit_slots failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    startsAt: row.slot_starts_at,
    employeeId: row.slot_employee_id,
    assignment: (row.slot_assignment ?? []) as unknown as SlotAssignment[],
  }));
}
