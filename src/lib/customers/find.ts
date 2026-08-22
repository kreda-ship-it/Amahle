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
