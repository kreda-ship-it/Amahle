import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Recognising a customer from their phone number.
 *
 * `find_or_create_customer()` in Postgres already does this on the way in, and
 * it fills blanks without ever overwriting — a returning customer saying
 * "Sara" must not rewrite the "Sara T." the salon curated. So this lookup is
 * not what keeps the records clean; the database is.
 *
 * It exists so the RECEPTIONIST knows. Typing a number that already belongs to
 * somebody and being told "Sara T. — 6 visits" is the difference between
 * booking a known customer and quietly inventing a second spelling of one,
 * complete with an empty history and none of her allergy notes. The database
 * would merge them by phone anyway; the person on the phone would not know
 * that had happened.
 *
 * Reading `customers` needs `customer.view`, which Owner, Manager,
 * Receptionist and Stylist all hold. Nothing here decides that — row-level
 * security does, and a caller without it gets nothing back.
 */

export type KnownCustomer = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  /** How many appointments they have ever had. Null when it could not be read. */
  visits: number | null;
};

/**
 * Look somebody up by phone number, or return null.
 *
 * Matching is on `phone_digits` — the generated column with every non-digit
 * stripped — because `+1 (202) 555-0143` and `+1-202-555-0143` are one person
 * and would otherwise be two rows. Stripping here mirrors what Postgres
 * generated on the way in.
 *
 * The one case it cannot catch is a stored number carrying a country code
 * where the typed one does not, or the reverse. `normalize_phone()` settles
 * that at write time using the salon's `country_dial_code`; here a miss simply
 * shows nothing, and the database still matches correctly on submit. A lookup
 * that is silent is honest — one that guessed would be worse.
 */
export async function findCustomerByPhone(
  orgId: string,
  phone: string,
): Promise<KnownCustomer | null> {
  const digits = phone.replace(/\D/g, "");

  // Fewer than seven digits is somebody still typing, not a phone number.
  if (digits.length < 7) return null;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("customers")
    .select("id, full_name, phone, email")
    .eq("org_id", orgId)
    .eq("phone_digits", digits)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  const { count } = await supabase
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("customer_id", data.id)
    .is("deleted_at", null);

  return {
    id: data.id,
    full_name: data.full_name,
    phone: data.phone,
    email: data.email,
    visits: count ?? null,
  };
}

/** A row in the front desk's search results. */
export type CustomerMatch = {
  id: string;
  full_name: string;
  phone: string;
  email: string | null;
  /**
   * When they were last in — DERIVED from `appointments`, not read from
   * `customers.last_visit_at`.
   *
   * That column exists, is granted for writing, and **nothing has ever written
   * it**. Migration 012 says it is "maintained by whatever writes appointments"
   * and `create_appointment()` does not. So it is null on every row in the
   * database, and a screen trusting it would print "no visits yet" against a
   * customer who has been in eleven times.
   *
   * Deriving costs one extra query and is true. Filling the column properly is
   * a trigger, a migration and a backfill — worth doing, and not worth doing
   * inside a search box.
   */
  last_visit_at: string | null;
};

const FIELDS = "id, full_name, phone, email";

/**
 * Fill in when each of these customers was last in.
 *
 * ONE QUERY FOR THE WHOLE PAGE, not one per row. Twenty-five customers would
 * otherwise be twenty-five round trips, which is the shape that makes a list
 * feel slow for reasons nobody can see.
 *
 * Rows come back newest first and the first sighting of each customer wins, so
 * no grouping is needed — PostgREST cannot express `max() … group by` without
 * a view, and a view for this would be a migration.
 */
