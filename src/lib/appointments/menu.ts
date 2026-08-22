import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The menu, as a member of staff sees it.
 *
 * `availability.ts` next door reads the menu a CUSTOMER sees, and the two are
 * deliberately different lists. That file filters on `is_bookable_online`,
 * which by DECISIONS #23 is what governs the Book button on the public site —
 * and the services it excludes are precisely the long braiding appointments
 * the salon wants to discuss on the phone first.
 *
 * Which makes them precisely the services a phone booking is FOR. A staff
 * entry form built on the customer's list could not take the bookings the
 * salon actually rings about, so this file exists to read the whole menu.
 *
 * Everything here needs a logged-in profile. `anon` has no business reading
 * buffer times or who leads what, and none of these queries would return a row
 * for one anyway — row-level security decides, not this file.
 */

export type StaffService = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  price_display: string;
  duration_minutes: number;
  is_bookable_online: boolean;
};

/** One answer to one question, and what choosing it costs. */
export type ServiceOption = {
  id: string;
  name: string;
  description: string | null;
  price_delta: number;
  duration_delta_minutes: number;
};

/** One question a service asks, with its answers. */
export type ServiceQuestion = {
  id: string;
  name: string;
  prompt: string;
  /** `one` is a size or a length; `many` allows several answers. */
  selection: string;
  is_required: boolean;
  /**
   * Ask this question only once that answer has been given — "which colour?"
   * appears only after "the salon provides the hair". Null means always ask.
   * One level deep only; see SCHEMA.md.
   */
  depends_on_option_id: string | null;
  options: ServiceOption[];
};

export type LeadEmployee = {
  id: string;
  full_name: string;
};

/**
 * Every service the salon can perform, whether or not a customer may book it
 * themselves. Ordered the way the salon lists them.
 */
export async function getStaffServices(orgId: string): Promise<StaffService[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("services")
    .select(
      "id, name, category, price, price_display, duration_minutes, is_bookable_online",
    )
    .eq("org_id", orgId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("display_order");

  if (error) {
    console.error("getStaffServices failed", error);
    return [];
  }

  return data ?? [];
}

/**
 * The questions one service asks, in the order it asks them.
 *
 * Two round trips rather than one nested select: the link table carries the
 * display order and the dependency, while the group carries the prompt, and
 * PostgREST cannot order a nested relation by a column on the join. Doing it
 * here keeps the ordering rule visible instead of hidden in a query string.
 *
 * Inactive and soft-deleted groups and options are dropped — a retired answer
 * must not be offerable, while `appointment_options` keeps its snapshot of
 * every past booking that chose it.
 */
export async function getServiceQuestions(
  orgId: string,
  serviceId: string,
): Promise<ServiceQuestion[]> {
  const supabase = await createSupabaseServerClient();

  const { data: links, error: linkError } = await supabase
    .from("service_option_group_links")
    .select("group_id, depends_on_option_id, display_order")
    .eq("org_id", orgId)
    .eq("service_id", serviceId)
    .is("deleted_at", null)
    .order("display_order");

  if (linkError || !links || links.length === 0) {
    if (linkError) console.error("getServiceQuestions links failed", linkError);
    // No rows is the ordinary case for a trim: a service that asks nothing has
    // no links at all. Absence, not a flag — see SCHEMA.md.
    return [];
  }

  const groupIds = links.map((link) => link.group_id);

  const { data: groups, error: groupError } = await supabase
    .from("service_option_groups")
    .select(
      `id, name, prompt, selection, is_required,
       service_options (id, name, description, price_delta,
                        duration_delta_minutes, display_order, is_active, deleted_at)`,
    )
    .eq("org_id", orgId)
    .in("id", groupIds)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (groupError || !groups) {
    console.error("getServiceQuestions groups failed", groupError);
    return [];
  }

  const byId = new Map(groups.map((group) => [group.id, group]));

  // The link table's order is the salon's order, so walk the links and pull
  // each group out — not the other way round.
  return links.flatMap((link) => {
    const group = byId.get(link.group_id);
    if (!group) return [];

    const options = (group.service_options ?? [])
      .filter((option) => option.is_active && option.deleted_at === null)
      .sort((a, b) => a.display_order - b.display_order)
      .map((option) => ({
        id: option.id,
        name: option.name,
        description: option.description,
        price_delta: option.price_delta,
        duration_delta_minutes: option.duration_delta_minutes,
      }));

    // A question with nothing left to answer is not a question.
    if (options.length === 0) return [];

    return [
      {
        id: group.id,
        name: group.name,
        prompt: group.prompt,
        selection: group.selection,
        is_required: group.is_required,
        depends_on_option_id: link.depends_on_option_id,
        options,
      },
    ];
  });
}

/**
 * Who may LEAD this service — the only choice the form gets to make.
 *
 * `create_appointment()` refuses a lead without a live `employee_services` row
 * at `role = 'lead'`, for staff bookings exactly as for online ones. So a
 * dropdown built from anything looser would offer people the database then
 * rejects, and the receptionist would meet "that member of staff does not
 * perform one of those services" after typing everything else.
 *
 * The finishers are deliberately absent. They are chosen inside
 * `create_appointment()` at write time, because minutes pass between somebody
 * seeing a time and pressing the button. Nobody picks them, here or anywhere.
 */
export async function getLeadEmployees(
  orgId: string,
  serviceId: string,
): Promise<LeadEmployee[]> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("employee_services")
    .select("employees!inner(id, full_name, is_bookable, is_active, display_order)")
    .eq("org_id", orgId)
    .eq("service_id", serviceId)
    .eq("role", "lead")
    .is("deleted_at", null);

  if (error) {
    console.error("getLeadEmployees failed", error);
    return [];
  }

  return (data ?? [])
    .map((row) => row.employees)
    .filter((employee) => employee && employee.is_active && employee.is_bookable)
    .sort((a, b) => a.display_order - b.display_order)
    .map((employee) => ({ id: employee.id, full_name: employee.full_name }));
}
