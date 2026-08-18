import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Reading what a customer may book.
 *
 * Three things the booking form needs: which services can be booked online,
 * who performs a given one, and when they are free. All server-side — none of
 * these run in a browser.
 *
 * The free times come from `get_available_slots()` in Postgres, not from
 * arithmetic here. That is not a style preference: `anon` has no privilege on
 * `employee_working_hours`, `employee_time_off` or `appointments`, so a
 * browser could not do this calculation even if we wanted it to. It receives
 * free times and nothing else — never the rota, never who is booked.
 */

export type BookableService = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number;
  price_display: string;
  duration_minutes: number;
};

export type ServiceEmployee = {
  id: string;
  full_name: string;
};

export type Slot = {
  /** ISO instant. Format it with the salon's timezone before showing anyone. */
  startsAt: string;
  employeeId: string;
};

/**
 * Services a customer may book without phoning.
 *
 * DECISIONS #23: `is_bookable_online` governs the Book button, not visibility.
 * The price list shows everything; this list is deliberately shorter, and the
 * services missing from it are the long braiding appointments the salon wants
 * to discuss first.
 */
export async function getBookableServices(
  orgId: string,
): Promise<BookableService[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("services")
    .select(
      "id, name, description, category, price, price_display, duration_minutes",
    )
    .eq("org_id", orgId)
    .eq("is_bookable_online", true)
    .order("display_order");

  return data ?? [];
}

/** One service, or null if it is not bookable online or does not exist. */
export async function getBookableService(
  orgId: string,
  serviceId: string,
): Promise<BookableService | null> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("services")
    .select(
      "id, name, description, category, price, price_display, duration_minutes",
    )
    .eq("org_id", orgId)
    .eq("id", serviceId)
    .eq("is_bookable_online", true)
    .maybeSingle();

  return data ?? null;
}

/**
 * Who performs this service, for the "choose a stylist" step.
 *
 * Reads through `employee_services`, so it lists exactly the people the salon
 * has said can do this work. `phone` and `email` are absent and cannot be
 * added — migration 008 never granted them to `anon`.
 */
export async function getEmployeesForService(
  orgId: string,
  serviceId: string,
): Promise<ServiceEmployee[]> {
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("employee_services")
    .select("employees!inner(id, full_name, is_bookable, display_order)")
    .eq("org_id", orgId)
    .eq("service_id", serviceId);

  const employees = (data ?? [])
    .map((row) => row.employees)
    .filter((employee) => employee !== null && employee.is_bookable)
    .sort((a, b) => a.display_order - b.display_order);

  return employees.map((employee) => ({
    id: employee.id,
    full_name: employee.full_name,
  }));
}

/**
 * Free times, for one service, across a range of days.
 *
 * Asked for the whole range in one call rather than one call per day. That is
 * partly fewer round trips and mostly correctness: the day chooser needs to
 * know which days have anything at all before you pick one, and asking
 * fourteen times would give fourteen slightly different moments of truth.
 *
 * `employeeId` is optional. Leaving it out means "anyone who does this", and
 * every slot still says which stylist it belongs to — that is what lets the
 * form offer someone else at the same time when their first choice is taken.
 */
export async function getAvailableSlots(input: {
  orgId: string;
  serviceId: string;
  fromDate: string;
  toDate?: string;
  employeeId?: string | null;
}): Promise<Slot[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_available_slots", {
    p_org_id: input.orgId,
    p_service_id: input.serviceId,
    p_from_date: input.fromDate,
    p_to_date: input.toDate ?? undefined,
    p_employee_id: input.employeeId ?? undefined,
  });

  if (error) {
    /*
     * A refusal here — an inactive service, one that cannot be booked online —
     * means the customer followed a stale link. An empty list renders as "no
     * times available", which is both true and the right thing to show; the
     * detail belongs in the server log, not on a page someone is trying to
     * book from.
     */
    console.error("get_available_slots failed", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    startsAt: row.slot_starts_at,
    employeeId: row.slot_employee_id,
  }));
}
