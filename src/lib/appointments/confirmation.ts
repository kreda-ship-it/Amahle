import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Looking up a booking someone has already made.
 *
 * The customer has no account, so the appointment's own id is their
 * reference. It is a uuid — unguessable in any practical sense — and the
 * database function it calls returns nothing that identifies who booked, so a
 * link forwarded into a group chat gives away an appointment and not a person.
 */

export type BookingConfirmation = {
  serviceName: string;
  employeeName: string;
  startsAt: string;
  endsAt: string;
  price: number;
  status: string;
};

/** Null when the reference is unknown, malformed, or the booking is gone. */
export async function getBookingConfirmation(
  reference: string,
): Promise<BookingConfirmation | null> {
  // Postgres rejects a malformed uuid with an error rather than an empty
  // result, and a customer who mistyped a URL should get "we cannot find
  // that" rather than a failure.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_booking_confirmation", {
    p_appointment_id: reference,
  });

  if (error) {
    console.error("get_booking_confirmation failed", error);
    return null;
  }

  const row = data?.[0];

  if (!row) return null;

  return {
    serviceName: row.service_name,
    employeeName: row.employee_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    price: row.price,
    status: row.status,
  };
}
