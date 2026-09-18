"use server";

import { requireProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** One answer the customer gave, snapshotted at booking time. */
export type ChosenOption = {
  appointment_id: string;
  group_name: string;
  option_name: string;
  price_delta: number;
  duration_delta_minutes: number;
};

/**
 * The answers behind a booking — size, length, whose hair.
 *
 * FETCHED WHEN THE PANEL OPENS, not carried by the calendar query. The day
 * view already asks for five joined tables across every row on screen; adding
 * a sixth for something only ever read on a click would slow the screen that
 * has to stay fast to make one that is opened a few times an hour faster.
 *
 * The names are read straight off `appointment_options`, which snapshots
 * `group_name` and `option_name` as text rather than joining `service_options`
 * — so a booking still reads correctly after the salon renames or retires the
 * answer it was made with. Migration 027's design, and this is the first
 * screen to benefit from it.
 *
 * `requireProfile()` rather than a permission key, because that is what the
 * policy asks: `appointment_options_select_member` is `org_id =
 * current_org_id()`. Worth knowing that this is LOOSER than `appointments`
 * itself, which is per-row — a stylist could read the options of an
 * appointment she cannot see the row for. Not a leak in practice, since the
 * panel only opens rows the grid already showed her, and not fixable here:
 * tightening that policy is a migration.
 */
export async function loadVisitOptions(
  appointmentIds: string[],
): Promise<ChosenOption[]> {
  await requireProfile();

  if (appointmentIds.length === 0) return [];

  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("appointment_options")
    .select(
      "appointment_id, group_name, option_name, price_delta, duration_delta_minutes",
    )
    .in("appointment_id", appointmentIds)
    .order("created_at");

  return (data ?? []) as ChosenOption[];
}