async function withLastVisit(
  orgId: string,
  customers: Omit<CustomerMatch, "last_visit_at">[],
): Promise<CustomerMatch[]> {
  if (customers.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("appointments")
    .select("customer_id, starts_at")
    .eq("org_id", orgId)
    .in(
      "customer_id",
      customers.map((customer) => customer.id),
    )
    .is("deleted_at", null)
    .order("starts_at", { ascending: false });

  const latest = new Map<string, string>();

  for (const row of data ?? []) {
    if (row.customer_id && !latest.has(row.customer_id)) {
      latest.set(row.customer_id, row.starts_at);
    }
  }

  return customers.map((customer) => ({
    ...customer,
    last_visit_at: latest.get(customer.id) ?? null,
  }));
}

/**
 * Find somebody by part of their name or part of their number.
 *
 * THE MOST-USED ACTION AT ANY FRONT DESK, and until now there was no way to do
 * it anywhere in this application. `findCustomerByPhone()` above wants a whole
 * number and an exact match, which is right for recognising a caller mid-form
 * and useless for "it's Sara, I was in three weeks ago".
 *
 * TWO QUERIES RATHER THAN ONE `or()`. PostgREST's `or` takes its filters as a
 * formatted string, so somebody searching for "O'Brien, J" would be writing
 * that grammar rather than searching in it. Two calls whose values go through
 * the client as parameters cannot be malformed by what somebody types, and the
 * cost is one extra round trip on a query that returns at most a screenful.
 *
 * NUMBERS MATCH ON `phone_digits`, the generated column with punctuation
 * stripped, so typing the last four digits off a caller ID finds them whatever
 * spacing the salon happened to store. Three digits is the floor — below that
 * every customer matches and the list is noise.
 */
export async function searchCustomers(
  orgId: string,
  query: string,
  limit = 25,
): Promise<CustomerMatch[]> {
  const term = query.trim();

  /* One letter matches nearly everybody, which is a slower way of showing the
     list you already have. */
  if (term.length < 2) return [];

  const digits = term.replace(/\D/g, "");
  const supabase = await createSupabaseServerClient();

  const base = () =>
    supabase
      .from("customers")
      .select(FIELDS)
      .eq("org_id", orgId)
      .is("deleted_at", null)
      .order("full_name")
      .limit(limit);

  const [byName, byPhone] = await Promise.all([
    base().ilike("full_name", `%${term}%`),
    digits.length >= 3
      ? base().like("phone_digits", `%${digits}%`)
      : Promise.resolve({ data: [], error: null }),
  ]);

  /* Name first, then numbers — somebody who typed letters meant a name, and a
     Map keyed on id keeps the first sighting and drops the duplicate. */
  const found = new Map<string, Omit<CustomerMatch, "last_visit_at">>();

  for (const row of [...(byName.data ?? []), ...(byPhone.data ?? [])]) {
    const customer = row as Omit<CustomerMatch, "last_visit_at">;
    if (!found.has(customer.id)) found.set(customer.id, customer);
  }

  return withLastVisit(orgId, [...found.values()].slice(0, limit));
}

/**
 * Who to show before anybody has typed.
 *
 * The people with the most recent appointments, newest first — asked of
 * `appointments` rather than of `customers.last_visit_at`, for the reason on
 * the type above: that column is null on every row in the database.
 *
 * FALLS BACK TO THE NEWEST RECORDS when nothing has ever been booked. A salon
 * on its first day has customers and no history, and an empty panel under a
 * search box teaches nothing about what the box is for.
 */
export async function recentCustomers(
  orgId: string,
  limit = 10,
): Promise<CustomerMatch[]> {
  const supabase = await createSupabaseServerClient();

  /* More rows than customers wanted, because one customer can hold several
     appointments and the duplicates collapse below. */
  const { data: visits } = await supabase
    .from("appointments")
    .select("customer_id, starts_at")
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("starts_at", { ascending: false })
    .limit(limit * 8);

  const order: string[] = [];
  const seen = new Set<string>();

  for (const row of visits ?? []) {
    if (row.customer_id && !seen.has(row.customer_id)) {
      seen.add(row.customer_id);
      order.push(row.customer_id);
    }
  }

  if (order.length > 0) {
    const { data } = await supabase
      .from("customers")
      .select(FIELDS)
      .eq("org_id", orgId)
      .in("id", order.slice(0, limit))
      .is("deleted_at", null);

    const byId = new Map(
      ((data ?? []) as Omit<CustomerMatch, "last_visit_at">[]).map(
        (customer) => [customer.id, customer],
      ),
    );

    /* Back into appointment order — the query returns them however Postgres
       likes, and "most recently in" is the whole point of the list. */
    const ordered = order
      .slice(0, limit)
      .map((id) => byId.get(id))
      .filter((customer): customer is Omit<CustomerMatch, "last_visit_at"> =>
        Boolean(customer),
      );

    return withLastVisit(orgId, ordered);
  }

  const { data } = await supabase
    .from("customers")
    .select(FIELDS)
    .eq("org_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  return withLastVisit(
    orgId,
    (data ?? []) as Omit<CustomerMatch, "last_visit_at">[],
  );
}
