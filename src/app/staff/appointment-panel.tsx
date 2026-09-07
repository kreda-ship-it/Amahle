"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { statusMeta } from "@/lib/appointments/status";
import { salonDayLabelLong, salonDateKey, salonTime } from "@/lib/site/datetime";
import { formatMoney } from "@/lib/site/pricing";

import { loadVisitOptions, type ChosenOption } from "./appointment-actions";
import type { Row } from "./day-grid";

/**
 * One booking, opened.
 *
 * WHAT WAS WRONG WITHOUT IT. `notes` was fetched by the day, week and plan
 * queries and rendered nowhere at all, and clicking a block with no status
 * selected did nothing. So the price, the answers the customer gave, the note
 * the receptionist typed and the customer's own record were all invisible from
 * the screen that stays open all day — and the only way to read a note was to
 * query the database.
 *
 * A VISIT, NOT A ROW. Since migration 033 a braid is a founding and one or
 * more finishings across two or three people. Opening one and being shown a
 * third of it, with a price of zero because you happened to click the
 * assistant's row, is worse than not opening it.
 *
 * NO BACKDROP, DELIBERATELY. A dimmed calendar behind an open booking is the
 * wrong shape for this screen: the reason to open one is usually to compare it
 * with what is around it. It closes on Escape, on the X, and by opening
 * another.
 *
 * READ-ONLY FOR NOW. Cancelling with a reason needs three columns that are
 * still waiting on a migration, and a half-built action bar teaches people the
 * buttons do not work.
 */

type Props = {
  /** Every row of the visit, in start order. */
  rows: Row[];
  timezone: string;
  currency: string;
  onClose: () => void;
};

export function AppointmentPanel({ rows, timezone, currency, onClose }: Props) {
  const [options, setOptions] = useState<{
    key: string;
    list: ChosenOption[];
  } | null>(null);

  const key = rows.map((row) => row.id).join(",");

  useEffect(() => {
    let live = true;

    loadVisitOptions(key.split(",")).then((list) => {
      if (live) setOptions({ key, list });
    });

    return () => {
      live = false;
    };
  }, [key]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const first = rows[0];
  if (!first) return null;

  const last = rows[rows.length - 1]!;
  const status = statusMeta(first.status);
  const customer = first.customer;

  /* The whole visit's money. `finish` rows carry zero by design, so this is
     the sum rather than the first row's price. */
  const total = rows.reduce((sum, row) => sum + Number(row.price ?? 0), 0);

  const chosen = options?.key === key ? options.list : null;

  return (
    <aside
      /* z-30 is the ceiling for anything inside a screen — the shell's drawer
         sits above at z-50. Rendered after the grid, so it wins the tie on
         document order without breaking the rule. */
      className="fixed inset-x-0 bottom-0 z-30 flex max-h-[75vh] flex-col overflow-y-auto border-t border-line bg-surface shadow-lg lg:inset-y-0 lg:right-0 lg:left-auto lg:max-h-none lg:w-[23rem] lg:border-t-0 lg:border-l"
      aria-label="Appointment"
    >
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          {customer ? (
            <Link
              href={`/staff/customers/${customer.id}`}
              className="font-display text-xl underline underline-offset-4 transition-colors hover:text-brand"
            >
              {customer.full_name}
            </Link>
          ) : (
            <p className="font-display text-xl">Nobody attached</p>
          )}

          {first.for_name && (
            <p className="text-sm text-ink-muted">for {first.for_name}</p>
          )}

          {customer && (
            <a
              href={`tel:${customer.phone}`}
              className="text-sm tabular-nums text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
            >
              {customer.phone}
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="flex flex-col gap-4 px-4 py-4">
        <div>
          <p className="label text-ink-muted">When</p>
          <p className="mt-0.5">
            {salonDayLabelLong(salonDateKey(first.starts_at, timezone))}
          </p>
          <p className="tabular-nums">
            {salonTime(first.starts_at, timezone)} –{" "}
            {salonTime(last.ends_at, timezone)}
          </p>
          {/* The cleanup gap is why two blocks that look adjacent are refused
              as overlapping, so it is worth saying out loud. */}
          {last.blocked_until !== last.ends_at && (
            <p className="text-sm text-ink-muted">
              Station free at {salonTime(last.blocked_until, timezone)}
            </p>
          )}
        </div>

        <div>
          <p className="label text-ink-muted">
            {rows.length > 1 ? "What, and who" : "What"}
          </p>

          <ul className="mt-1 flex flex-col gap-2">
            {rows.map((row) => {
              const forRow = chosen?.filter(
                (option) => option.appointment_id === row.id,
              );

              return (
                <li key={row.id}>
                  <p>
                    {row.service?.name ?? "—"}
                    {row.phase === "finish" && (
                      <span className="text-ink-muted"> · finishing</span>
                    )}
                  </p>

                  <p className="text-sm text-ink-muted">
                    {row.employee?.full_name ?? "Unassigned"}
                    {row.employee_requested && (
                      <span className="text-brand" title="Asked for by name">
                        {" ★"}
                      </span>
                    )}
                  </p>

                  {forRow && forRow.length > 0 && (
                    <ul className="mt-0.5 text-sm text-ink-muted">
                      {forRow.map((option, index) => (
                        <li key={`${option.group_name}-${index}`}>
                          {option.group_name}: {option.option_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {chosen === null && (
            <p className="mt-1 text-sm text-ink-muted">Loading the answers…</p>
          )}
        </div>

        <div className="flex items-baseline justify-between border-t border-line pt-3">
          <span className="label text-ink-muted">Price</span>
          <span className="tabular-nums">{formatMoney(total, currency)}</span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="label text-ink-muted">Status</span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 shrink-0"
              style={{ background: `var(${status.token})` }}
            />
            {status.label}
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="label text-ink-muted">Booked</span>
          <span>{first.source === "online" ? "Online" : "At the salon"}</span>
        </div>

        {/* The whole reason the column was being fetched. */}
        {first.notes && (
          <div className="border-t border-line pt-3">
            <p className="label text-ink-muted">Notes</p>
            <p className="mt-1 whitespace-pre-line">{first.notes}</p>
          </div>
        )}

        <p className="border-t border-line pt-3 text-sm text-ink-muted">
          To move it, drag it on the calendar. To cancel, pick Cancelled from
          the status key and tap it.
        </p>
      </div>
    </aside>
  );
}
