import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * One customer, everything about them this person may see.
 *
 * NOTHING HERE DECIDES WHO SEES WHAT. Every query below is written as though
 * the reader may see everything, and row-level security returns only what they
 * may — `customer.view` for the record, `customer.view_sensitive` for the care
 * notes, and per-row `has_permission(min_permission)` for each flag. Migration
 * 012, DECISIONS #27.
 *
 * THE CONSEQUENCE THAT MATTERS, and the reason the page still calls `can()`:
 * **an empty result and a forbidden result are identical from here.** A
 * receptionist reading `customer_care_notes` gets no rows, exactly like a
 * customer who has no allergies recorded. Printing "no allergies" for both is
 * how somebody eventually relies on a blank that only meant "not for you".
 * So this returns what it found, and the screen says which kind of silence it
 * is by asking separately what the reader holds.
 */

export type CareNotes = {
  allergies: string | null;
  sensitivities: string | null;
  hair_formula: string | null;
};

export type CustomerFlag = {
  id: string;
  flag_type: string;
  note: string | null;
};

/** One trip to the salon: several appointment rows sharing a `visit_id`. */
export type Visit = {
  visitId: string;
  startsAt: string;
  status: string;
  /** The headline style, not every row — a braid is a founding and a finishing. */
  headline: string;
  /** Everyone who worked on it, in the order the rows came back. */
  people: string[];
  /** What the visit was charged. `finish` rows carry zero by design. */
  total: number;
  forName: string | null;
};

export type CustomerRecord = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  birthday: string | null;
  notes: string | null;
  preferred: string | null;
  flags: CustomerFlag[];
  care: CareNotes | null;
  visits: Visit[];
};

export async function getCustomerRecord(
  orgId: string,
  customerId: string,
): Promise<CustomerRecord | null> {
  const supabase = await createSupabaseServerClient();

  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, full_name, phone, email, birthday, notes, preferred_employee_id",
    )
    .eq("org_id", orgId)
    .eq("id", customerId)
    .is("deleted_at", null)
    .maybeSingle();

  if (!customer) return null;

  const [{ data: care }, { data: flags }, { data: rows }, { data: preferred }] =
    await Promise.all([
      supabase
        .from("customer_care_notes")
        .select("allergies, sensitivities, hair_formula")
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .maybeSingle(),

      supabase
        .from("customer_flags")
        .select("id, flag_type, note")
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),

      supabase
        .from("appointments")
        .select(
          `id, visit_id, starts_at, status, phase, price, for_name,
           employee:employees (full_name),
           service:services (name, is_included_with_others)`,
        )
        .eq("org_id", orgId)
        .eq("customer_id", customerId)
        .is("deleted_at", null)
        .order("starts_at", { ascending: false }),

      customer.preferred_employee_id
        ? supabase
            .from("employees")
            .select("full_name")
            .eq("id", customer.preferred_employee_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  return {
    id: customer.id,
    full_name: customer.full_name,
    phone: customer.phone,
    email: customer.email,
    birthday: customer.birthday,
    notes: customer.notes,
    preferred: preferred?.full_name ?? null,
    flags: (flags ?? []) as CustomerFlag[],
    care: (care as CareNotes | null) ?? null,
    visits: intoVisits(rows ?? []),
  };
}

type Row = {
  visit_id: string;
  starts_at: string;
  status: string;
  phase: string;
  price: number | null;
  for_name: string | null;
  employee: { full_name: string } | null;
  service: { name: string; is_included_with_others: boolean } | null;
};

/**
 * Appointment rows into visits.
 *
 * ONE TRIP IS ONE LINE, however many rows it took. Since migration 033 a braid
 * is a founding and one or more finishings across two or three people, and a
 * history printed flat makes a customer who came four times look like she came
 * eleven — which is the number somebody would then quote her.
 *
 * The headline is the first service that is not merely included with others,
 * so a visit reads "Knotless braids" rather than "Wash and blow dry" because
 * the wash happened to be written first.
 */
function intoVisits(rows: unknown[]): Visit[] {
  const byVisit = new Map<string, Visit>();

  for (const raw of rows as Row[]) {
    const existing = byVisit.get(raw.visit_id);
    const person = raw.employee?.full_name;

    if (!existing) {
      byVisit.set(raw.visit_id, {
        visitId: raw.visit_id,
        startsAt: raw.starts_at,
        status: raw.status,
        headline: raw.service?.is_included_with_others
          ? ""
          : (raw.service?.name ?? ""),
        people: person ? [person] : [],
        total: Number(raw.price ?? 0),
        forName: raw.for_name,
      });

      continue;
    }

    /* Rows arrive newest first, so the earliest start is the last one seen. */
    if (raw.starts_at < existing.startsAt) existing.startsAt = raw.starts_at;

    if (!existing.headline && raw.service && !raw.service.is_included_with_others) {
      existing.headline = raw.service.name;
    }

    if (person && !existing.people.includes(person)) existing.people.push(person);

    existing.total += Number(raw.price ?? 0);
  }

  /* A visit of nothing but included services — a wash on its own — still needs
     a name, and its own service is the honest one. */
  for (const visit of byVisit.values()) {
    if (!visit.headline) visit.headline = "Wash and blow dry";
  }

  return [...byVisit.values()];
}
