import { createSupabaseServerClient } from "@/lib/supabase/server";

import { getStaffServices, type LeadEmployee } from "./menu";

/**
 * Who can do what — Selam's matrix, as the salon can read it back.
 *
 * `employee_services` has held this since migration 033, and nothing has ever
 * shown it. The receptionist's most ordinary question on the telephone is
 * "can anyone do this on Saturday?", and until now the only way to answer was
 * to pick a service in the booking form and see whether any times came back —
 * which conflates "nobody does this" with "everybody is busy".
 *
 * `role` is `lead` or `assist`, and the distinction is the salon's own:
 * `lead` performs a style from the start, `assist` finishes one somebody else
 * has begun. "Fikir can braid" and "Emu can finish a braid" are different
 * claims, and before migration 033 this table could not tell them apart.
 *
 * Read-only, and it needs no permission beyond belonging to the salon. The
 * public team page already shows who works here, and who performs what is
 * exactly what a customer is trying to find out.
 */

export type MatrixService = {
  id: string;
  name: string;
  category: string | null;
  isBookableOnline: boolean;
  /** Performs it from the start. Empty means it cannot be booked at all. */
  leads: LeadEmployee[];
  /** Finishes one somebody else has begun. */
  assists: LeadEmployee[];
};

/**
 * Every active service with the people who can take it.
 *
 * Two queries rather than a nested select: the join carries `role`, which
 * decides which of a service's two lists somebody lands in, and PostgREST
 * cannot split one embedded relation into two by a column on the join.
 * Assembling here keeps that rule visible.
 */
export async function getServiceMatrix(
  orgId: string,
): Promise<MatrixService[]> {
  const supabase = await createSupabaseServerClient();

  const [services, { data: pairs, error }] = await Promise.all([
    getStaffServices(orgId),
    supabase
      .from("employee_services")
      .select(
        "service_id, role, employees!inner(id, full_name, is_active, is_bookable, display_order)",
      )
      .eq("org_id", orgId)
      .is("deleted_at", null),
  ]);

  if (error) {
    console.error("getServiceMatrix failed", error);
    return [];
  }

  const leads = new Map<string, (LeadEmployee & { order: number })[]>();
  const assists = new Map<string, (LeadEmployee & { order: number })[]>();

  for (const pair of pairs ?? []) {
    const employee = pair.employees;

    /*
     * Somebody who has left, or who is marked unbookable, is dropped rather
     * than shown greyed. This screen answers "who can take this booking", and
     * a name that cannot take it is a wrong answer wearing a caveat.
     */
    if (!employee || !employee.is_active || !employee.is_bookable) continue;

    const into = pair.role === "assist" ? assists : leads;
    const list = into.get(pair.service_id) ?? [];

    list.push({
      id: employee.id,
      full_name: employee.full_name,
      order: employee.display_order,
    });

    into.set(pair.service_id, list);
  }

  const sorted = (list: (LeadEmployee & { order: number })[] | undefined) =>
    (list ?? [])
      .sort((a, b) => a.order - b.order || a.full_name.localeCompare(b.full_name))
      .map(({ id, full_name }) => ({ id, full_name }));

  return services.map((service) => ({
    id: service.id,
    name: service.name,
    category: service.category,
    isBookableOnline: service.is_bookable_online,
    leads: sorted(leads.get(service.id)),
    assists: sorted(assists.get(service.id)),
  }));
}
