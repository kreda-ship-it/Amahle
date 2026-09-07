import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { can, requirePermission } from "@/lib/auth";
import { getCustomerRecord } from "@/lib/customers/record";
import { statusMeta } from "@/lib/appointments/status";
import { salonDayLabel, salonDateKey, salonTime } from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { formatMoney } from "@/lib/site/pricing";

/**
 * One customer.
 *
 * WHERE DECISIONS #9 FINALLY REACHES A SCREEN. Allergies, sensitivities and a
 * hair formula live in their own table behind `customer.view_sensitive`;
 * every flag carries its own `min_permission`. The database returns only what
 * this reader may have, so nothing on this page decides that.
 *
 * WHAT THE PAGE DOES DECIDE is what SILENCE means. An empty care-notes result
 * and a forbidden one are identical from a query — a receptionist gets no rows
 * for exactly the same reason a customer with no allergies does. Printing "no
 * allergies recorded" for both is how a stylist eventually trusts a blank that
 * only ever meant "not for you". So the page asks `can()` separately, and says
 * which kind of silence it is looking at.
 */

export const metadata: Metadata = {
  title: "Customer",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("customer.view");

  const { id } = await params;
  const org = await getOrganization();

  const [record, maySeeCare] = await Promise.all([
    getCustomerRecord(org.id, id),
    can("customer.view_sensitive"),
  ]);

  /* Not found and not permitted look the same here, deliberately. Row-level
     security returns nothing either way, and a page that told the difference
     would confirm the customer exists to somebody who may not know that. */
  if (!record) notFound();

  const kept = record.visits.filter(
    (visit) => statusMeta(visit.status).holdsTheSlot,
  );

  const spent = kept.reduce((total, visit) => total + visit.total, 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6 p-5 lg:p-8">
      <div>
        <Link
          href="/staff/customers"
          className="label text-ink-muted transition-colors hover:text-ink"
        >
          &larr; All customers
        </Link>
      </div>

      <header className="border-b border-line pb-5">
        <h1 className="font-display text-3xl lg:text-4xl">
          {record.full_name}
        </h1>

        <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
          <a
            href={`tel:${record.phone}`}
            className="tabular-nums underline underline-offset-4 transition-colors hover:text-brand"
          >
            {record.phone}
          </a>

          {record.email && (
            <a
              href={`mailto:${record.email}`}
              className="text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
            >
              {record.email}
            </a>
          )}

          {record.preferred && (
            <span className="text-ink-muted">Usually sees {record.preferred}</span>
          )}
        </div>

        {/* Flags first, above everything. A safety alert that has to be
            scrolled to is one somebody will meet after the appointment has
            started. Each is here only because the database let it through —
            every flag carries its own min_permission. */}
        {record.flags.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {record.flags.map((flag) => (
              <li
                key={flag.id}
                className="border border-brand px-2.5 py-1 text-sm"
                title={flag.note ?? undefined}
              >
                <span className="font-medium">
                  {flag.flag_type.replace(/_/g, " ")}
                </span>
                {flag.note && (
                  <span className="text-ink-muted"> · {flag.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Visits", value: String(kept.length) },
          { label: "Spent", value: formatMoney(spent, org.currency) },
          {
            label: "Last in",
            value:
              kept.length > 0
                ? salonDayLabel(
                    salonDateKey(kept[0]!.startsAt, org.timezone),
                  )
                : "Never",
          },
        ].map((stat) => (
          <div key={stat.label} className="border border-line p-4">
            <p className="label text-ink-muted">{stat.label}</p>
            <p className="mt-1 font-display text-2xl">{stat.value}</p>
          </div>
        ))}
      </div>

      {record.notes && (
        <section className="border border-line p-4">
          <h2 className="label text-ink-muted">Notes</h2>
          <p className="mt-1.5 whitespace-pre-line">{record.notes}</p>
        </section>
      )}

      {/* ---------- the sensitive half ---------- */}
      <section className="border border-line p-4">
        <h2 className="label border-b border-line pb-2 text-ink">
          Allergies and formula
        </h2>

        {!maySeeCare ? (
          /* NOT "nothing recorded". This reader is not allowed to know either
             way, and saying so is the only honest answer — a stylist told
             "no allergies" by a screen that simply could not look is the
             failure this whole table exists to prevent. */
          <p className="mt-3 text-ink-muted">
            You do not have access to allergies, sensitivities or formulas. Ask
            the owner or a manager.
          </p>
        ) : !record.care ? (
          <p className="mt-3 text-ink-muted">
            Nothing recorded. That is not the same as “no allergies” — ask.
          </p>
        ) : (
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              { label: "Allergies", value: record.care.allergies },
              { label: "Sensitivities", value: record.care.sensitivities },
              { label: "Hair formula", value: record.care.hair_formula },
            ].map((field) => (
              <div key={field.label}>
                <dt className="label text-ink-muted">{field.label}</dt>
                <dd className="mt-1 whitespace-pre-line">
                  {field.value || <span className="text-ink-muted">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* ---------- history ---------- */}
      <section>
        <h2 className="label border-b border-line pb-2 text-ink">
          Every visit
        </h2>

        {record.visits.length === 0 ? (
          <p className="py-6 text-ink-muted">
            Nothing booked yet. This record was made without an appointment, or
            the appointment has been removed.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {record.visits.map((visit) => {
              const status = statusMeta(visit.status);
              const ended = !status.holdsTheSlot;

              return (
                <li
                  key={visit.visitId}
                  className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3 ${
                    ended ? "opacity-60" : ""
                  }`}
                >
                  <span className="w-32 shrink-0 tabular-nums">
                    {salonDayLabel(
                      salonDateKey(visit.startsAt, org.timezone),
                    )}
                  </span>

                  <span className="w-20 shrink-0 tabular-nums text-ink-muted">
                    {salonTime(visit.startsAt, org.timezone)}
                  </span>

                  <span className={ended ? "line-through" : "font-medium"}>
                    {visit.headline}
                    {visit.forName && (
                      <span className="font-normal text-ink-muted">
                        {" "}
                        · for {visit.forName}
                      </span>
                    )}
                  </span>

                  <span className="text-sm text-ink-muted">
                    {visit.people.join(", ")}
                  </span>

                  <span className="ml-auto flex items-baseline gap-3">
                    {/* Colour and a word, never colour alone. */}
                    <span className="flex items-center gap-1.5 text-sm">
                      <span
                        aria-hidden
                        className="size-2.5 shrink-0"
                        style={{ background: `var(${status.token})` }}
                      />
                      {status.label}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(visit.total, org.currency)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
