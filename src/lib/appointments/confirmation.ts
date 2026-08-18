import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Looking up a booking someone has already made.
 *
 * The customer has no account, so the visit's id is their reference. It is a uuid — unguessable in any practical sense — and the
 * database function it calls returns nothing that identifies who booked, so a
 * link forwarded into a group chat gives away an appointment and not a person.
 */

/** One service within a visit. */
export type BookedService = {
  serviceName: string;
  employeeName: string;
  startsAt: string;
  endsAt: string;
  price: number;
  status: string;
};

/** A whole visit — everything booked in one sitting. */
export type BookingConfirmation = {
  services: BookedService[];
  /** When the customer arrives. */
  startsAt: string;
  /** When they leave, after the last service. */
  endsAt: string;
  /** Everything they booked, added up. */
  total: number;
  /** Who they are seeing. One stylist does the whole visit. */
  employeeName: string;
  /** Taken from the first service; a visit is cancelled as a whole. */
  status: string;
};

/** Null when the reference is unknown, malformed, or the visit is gone. */
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
    p_visit_id: reference,
  });

  if (error) {
    console.error("get_booking_confirmation failed", error);
    return null;
  }

  const rows = data ?? [];

  if (rows.length === 0) return null;

  // Already ordered by start time in the database, so the first is when they
  // arrive and the last is when they leave.
  const services = rows.map((row) => ({
    serviceName: row.service_name,
    employeeName: row.employee_name,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    price: row.price,
    status: row.status,
  }));

  return {
    services,
    startsAt: services[0].startsAt,
    endsAt: services[services.length - 1].endsAt,
    total: services.reduce((sum, service) => sum + service.price, 0),
    employeeName: services[0].employeeName,
    status: services[0].status,
  };
}
