import type { Metadata } from "next";
import Link from "next/link";

import { can } from "@/lib/auth";
import { salonDateKey, salonDayLabelLong, salonTime } from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The salon's day.
 *
 * The screen that stays open, so it answers the questions somebody at the desk
 * actually has: who is with whom, who is free, what is coming.
 *
 * WHAT MAKES THIS MORE THAN A LIST. Since migration 033 one braid is two or
 * three rows across two or three people — a stylist founds it, an assistant
 * finishes it. Shown flat, one customer looks like three bookings and the day
 * looks twice as busy as it is. So every visit carries a short mark and the
 * phase is on the face of the row.
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

type Row = {
  id: string;
  visit_id: string;
  starts_at: string;
  ends_at: string;
  phase: string;
  status: string;
  employee_requested: boolean;
  for_name: string | null;
  notes: string | null;
  employee: { id: string; full_name: string } | null;
  service: { name: string } | null;
  customer: { full_name: string; phone: string } | null;
};

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
  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const seesEverything = await can("appointment.view_all");
  const today = salonDateKey(new Date(), org.timezone);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : today;

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, visit_id, starts_at, ends_at, phase, status, employee_requested,
       for_name, notes,
       employee:employees (id, full_name),
       service:services (name),
       customer:customers (full_name, phone)`,
    )
    .gte("starts_at", new Date(`${day}T00:00:00`).toISOString())
    .lte("starts_at", new Date(`${day}T23:59:59`).toISOString())
    .order("starts_at");

  const rows = (data ?? []) as unknown as Row[];
  const live = rows.filter(
    (row) => row.status !== "cancelled" && row.status !== "no_show",
  );

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
   * A letter per visit, so the same customer's founding and finishing can be
   * recognised as one job across two columns. The visit id is a UUID and
   * unreadable; what the desk needs is "these two are the same head".
   */
  const mark = new Map<string, string>();
  for (const row of live) {
    if (!mark.has(row.visit_id)) {
      mark.set(row.visit_id, String.fromCharCode(65 + (mark.size % 26)));
    }
  }

  const hidden = rows.length - live.length;

  return (
    <div className="p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-ink-muted">
            {seesEverything ? "The whole salon" : "Your day"}
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {salonDayLabelLong(day)}
          </h1>
        </div>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href={`/staff/day?date=${shiftDay(day, -1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &larr;
          </Link>
          <Link
            href="/staff/day"
            className={`border border-line px-3 py-2 transition-colors hover:border-ink ${
              day === today ? "bg-surface-sunk" : ""
            }`}
          >
            Today
          </Link>
          <Link
            href={`/staff/day?date=${shiftDay(day, 1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &rarr;
          </Link>
        </nav>
      </header>

      <p className="mt-4 border-y border-line py-3 text-sm text-ink-muted">
        {live.length} {live.length === 1 ? "appointment" : "appointments"}
        {" · "}
        {byEmployee.size} {byEmployee.size === 1 ? "person" : "people"} working
        {hidden > 0 && ` · ${hidden} cancelled, hidden`}
      </p>

      {error ? (
        <p className="py-12 text-ink-muted">
          The day could not be loaded. {error.message}
        </p>
      ) : live.length === 0 ? (
        <p className="py-16 text-center text-ink-muted">
          Nothing booked{day === today ? " today" : " that day"}.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {[...byEmployee.values()].map((person) => (
            <section key={person.name} className="border border-line bg-surface">
              <h2 className="flex items-baseline justify-between border-b border-line bg-surface-sunk px-4 py-2.5">
                <span className="font-medium">{person.name}</span>
                <span className="text-sm text-ink-muted tabular-nums">
                  {person.rows.length}
                </span>
              </h2>

              <ul className="divide-y divide-line">
                {person.rows.map((row) => (
                  <li key={row.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-medium tabular-nums">
                        {salonTime(row.starts_at, org.timezone)}
                        <span className="font-normal text-ink-muted">
                          {" – "}
                          {salonTime(row.ends_at, org.timezone)}
                        </span>
                      </span>
                      <span
                        className="label text-ink-muted"
                        title="Same letter, same visit"
                      >
                        {mark.get(row.visit_id)}
                      </span>
                    </div>

                    <p className="mt-1.5 flex items-center gap-1.5">
                      <span>{row.customer?.full_name ?? "—"}</span>
                      {/*
                        A star means the customer asked for this person by
                        name. An assignment may be moved without asking; a
                        request should be checked first. DECISIONS #32.
                      */}
                      {row.employee_requested && (
                        <span className="text-brand" title="Asked for by name">
                          ★
                        </span>
                      )}
                      {row.for_name && (
                        <span className="text-sm text-ink-muted">
                          for {row.for_name}
                        </span>
                      )}
                    </p>

                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      <span>{row.service?.name}</span>
                      {row.phase === "finish" && (
                        <span className="border border-line px-1.5 text-xs">
                          finishing
                        </span>
                      )}
                    </p>

                    {row.customer?.phone && (
                      <a
                        href={`tel:${row.customer.phone.replace(/[^\d+]/g, "")}`}
                        className="mt-1.5 inline-block text-sm text-ink-muted underline underline-offset-4 hover:text-ink"
                      >
                        {row.customer.phone}
                      </a>
                    )}

                    {row.notes && (
                      <p className="mt-2 border-l-2 border-brand/40 pl-3 text-sm text-ink-muted">
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
    </div>
  );
}
