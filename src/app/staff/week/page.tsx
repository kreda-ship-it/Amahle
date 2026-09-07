import type { Metadata } from "next";
import Link from "next/link";

import { can, currentEmployeeId, requireProfile } from "@/lib/auth";
import { getDayColumns } from "@/lib/appointments/columns";
import { markableStatuses } from "@/lib/appointments/status";
import { getRota } from "@/lib/appointments/rota";
import {
  salonDateKey,
  salonDayLabel,
  salonDayRange,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DayGrid, type Row } from "../day-grid";

/**
 * One person's week.
 *
 * The day view answers "where is the gap today" across the whole salon. This
 * answers the other question the desk gets on the telephone — "when is Fikir
 * next free?" — which a day view can only answer by being opened seven times.
 *
 * ONE PERSON, NOT EVERYBODY. Days across and time down leaves seven columns;
 * putting ten stylists into each of them is the assistants column ten times
 * over, and unreadable. Every salon system makes the same choice, and the
 * stylist selector is the whole interface.
 *
 * It is the same grid as the day view, drawing the same blocks with the same
 * marking. `Row.column_id` is what makes that possible: the server decides
 * what a column means — a person there, a date here — and the grid draws
 * columns without knowing which.
 */

export const metadata: Metadata = {
  title: "The week",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** Calendar-square arithmetic, in UTC — a date is not a moment. */
function shiftDays(dateKey: string, by: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const when = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + by));

  return when.toISOString().slice(0, 10);
}

/** The Sunday-to-Saturday week containing this date. */
function weekOf(dateKey: string): string[] {
  const [y, m, d] = dateKey.split("-").map(Number);
  const when = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  const sunday = shiftDays(dateKey, -when.getUTCDay());

  return Array.from({ length: 7 }, (_, i) => shiftDays(sunday, i));
}

export default async function StaffWeekPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* The page guards itself — a layout is not re-run between pages that share
     it, and proxy.ts deliberately guards nothing. */
  const profile = await requireProfile();

  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const [mayManage, employee] = await Promise.all([
    can("appointment.manage"),
    currentEmployeeId(),
  ]);

  /* Which statuses this person may apply is now worked out by
     markableStatuses() at the point it is passed down — migration 042's list,
     kept in one place so a screen cannot drift from the function enforcing
     it. `employee` also goes down, because "your own work" is a fact about a
     ROW and only the grid sees rows. */
  const today = salonDateKey(new Date(), org.timezone);

  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : today;

  const days = weekOf(anchor);
  const columns = await getDayColumns(org.id);

  /*
   * Who to show. A stylist looking at their own week is the common case and
   * needs no choosing, so it defaults to them; anybody else gets the first
   * person on the roster until they pick. `?employee=` carries the choice, so
   * a week is a link somebody can send.
   */
  const chosen =
    params.employee ??
    columns.stylists.find((person) => person.full_name === profile.full_name)
      ?.id ??
    columns.stylists[0]?.id ??
    "";

  /* Seven days, from one helper. The half-open range composes: `to` for
     Saturday is midnight at the start of Sunday, so there is no special case
     for the last day of the week. */
  const { from } = salonDayRange(days[0], org.timezone);
  const { to } = salonDayRange(days[6], org.timezone);

  /*
   * No query at all when nobody holds a `lead` row, because there is nobody
   * to ask about. `employee_id = ''` is a malformed uuid to Postgres, and the
   * page reported the resulting error as "The week could not be loaded" —
   * which reads as a fault when the truth is that the matrix is empty.
   */
  const result = chosen
    ? await supabase
        .from("appointments")
        .select(
          `id, visit_id, starts_at, ends_at, blocked_until, phase, status, employee_requested,
           for_name, notes,
           employee:employees (id, full_name),
           service:services (name, is_included_with_others),
           customer:customers (full_name, phone)`,
        )
        .eq("employee_id", chosen)
        .gte("starts_at", from)
        .lt("starts_at", to)
        .is("deleted_at", null)
        .order("starts_at")
    : null;

  const data = result?.data ?? [];
  const error = result?.error ?? null;

  /* The column is the salon-local date the appointment falls on — not the
     server's date, which is a different day for part of every evening. */
  const rows = ((data ?? []) as unknown as Omit<Row, "column_id">[]).map(
    (row) => ({
      ...row,
      column_id: salonDateKey(row.starts_at, org.timezone),
    }),
  ) as Row[];

  /* One person across seven days, so the rota is asked the other way round —
     same function, a different slice of the same answer. */
  const rota = chosen
    ? await getRota({
        orgId: org.id,
        employeeIds: [chosen],
        dateKeys: days,
        timezone: org.timezone,
      })
    : new Map();

  const heads = days.map((day) => ({
    id: day,
    label: `${salonDayLabel(day)}${day === today ? " · today" : ""}`,
    rota: rota.get(`${chosen}|${day}`),
  }));

  const everyone = [...columns.stylists, ...columns.support];

  return (
    <div className="flex flex-col gap-5 p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="label text-ink-muted">The week</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {everyone.find((person) => person.id === chosen)?.full_name ??
              "Nobody selected"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {/* A form rather than a dropdown that needs JavaScript — the choice
              belongs in the URL, so a week can be sent to somebody. */}
          <form className="flex items-center gap-2">
            {/* A field rather than a hidden value. Arrows walk a week at a
                time; "the week of the 14th" is one thing somebody says and
                took four taps to reach. */}
            <input
              type="date"
              name="date"
              defaultValue={anchor}
              aria-label="Week beginning"
              className="border border-line bg-surface px-3 py-2 tabular-nums"
            />
            <select
              name="employee"
              defaultValue={chosen}
              className="border border-line bg-surface px-3 py-2"
            >
              {everyone.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.full_name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="border border-line px-3 py-2 transition-colors hover:border-ink"
            >
              Show
            </button>
          </form>

          <Link
            href={`/staff/week?date=${shiftDays(anchor, -7)}&employee=${chosen}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &larr;
          </Link>
          <Link
            href={`/staff/week?employee=${chosen}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            This week
          </Link>
          <Link
            href={`/staff/week?date=${shiftDays(anchor, 7)}&employee=${chosen}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &rarr;
          </Link>
        </div>
      </header>

      {!chosen ? (
        <p className="py-12 text-center text-ink-muted">
          Nobody is set up to take bookings yet. Tick somebody on{" "}
          <Link
            href="/staff/who-does-what"
            className="underline underline-offset-4 transition-colors hover:text-ink"
          >
            who does what
          </Link>
          .
        </p>
      ) : error ? (
        <p className="text-ink-muted">
          The week could not be loaded. {error.message}
        </p>
      ) : (
        <DayGrid
          rows={rows}
          columns={heads}
          timezone={org.timezone}
          canManage={mayManage}
          markable={markableStatuses(mayManage, employee !== null)}
          ownEmployeeId={employee}
          columnKind="date"
          plan={null}
        />
      )}
    </div>
  );
}
