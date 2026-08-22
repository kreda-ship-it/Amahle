import type { Metadata } from "next";
import Link from "next/link";

import { can, requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import {
  salonDateKey,
  salonDayLabelLong,
  salonTime,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
 * three bookings and the day looks twice as busy as it is. So rows are
 * grouped by visit, and the phase is on the face of each one.
 *
 * WHO SEES WHAT IS NOT DECIDED HERE. The query asks for the day; row-level
 * security decides what comes back. `appointments_select` is
 * `appointment.view_all OR employee_id = current_employee_id()`, so a stylist
 * gets their own column and a receptionist gets the salon, from the same
 * code. There is no `if (role === …)` on this page and there must not be.
 */

export const metadata: Metadata = {
  title: "The day",
  robots: { index: false, follow: false },
};

/* Never cached: a day view showing a booking taken ten minutes ago is worse
   than no day view, because somebody will trust it. */
export const dynamic = "force-dynamic";

type Row = {
  id: string;
  visit_id: string;
  starts_at: string;
  ends_at: string;
  phase: string;
  status: string;
  employee_requested: boolean;
  price: number;
  for_name: string | null;
  notes: string | null;
  employee: { id: string; full_name: string } | null;
  service: { name: string } | null;
  customer: { full_name: string; phone: string } | null;
};

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
  const profile = await requireProfile();
  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const seesEverything = await can("appointment.view_all");
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
       price, for_name, notes,
       employee:employees (id, full_name),
       service:services (name),
       customer:customers (full_name, phone)`,
    )
    .gte("starts_at", from.toISOString())
    .lte("starts_at", to.toISOString())
    .order("starts_at");

  const rows = (data ?? []) as unknown as Row[];
  const live = rows.filter(
    (row) => row.status !== "cancelled" && row.status !== "no_show",
  );

  // One entry per person who has something on, in the order the salon lists
  // them. An employee with an empty day is not shown: this is a working
  // screen, not a roster.
  const byEmployee = new Map<string, { name: string; rows: Row[] }>();

  for (const row of live) {
    const id = row.employee?.id ?? "unassigned";
    const entry = byEmployee.get(id);

    if (entry) entry.rows.push(row);
    else
      byEmployee.set(id, {
        name: row.employee?.full_name ?? "Nobody assigned",
        rows: [row],
      });
  }

  /*
   * A short mark per visit — A, B, C — so the same customer's founding and
   * finishing can be recognised as one job across two columns. The visit id
   * is a UUID and unreadable; what the desk needs is "these two are the same
   * head".
   */
  const visitMark = new Map<string, string>();
  for (const row of live) {
    if (!visitMark.has(row.visit_id)) {
      const n = visitMark.size;
      visitMark.set(
        row.visit_id,
        String.fromCharCode(65 + (n % 26)) + (n >= 26 ? String(Math.floor(n / 26)) : ""),
      );
    }
  }

  const cancelled = rows.length - live.length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-4">
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
      ) : live.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">
          Nothing booked{day === today ? " today" : " that day"}.
        </p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...byEmployee.values()].map((person) => (
            <section key={person.name} className="border border-line">
              <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
                {person.name}
                <span className="ml-2 text-sm font-normal text-ink-muted">
                  {person.rows.length}
                </span>
              </h2>

              <ul className="divide-y divide-line">
                {person.rows.map((row) => (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium tabular-nums">
                        {salonTime(row.starts_at, org.timezone)}
                        <span className="text-ink-muted">
                          {" – "}
                          {salonTime(row.ends_at, org.timezone)}
                        </span>
                      </span>

                      {/*
                        The visit mark, so a founding in one column and a
                        finishing in another are visibly the same customer.
                      */}
                      <span className="label text-ink-muted">
                        {visitMark.get(row.visit_id)}
                      </span>
                    </div>

                    <p className="mt-1">
                      {row.customer?.full_name ?? "—"}
                      {row.for_name && (
                        <span className="text-ink-muted"> · {row.for_name}</span>
                      )}
                    </p>

                    <p className="mt-0.5 text-sm text-ink-muted">
                      {row.service?.name}
                      {row.phase === "finish" && (
                        <span className="ml-2 border border-line px-1.5 py-0.5 text-xs">
                          finishing
                        </span>
                      )}
                      {/*
                        A star means the customer asked for this person by
                        name. The receptionist may move an assignment; a
                        request she should ask about first. See DECISIONS #32.
                      */}
                      {row.employee_requested && (
                        <span
                          className="ml-2 text-brand"
                          title="Asked for by name"
                        >
                          ★
                        </span>
                      )}
                    </p>

                    {row.customer?.phone && (
                      <a
                        href={`tel:${row.customer.phone.replace(/[^\d+]/g, "")}`}
                        className="mt-1 inline-block text-sm text-ink-muted underline underline-offset-4"
                      >
                        {row.customer.phone}
                      </a>
                    )}

                    {row.notes && (
                      <p className="mt-2 border-l-2 border-line pl-3 text-sm text-ink-muted">
                        {row.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4 text-sm text-ink-muted">
        <p>
          {profile.full_name} · {profile.role.display_name}
          {cancelled > 0 && (
            <span className="ml-3">
              {cancelled} cancelled {cancelled === 1 ? "row" : "rows"} hidden
            </span>
          )}
        </p>

        <form action={signOut}>
          <button
            type="submit"
            className="underline underline-offset-4 transition-colors hover:text-ink"
          >
            Sign out
          </button>
        </form>
      </footer>
    </div>
  );
}
