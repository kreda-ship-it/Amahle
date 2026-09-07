import type { Metadata } from "next";

import { can, currentEmployeeId, requireProfile } from "@/lib/auth";
import { getDayColumns } from "@/lib/appointments/columns";
import {
  salonDateKey,
  salonDayLabelLong,
  salonDayRange,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DayGrid, type Row } from "../day-grid";

/**
 * The salon's day.
 *
 * The screen that stays open, so it answers the questions somebody at the desk
 * actually has: who is with whom, who is free, what is coming.
 *
 * WHAT MAKES THIS MORE THAN A LIST. Since migration 033 one braid is two or
 * three rows across two or three people — a stylist founds it, an assistant
 * finishes it. Shown flat, one customer looks like three bookings and the day
 * looks twice as busy as it is. So the grid names a block after the visit's
 * headline style rather than its own row, and marks the finishing ones.
 *
 * WHO SEES WHAT IS NOT DECIDED HERE. The query asks for the day and row-level
 * security decides what comes back: `appointment.view_all OR employee_id =
 * current_employee_id()`. A stylist gets their own column and a receptionist
 * the whole salon, from identical code. There is no role check on this page
 * and there must not be.
 */

export const metadata: Metadata = {
  title: "The day",
  robots: { index: false, follow: false },
};

/* Never cached. A day view showing a booking taken ten minutes ago is worse
   than none, because somebody will trust it. */
export const dynamic = "force-dynamic";

export default async function StaffDayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /*
   * The page guards itself, and that is not redundant with the layout above
   * it. A layout in the App Router is not re-run when you navigate between
   * pages that share it, and `proxy.ts` deliberately guards nothing — it only
   * keeps a valid session valid. So this line is the check that counts.
   */
  await requireProfile();

  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const [seesEverything, mayManage, employee] = await Promise.all([
    can("appointment.view_all"),
    can("appointment.manage"),
    currentEmployeeId(),
  ]);

  /* A stylist holds no appointment permission and may still mark her own
     work — migration 042. The database decides which rows; this decides
     whether the key is a set of buttons or a legend. */
  const mayMark = mayManage || employee !== null;

  const today = salonDateKey(new Date(), org.timezone);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : today;

  const { from, to } = salonDayRange(day, org.timezone);

  const [{ data, error }, columns] = await Promise.all([
    supabase
      .from("appointments")
      .select(
        `id, visit_id, starts_at, ends_at, blocked_until, phase, status, employee_requested,
         for_name, notes,
         employee:employees (id, full_name),
         service:services (name, is_included_with_others),
         customer:customers (full_name, phone)`,
      )
      .gte("starts_at", from)
      .lt("starts_at", to)
      .is("deleted_at", null)
      .order("starts_at"),
    getDayColumns(org.id),
  ]);

  /*
   * Each row is tagged with the column it belongs in, here rather than in the
   * grid. The grid draws columns and knows nothing about what they mean, which
   * is what lets the same component serve the week view where they are days.
   *
   * Everybody who only ever finishes shares the last column. See the note in
   * `getDayColumns()` for why that is right rather than a slight.
   */
  const supportIds = new Set(columns.support.map((person) => person.id));
  const SUPPORT = "__support__";

  const rows = ((data ?? []) as unknown as Omit<Row, "column_id">[]).map(
    (row) => ({
      ...row,
      column_id:
        !row.employee?.id || supportIds.has(row.employee.id)
          ? SUPPORT
          : row.employee.id,
    }),
  ) as Row[];

  const heads = [
    ...columns.stylists.map((person) => ({
      id: person.id,
      label: person.full_name,
    })),
    ...(columns.support.length > 0
      ? [{ id: SUPPORT, label: "Assistants" }]
      : []),
  ];

  return (
    /* The staff shell supplies no padding of its own, so every screen inside
       it sets the same one. Matches the dashboard. */
    <div className="flex flex-col gap-5 p-5 lg:p-8">
      {/* The calendar and the status key sit together inside the grid, on
          the right. Both fold away when the day needs the room. */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div>
          <p className="label text-ink-muted">
            {seesEverything ? "The whole salon" : "Your day"}
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {salonDayLabelLong(day)}
          </h1>
        </div>

      </header>

      {error ? (
        <p className="text-ink-muted">
          The day could not be loaded. {error.message}
        </p>
      ) : (
        <DayGrid
          rows={rows}
          columns={heads}
          timezone={org.timezone}
          canManage={mayManage}
          canMark={mayMark}
          columnKind="employee"
          pickerDate={day}
          today={today}
          plan={null}
        />
      )}
    </div>
  );
}
