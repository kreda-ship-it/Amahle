"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Editing the menu.
 *
 * The most overdue screen in the project. Every price, duration, buffer and
 * lead time in the service tree is a placeholder shaped like a real number —
 * invented so the booking engine could be built and seen working — and
 * correcting one has meant writing SQL ever since.
 *
 * A plain table update rather than a function, deliberately, and it is the
 * opposite call from `set_appointment_status()`. That one needed a function
 * because the rule was about a ROW — "your own appointment" — which a policy
 * cannot express. This rule is about a role: may you manage services, yes or
 * no. `services_update` already says exactly that, and the column grants
 * already say which fields it may touch. A function here would be ceremony
 * around a policy that is already correct.
 */

export type SaveResult = { ok: true } | { ok: false; message: string };

export type ServiceEdit = {
  id: string;
  price: number;
  duration_minutes: number;
  /** Null inherits the salon's default_buffer_minutes. */
  buffer_minutes: number | null;
  /** Null means the lead is needed for the whole thing. */
  lead_minutes: number | null;
  /** Null means the closing time is the only limit. */
  latest_start_time: string | null;
  is_bookable_online: boolean;
  is_active: boolean;
};

export async function saveService(edit: ServiceEdit): Promise<SaveResult> {
  await requirePermission("service.manage");

  if (edit.duration_minutes <= 0) {
    return { ok: false, message: "A service has to take some time." };
  }

  if (edit.price < 0) {
    return { ok: false, message: "A price cannot be negative." };
  }

  /*
   * Migration 019's warning, enforced where somebody can see it: a buffer
   * longer than the service is how a day silently loses hours. The database
   * has its own constraint; this is so the answer arrives in the form rather
   * than as a raised exception.
   */
  if (
    edit.buffer_minutes !== null &&
    edit.buffer_minutes > edit.duration_minutes
  ) {
    return {
      ok: false,
      message: "The cleanup gap cannot be longer than the service itself.",
    };
  }

  if (
    edit.lead_minutes !== null &&
    (edit.lead_minutes <= 0 || edit.lead_minutes > edit.duration_minutes)
  ) {
    return {
      ok: false,
      message:
        "The stylist's part has to be more than nothing and no longer than the whole service.",
    };
  }

  const supabase = await createSupabaseServerClient();

  const { error } = await supabase
    .from("services")
    .update({
      price: edit.price,
      duration_minutes: edit.duration_minutes,
      buffer_minutes: edit.buffer_minutes,
      lead_minutes: edit.lead_minutes,
      latest_start_time: edit.latest_start_time,
      is_bookable_online: edit.is_bookable_online,
      is_active: edit.is_active,
    })
    .eq("id", edit.id)
    .is("deleted_at", null);

  if (error) {
    console.error("saveService failed", error);

    return { ok: false, message: error.message || "That could not be saved." };
  }

  /*
   * The public price list, the booking form and the staff menu all read this
   * table. A price changed here has to be the price quoted a minute later, so
   * every page that shows one is invalidated — not only the screen that made
   * the change.
   */
  revalidatePath("/services");
  revalidatePath("/book");
  revalidatePath("/staff/services");
  revalidatePath("/staff/book");

  return { ok: true };
}
