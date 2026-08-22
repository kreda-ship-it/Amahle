import type { Metadata } from "next";
import Link from "next/link";

import { can, requireProfile } from "@/lib/auth";
import { salonDateKey, salonDayLabelLong } from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DayBoard, type Row } from "./day-board";

/**
 * The salon's day.
 *
 * The screen that is open all day, so it answers the questions somebody
 * standing at the desk actually has: who is with whom, who is free, and what
 * is coming. Everything else in the staff area hangs off this.
 *
 * WHAT MAKES THIS HARDER THAN A LIST OF APPOINTMENTS. Since migration 033 a
 * single braid is two or three rows across two or three people — the stylist
 * founds it, an assistant finishes it. Shown flat, one customer looks like
 * three bookings and the day looks twice as busy as it is. So rows are grouped
 * by visit, and the phase is on the face of each one.
 *
 * WHO SEES WHAT IS NOT DECIDED HERE. The query asks for the day; row-level
 * security decides what comes back. `appointments_select` is
 * `appointment.view_all OR employee_id = current_employee_id()`, so a stylist
 * gets their own column and a receptionist gets the salon, from the same code.
 * There is no `if (role === …)` on this page and there must not be.
 *
 * The rendering moved into `DayBoard` when marking arrived — a highlighter and
 * an undo strip are interactive, and this half is not. Fetching stays here so
 * the query, and the security that governs it, remain on the server.
 */

/* `robots` is not repeated here — the staff layout marks the whole area
   noindex, so every page in it is covered including the ones not built yet. */
export const metadata: Metadata = {
  title: "The day",
};

/* Never cached: a day view showing a booking taken ten minutes ago is worse
   than no day view, because somebody will trust it. */
export const dynamic = "force-dynamic";

/** Yesterday or tomorrow, as a date key the URL can carry. */
function shiftDay(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const when = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  when.setUTCDate(when.getUTCDate() + days);

  return when.toISOString().slice(0, 10);
}

export default async function StaffDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* The page guards itself. The layout calls this too, but a layout is not
     re-run on every navigation, so it cannot be the check that counts. */
  await requireProfile();

  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const [seesEverything, mayManage] = await Promise.all([
    can("appointment.view_all"),
    can("appointment.manage"),
  ]);

  const today = salonDateKey(new Date(), org.timezone);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : today;

  /*
   * A day in the salon's own timezone, not the server's. The salon opens at
   * nine in Maryland whatever the machine running this thinks the time is —
   * and the boundaries of "today" move with the clocks twice a year.
   */
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(`${day}T23:59:59`);

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, visit_id, starts_at, ends_at, phase, status, employee_requested,
       for_name, notes,
       employee:employees (id, full_name),
       service:services (name),
       customer:customers (full_name, phone)`,
    )
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .is("deleted_at", null)
    .order("starts_at");

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-ink-muted">
            {seesEverything ? "The whole salon" : "Your day"}
          </p>
          <h1 className="mt-1 font-display text-3xl">
            {salonDayLabelLong(day)}
          </h1>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/staff?date=${shiftDay(day, -1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &larr; Previous
          </Link>
          {day !== today && (
            <Link
              href="/staff"
              className="border border-line px-3 py-2 transition-colors hover:border-ink"
            >
              Today
            </Link>
          )}
          <Link
            href={`/staff?date=${shiftDay(day, 1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            Next &rarr;
          </Link>
        </div>
      </header>

      {error ? (
        <p className="text-ink-muted">
          The day could not be loaded. {error.message}
        </p>
      ) : (
        <DayBoard rows={rows} timezone={org.timezone} canManage={mayManage} />
      )}
    </div>
  );
}
