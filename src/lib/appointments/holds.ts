import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Holding a slot for a few minutes while somebody finishes booking it.
 *
 * Without this, the time between choosing 10:45 and pressing Confirm is a race
 * that two customers can both be in. The database would refuse the second one
 * and the form would recover gracefully — but the better outcome is that the
 * second customer never sees the slot at all.
 *
 * Nothing here decides anything. `hold_slot()` in Postgres validates the
 * services, checks nothing is already booked, releases the session's previous
 * choice, and relies on an exclusion constraint for the case where two people
 * click at the same instant.
 */

export type Hold = {
  employeeId: string;
  startsAt: string;
  /** ISO instant when the hold lapses. */
  expiresAt: string;
};

export type HoldResult =
  | { ok: true; expiresAt: string }
  | { ok: false; message: string };

/** Postgres's exclusion violation — someone else got the slot first. */
const EXCLUSION_VIOLATION = "23P01";

export async function holdSlot(input: {
  orgId: string;
  serviceIds: string[];
  employeeId: string;
  startsAt: string;
  sessionToken: string;
}): Promise<HoldResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("hold_slot", {
    p_org_id: input.orgId,
    p_service_ids: input.serviceIds,
    p_employee_id: input.employeeId,
    p_starts_at: input.startsAt,
    p_session_token: input.sessionToken,
  });

  if (error) {
    // Losing the race and being told the slot is booked are the same thing
    // from the customer's side, and both mean "pick another".
    if (error.code === EXCLUSION_VIOLATION) {
      return {
        ok: false,
        message:
          "Someone else is booking that time right now. Please choose another.",
      };
    }

    if (error.code === "P0001") {
      return { ok: false, message: error.message };
    }

    console.error("hold_slot failed", error);

    return {
      ok: false,
      message: "We could not hold that time. Please try another.",
    };
  }

  return { ok: true, expiresAt: data };
}

/** The session's live hold, or null if it never had one or it has lapsed. */
export async function getHold(sessionToken: string): Promise<Hold | null> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_hold", {
    p_session_token: sessionToken,
  });

  if (error) {
    console.error("get_hold failed", error);
    return null;
  }

  const row = data?.[0];

  if (!row) return null;

  return {
    employeeId: row.employee_id,
    startsAt: row.starts_at,
    expiresAt: row.expires_at,
  };
}
