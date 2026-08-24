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
  /** The heading it hangs from. Resolve names through /lib/services/categories. */
  category_id: string | null;
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
      "id, name, description, category_id, price, price_display, duration_minutes",
    )
    .eq("org_id", orgId)
    .eq("is_bookable_online", true)
    .order("display_order");

  return data ?? [];
}

/**
 * The chosen services, in the order the customer chose them.
 *
 * Order is preserved deliberately: a visit is performed in the order it was
 * built, and the database schedules the rows the same way. Returns fewer than
 * asked for if any id is unknown, which the caller treats as a stale link.
 */
export async function getBookableServices_byIds(
  orgId: string,
  serviceIds: string[],
): Promise<BookableService[]> {
  if (serviceIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("services")
    .select(
      "id, name, description, category_id, price, price_display, duration_minutes",
    )
    .eq("org_id", orgId)
    .eq("is_bookable_online", true)
    .in("id", serviceIds);

  const found = new Map((data ?? []).map((service) => [service.id, service]));

  // Keep the customer's order, and keep duplicates — booking the same service
  // twice is unusual but not wrong, and the database counts it twice.
  return serviceIds.flatMap((id) => {
    const service = found.get(id);
    return service ? [service] : [];
  });
}

/**
 * Who can perform ALL of these services, for the "choose a stylist" step.
 *
 * All, not any: a visit is one person from start to finish, so a stylist who
 * does the blow dry but not the trim cannot take the booking. This mirrors the
 * `having count(distinct …)` in `get_available_slots`, and the two must agree
 * — offering a stylist the availability function will not is how a form ends
 * up showing a person with no times.
 *
 * `phone` and `email` are absent and cannot be added: migration 008 never
 * granted them to `anon`.
 */
export async function getEmployeesForServices(
  orgId: string,
  serviceIds: string[],
): Promise<ServiceEmployee[]> {
  if (serviceIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();
  const wanted = new Set(serviceIds);

  const { data } = await supabase
    .from("employee_services")
    .select(
      "service_id, employees!inner(id, full_name, is_bookable, display_order)",
    )
    .eq("org_id", orgId)
    .in("service_id", [...wanted]);

  const covers = new Map<string, { employee: ServiceEmployee & { order: number }; services: Set<string> }>();

  for (const row of data ?? []) {
    const employee = row.employees;
    if (!employee || !employee.is_bookable) continue;

    const existing = covers.get(employee.id);

    if (existing) {
      existing.services.add(row.service_id);
    } else {
      covers.set(employee.id, {
        employee: {
          id: employee.id,
          full_name: employee.full_name,
          order: employee.display_order,
        },
        services: new Set([row.service_id]),
      });
    }
  }

  return [...covers.values()]
    .filter((entry) => entry.services.size === wanted.size)
    .sort((a, b) => a.employee.order - b.employee.order)
    .map(({ employee }) => ({ id: employee.id, full_name: employee.full_name }));
}

/**
 * Free times, for one service, across a range of days.
 *
 * Asked for the whole range in one call rather than one call per day. That is
 * partly fewer round trips and mostly correctness: the day chooser needs to
 * know which days have anything at all before you pick one, and asking
 * fourteen times would give fourteen slightly different moments of truth.
 *
 * `employeeId` is optional. Leaving it out means "anyone who does all of it", and
 * every slot still says which stylist it belongs to — that is what lets the
 * form offer someone else at the same time when their first choice is taken.
 */
export async function getAvailableSlots(input: {
  orgId: string;
  serviceIds: string[];
  fromDate: string;
  toDate?: string;
  employeeId?: string | null;
  /** So the customer keeps seeing the slot they are holding. */
  sessionToken?: string | null;

  /**
   * Which person in the party these times are for. Their own hold does not
   * block them; the rest of their party's does — if the mother has Hanna at
   * 10:45, the daughter needs somebody else.
   */
  partyIndex?: number | null;
}): Promise<Slot[]> {
  if (input.serviceIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("get_available_slots", {
    p_org_id: input.orgId,
    p_service_ids: input.serviceIds,
    p_from_date: input.fromDate,
    p_to_date: input.toDate ?? undefined,
    p_employee_id: input.employeeId ?? undefined,
    p_session_token: input.sessionToken ?? undefined,
    p_party_index: input.partyIndex ?? undefined,
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
