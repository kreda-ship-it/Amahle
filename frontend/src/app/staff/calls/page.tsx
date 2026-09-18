import type { Metadata } from "next";
import Link from "next/link";

import { can, requireProfile } from "@/lib/auth";
import {
  salonDateKey,
  salonDayLabelLong,
  salonDayRange,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { CallList, type Call, type CallRow } from "./call-list";

/**
 * Tomorrow's calls.
 *
 * The salon rings its customers the day before to reconfirm. It already does
 * this; what it does not have is the list, which today means reading down a
 * paper diary. This is that list, making itself.
 *
 * WHY THIS AND NOT AN AUTOMATED TEXT. DECISIONS #29: US carriers require A2P
 * 10DLC registration before business texts are delivered reliably, and
 * unregistered traffic is silently filtered rather than rejected — so the
 * failure mode is believing it works. That is a multi-week external dependency
 * bought to automate something the salon already does well. This costs nothing
 * and works the same afternoon it ships.
 *
 * It also gives `confirmed` its first meaning. Until the calendar existed
 * nothing could move an appointment off `pending`; until this screen, nothing
 * performed the act the status describes.
 *
 * Defaults to tomorrow because that is the job, and takes `?date=` because the
 * day before a public holiday is two days out.
 */

export const metadata: Metadata = {
  title: "Tomorrow's calls",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function shiftDays(dateKey: string, by: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const when = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + by));

  return when.toISOString().slice(0, 10);
}

type Fetched = CallRow & {
  visit_id: string;
  for_name: string | null;
  notes: string | null;
  customer: { full_name: string; phone: string } | null;
};

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* The page guards itself — a layout is not re-run between pages that share
     it, and proxy.ts deliberately guards nothing. */
  await requireProfile();

  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const mayManage = await can("appointment.manage");
  const today = salonDateKey(new Date(), org.timezone);
  const tomorrow = shiftDays(today, 1);

  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : tomorrow;

  const { from, to } = salonDayRange(day, org.timezone);

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, visit_id, starts_at, status, for_name, notes,
       employee:employees (full_name),
       service:services (name, is_included_with_others),
       customer:customers (full_name, phone)`,
    )
    .gte("starts_at", from)
    .lt("starts_at", to)
    .is("deleted_at", null)
    .order("starts_at");

  const rows = (data ?? []) as unknown as Fetched[];

  /*
   * One call per visit. A braid is a founding and one or two finishings
   * sharing a visit_id, and ringing the same woman three times is how a member
   * of staff decides the software is not worth using.
   *
   * A no-show is left out — there is nobody to ring about an appointment
   * whose customer already failed to arrive — but cancelled visits stay, so
   * somebody cancelled by mistake can be seen and put back.
   */
  const byVisit = new Map<string, Call>();

  for (const row of rows) {
    if (row.status === "no_show") continue;

    const existing = byVisit.get(row.visit_id);

    if (existing) {
      existing.rows.push(row);
      continue;
    }

    byVisit.set(row.visit_id, {
      visitId: row.visit_id,
      customerName: row.customer?.full_name ?? "—",
      phone: row.customer?.phone ?? null,
      forName: row.for_name,
      notes: row.notes,
      rows: [row],
    });
  }

  const calls = [...byVisit.values()];

  return (
    <div className="flex flex-col gap-5 p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="label text-ink-muted">
            {day === tomorrow ? "Tomorrow" : "The round for"}
          </p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {salonDayLabelLong(day)}
          </h1>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/staff/calls?date=${shiftDays(day, -1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &larr;
          </Link>
          {day !== tomorrow && (
            <Link
              href="/staff/calls"
              className="border border-line px-3 py-2 transition-colors hover:border-ink"
            >
              Tomorrow
            </Link>
          )}
          <Link
            href={`/staff/calls?date=${shiftDays(day, 1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &rarr;
          </Link>
        </div>
      </header>

      {error ? (
        <p className="text-ink-muted">
          The list could not be loaded. {error.message}
        </p>
      ) : (
        <CallList
          calls={calls}
          timezone={org.timezone}
          canManage={mayManage}
        />
      )}
    </div>
  );
}
