"use server";

import { revalidatePath } from "next/cache";

import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Saving your own details.
 *
 * Guarded by being signed in and nothing more, which is the right level here:
 * `update_my_employee_details()` finds the row through
 * `current_employee_id()`, so there is no id to tamper with and no other
 * person's record this can reach. Asking for a permission as well would refuse
 * exactly the people it exists for — a stylist holds none of the team keys.
 */
export async function saveMyDetails(input: {
  phone: string;
  email: string;
  bio: string;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireProfile();

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("update_my_employee_details", {
    p_phone: input.phone,
    p_email: input.email,
    p_bio: input.bio,
  });

  if (error) {
    console.error("saveMyDetails failed", error);

    return {
      ok: false,
      message: error.message || "That could not be saved.",
    };
  }

  revalidatePath("/staff/me");
  revalidatePath("/team");

  return { ok: true };
}
