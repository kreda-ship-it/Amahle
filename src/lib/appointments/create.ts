import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Making an appointment.
 *
 * This is the only function in the application that creates one. The public
 * booking form and the staff manual-entry form both call it, which is the
 * requirement PROJECT.md is built around: one calendar, two entry paths. A
 * second way to make an appointment is how a calendar starts disagreeing with
 * reality, and a calendar staff do not trust is a calendar they stop using.
 *
 * Note how little happens here. The rules — who may be booked, whether the
 * service can be booked online, what it costs, how long it takes, and whether
 * the slot is free — all live in `create_appointment()` in Postgres, added by
 * migration 015.
 *
 * That is not an accident of taste. A customer booking online is not logged
 * in: they reach the database as `anon`, which has no privilege at all on
 * `customers` or `appointments`. Code holding the anon key cannot write their
 * booking, and giving it that privilege would undo the protection migrations
 * 012 and 014 exist for. A `security definer` function is the way through, and
 * once the public path needs one, the staff path uses the same one or there
 * are two paths again.
 *
 * So this file's job is the part TypeScript is genuinely better at: turning a
 * database error into something a form can say to a person.
 */

export type CreateAppointmentInput = {
  /** Which salon. Public pages get this from `getOrganization()`. */
  organizationId: string;

  /**
   * The services, in the order they will be performed. One is the common
   * case; several is "blow dry and trim for her", done back to back by the
   * same stylist with no gap between them.
   */
  serviceIds: string[];

  employeeId: string;

  /** When the customer sits down. The end time is computed from the service. */
  startsAt: Date | string;

  customerName: string;
  customerPhone: string;
  customerEmail?: string | null;

  /** Anything the customer or the receptionist wants recorded. */
  notes?: string | null;

  /**
   * The booking session. Their own hold is honoured rather than blocking
   * them, and it is released once the appointment exists.
   */
  sessionToken?: string | null;

  /** Which person in the party. 0, and omitted, is an ordinary booking. */
  partyIndex?: number;

  /** Join an existing visit, so a party shares one booking reference. */
  visitId?: string | null;

  /** Who this is for, when it is not the person booking. */
  forName?: string | null;
};

/**
 * Why a booking failed, in the terms a caller has to act on.
 *
 * `slot_taken` is separated from every other refusal because it is the only
 * one where the customer did nothing wrong and should simply pick again. The
 * form can re-fetch the free times and apologise; everything else needs the
 * message shown.
 */
export type CreateAppointmentFailure =
  | "slot_taken"
  | "rejected"
  | "unknown";

export type CreateAppointmentResult =
  | { ok: true; visitId: string }
  | { ok: false; reason: CreateAppointmentFailure; message: string };

/**
 * Postgres raises `exclusion_violation` when the constraint from migration 014
 * refuses a second appointment overlapping the same employee's time.
 */
const EXCLUSION_VIOLATION = "23P01";

/**
 * Postgres's code for a plain `raise exception`, which is what every
 * deliberate refusal inside `create_appointment()` is. Those messages are
 * written to be read by a customer — "That time has already passed." — so they
 * are passed through rather than replaced.
 */
const RAISED_EXCEPTION = "P0001";

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Create a visit — one appointment row per service — or explain why not.
 *
 * Returns the VISIT id rather than an appointment id. That is the customer's
 * booking reference, and it is the same shape whether they booked one service
 * or three.
 *
 * Never throws for an ordinary refusal — a taken slot and a past date are
 * expected outcomes of a booking form, not exceptional ones, and a form needs
 * to render them rather than crash on them.
 *
 * Runs on the server only. It is called from a server action, so the customer's
 * browser never talks to the database directly.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("create_appointment", {
    p_org_id: input.organizationId,
    p_service_ids: input.serviceIds,
    p_employee_id: input.employeeId,
    p_starts_at: toIso(input.startsAt),
    p_customer_name: input.customerName,
    p_customer_phone: input.customerPhone,
    p_customer_email: input.customerEmail ?? undefined,
    p_notes: input.notes ?? undefined,
    p_session_token: input.sessionToken ?? undefined,
    p_party_index: input.partyIndex ?? undefined,
    p_visit_id: input.visitId ?? undefined,
    p_for_name: input.forName ?? undefined,
  });

  if (error) {
    if (error.code === EXCLUSION_VIOLATION) {
      return {
        ok: false,
        reason: "slot_taken",
        message:
          "Sorry — that time was just booked by someone else. Please choose another.",
      };
    }

    if (error.code === RAISED_EXCEPTION) {
      return { ok: false, reason: "rejected", message: error.message };
    }

    /*
     * Anything else is a fault rather than a refusal: a dropped connection, a
     * constraint nobody anticipated, a permission that moved. The customer
     * gets a sentence they can act on; the detail goes to the server log,
     * where it is useful and where it is not the customer's problem.
     */
    console.error("create_appointment failed", error);

    return {
      ok: false,
      reason: "unknown",
      message:
        "Something went wrong making that booking. Please try again, or call the salon.",
    };
  }

  return { ok: true, visitId: data };
}
