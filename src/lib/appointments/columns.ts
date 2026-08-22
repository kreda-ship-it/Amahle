import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Who gets a column on the day grid.
 *
 * The salon's own division: the stylists each have a column, and everybody who
 * only ever finishes somebody else's work shares one. That is not a slight —
 * it is what the grid is for. A receptionist looks at a stylist's column to
 * answer "when is Fikir free"; nobody asks that about the assistants, because
 * they are interchangeable and `create_appointment()` picks whichever of them
 * is free at write time. Giving each of them a column would be eight mostly
 * empty stripes pushing the stylists off the screen.
 *
 * DERIVED, NOT STORED. There is no `is_stylist` column and this deliberately
 * does not add one. `employee_services.role` already carries the distinction —
 * `lead` performs a style from the start, `assist` finishes one — so anybody
 * holding a single `lead` row is somebody a customer can be booked with, and
 * anybody holding none is not. A stored flag would be a second version of that
 * truth, free to disagree with the matrix the booking path actually reads.
 *
 * The cost, so it is a choice and not an accident: give an assistant one
 * `lead` row for one small service and she gains a column. That is arguably
 * correct — she can now be booked directly — but it is worth knowing that the
 * grid's shape follows the matrix rather than a job title.
 */

export type Column = {
  id: string;
  full_name: string;
};

export type DayColumns = {
  /** One column each, in the salon's own display order. */
  stylists: Column[];
  /** Everybody who only ever finishes. They share the last column. */
  support: Column[];
};

export async function getDayColumns(orgId: string): Promise<DayColumns> {
  const supabase = await createSupabaseServerClient();

  const [{ data: employees, error }, { data: pairs }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, full_name, display_order")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("display_order"),
    supabase
      .from("employee_services")
      .select("employee_id, role")
      .eq("org_id", orgId)
      .eq("role", "lead")
      .is("deleted_at", null),
  ]);

  if (error || !employees) {
    console.error("getDayColumns failed", error);
    return { stylists: [], support: [] };
  }

  const leads = new Set((pairs ?? []).map((pair) => pair.employee_id));

  const stylists: Column[] = [];
  const support: Column[] = [];

  for (const employee of employees) {
    const column = { id: employee.id, full_name: employee.full_name };

    if (leads.has(employee.id)) stylists.push(column);
    else support.push(column);
  }

  return { stylists, support };
}
