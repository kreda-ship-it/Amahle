import type { Metadata } from "next";
import Link from "next/link";

import { can, requireProfile } from "@/lib/auth";
import {
  salonDateKey,
  salonDayLabelLong,
  salonDayRange,
  salonTime,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Where the staff area opens.
 *
 * Operational, not analytical. Takings, trends and busiest-stylist charts are
 * the analytics dashboard PROJECT.md rules out of v1 — this answers the three
 * questions somebody actually has on walking in: how busy is today, who is in
 * a chair right now, and what is next.
 *
 * Everything here is a count of the same rows the day view shows, and it is
 * scoped by the same row-level security. A stylist sees their own day summed
 * up; a receptionist sees the salon's.
 */

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  phase: string;
  status: string;
  employee: { full_name: string } | null;
  service: { name: string } | null;
  customer: { full_name: string } | null;
};

export default async function StaffDashboard() {
  const profile = await requireProfile();
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const mayBook = await can("appointment.create");

  const today = salonDateKey(new Date(), org.timezone);
  const { from, to } = salonDayRange(today, org.timezone);

  const { data } = await supabase
    .from("appointments")
    .select(
      `id, starts_at, ends_at, phase, status,
       employee:employees (full_name),
       service:services (name),
       customer:customers (full_name)`,
    )
    .gte("starts_at", from)
    .lt("starts_at", to)
    /* A row tidied away is a mistake being removed — a double entry, a
       booking taken against the wrong customer. Every other appointment
       query in the staff area filters it out, and this one used not to, so
       the dashboard and the day view disagreed about how busy today was. */
    .is("deleted_at", null)
    .order("starts_at");

  const rows = ((data ?? []) as unknown as Row[]).filter(
    (row) => row.status !== "cancelled" && row.status !== "no_show",
  );

  // Per-request, deliberately: what is happening right now is the question.
  const now = new Date().getTime();
  const inChair = rows.filter(
    (row) =>
      new Date(row.starts_at).getTime() <= now &&
      new Date(row.ends_at).getTime() > now,
  );
  const next = rows.filter((row) => new Date(row.starts_at).getTime() > now);

  /*
   * Visits, not rows. One braid is a founding and a finishing, and counting
   * rows would tell the owner the salon is twice as busy as it is.
   */
  const customers = new Set(rows.map((row) => row.customer?.full_name)).size;

  return (
    <div className="p-5 lg:p-8">
      <header>
        <p className="label text-ink-muted">
          {profile.full_name} · {profile.role.display_name}
        </p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">
          {salonDayLabelLong(today)}
        </h1>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {[
          { label: "Customers today", value: customers },
          { label: "In a chair now", value: inChair.length },
          { label: "Still to come", value: next.length },
        ].map((stat) => (
          <div key={stat.label} className="border border-line p-5">
            <p className="label text-ink-muted">{stat.label}</p>
            <p className="mt-2 font-display text-4xl tabular-nums">
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          href="/staff/day"
          className="bg-brand px-6 py-3 text-sm font-medium text-ink-inverse transition-colors hover:bg-brand-strong"
        >
          Open the day
        </Link>
        {/* `nav.ts` dims what is not built so the salon is never taught that
            pressing things does nothing. This said "soon" long after the form
            shipped, which teaches the same lesson backwards. */}
        {mayBook && (
          <Link
            href="/staff/book"
            className="border border-line px-6 py-3 text-sm transition-colors hover:border-ink"
          >
            Take a booking
          </Link>
        )}
      </div>

      <section className="mt-10">
        <h2 className="label border-b border-line pb-2 text-ink">
          {inChair.length > 0 ? "In a chair now" : "Nobody in a chair"}
        </h2>

        {inChair.length > 0 && (
          <ul className="divide-y divide-line">
            {inChair.map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-4 py-3">
                <span className="w-28 shrink-0 tabular-nums text-ink-muted">
                  until {salonTime(row.ends_at, org.timezone)}
                </span>
                <span className="font-medium">{row.customer?.full_name}</span>
                <span className="text-ink-muted">
                  {row.service?.name} · {row.employee?.full_name}
                  {row.phase === "finish" && " · finishing"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="label border-b border-line pb-2 text-ink">Next up</h2>

        {next.length === 0 ? (
          <p className="py-6 text-ink-muted">Nothing else booked today.</p>
        ) : (
          <ul className="divide-y divide-line">
            {next.slice(0, 6).map((row) => (
              <li key={row.id} className="flex flex-wrap gap-x-4 py-3">
                <span className="w-28 shrink-0 font-medium tabular-nums">
                  {salonTime(row.starts_at, org.timezone)}
                </span>
                <span>{row.customer?.full_name}</span>
                <span className="text-ink-muted">
                  {row.service?.name} · {row.employee?.full_name}
                  {row.phase === "finish" && " · finishing"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
