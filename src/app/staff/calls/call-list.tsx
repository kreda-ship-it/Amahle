"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { statusMeta } from "@/lib/appointments/status";
import { salonTime } from "@/lib/site/datetime";

import { applyStatuses, type StatusChange } from "../actions";

/**
 * The day-before call round.
 *
 * DECISIONS #29 says nothing is sent to a customer automatically in v1: the
 * salon rings or texts by hand from the number it already uses, as it does
 * today. This is not a replacement for that — it is that, with the list
 * making itself and the answer being recorded.
 *
 * It is also what finally gives `confirmed` a meaning. `pending` and
 * `confirmed` were never "maybe" and "yes" — every appointment holds its slot
 * from the moment it exists. They track whether the salon has reconfirmed with
 * the customer, and until this screen nothing could perform that act.
 *
 * ONE ENTRY PER VISIT, NOT PER ROW. A braid is a founding and one or two
 * finishings sharing a `visit_id`. Listing rows would have the receptionist
 * ring the same woman three times, which is exactly the sort of thing that
 * makes people put the software down.
 *
 * TWO LISTS, NOT A FILTER. The job is a worklist, and a worklist you can watch
 * empty is a different experience from a list with a toggle on it.
 */

export type CallRow = {
  id: string;
  status: string;
  starts_at: string;
  employee: { full_name: string } | null;
  service: { name: string; is_included_with_others: boolean } | null;
};

export type Call = {
  visitId: string;
  customerName: string;
  phone: string | null;
  forName: string | null;
  notes: string | null;
  rows: CallRow[];
};

const NOTHING_PENDING: Record<string, string> = {};

/** `(301) 495-0114` has to become something a phone can dial. */
function dial(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");

  return digits.startsWith("+") ? digits : digits.replace(/\+/g, "");
}

export function CallList({
  calls,
  timezone,
  canManage,
}: {
  calls: Call[];
  timezone: string;
  canManage: boolean;
}) {
  const [undoable, setUndoable] = useState<StatusChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  /* Same trick as the grid: what has been marked but not yet come back from
     the server, tagged with the data it was marked against, so a fresh answer
     drops the guesses rather than anything having to clear them. */
  const callsKey = useMemo(
    () =>
      calls
        .map((call) => `${call.visitId}:${call.rows.map((r) => r.status).join("/")}`)
        .join(","),
    [calls],
  );

  const [pendingFor, setPendingFor] = useState<{
    key: string;
    map: Record<string, string>;
  } | null>(null);

  const overrides = useMemo(
    () => (pendingFor?.key === callsKey ? pendingFor.map : NOTHING_PENDING),
    [pendingFor, callsKey],
  );

  useEffect(() => {
    if (!undoable) return;

    const timer = setTimeout(() => setUndoable(null), 8000);

    return () => clearTimeout(timer);
  }, [undoable]);

  /* A visit's status is its first row's — they move together, and the phase
     rows of one braid are never in different states. */
  const statusOf = (call: Call) =>
    overrides[call.rows[0]!.id] ?? call.rows[0]!.status;

  const outstanding = calls.filter((call) => statusOf(call) === "pending");
  const settled = calls.filter((call) => statusOf(call) !== "pending");

  function set(call: Call, status: string) {
    if (!canManage) return;

    const changes = call.rows.map((row) => ({ id: row.id, status }));
    const previous = call.rows.map((row) => ({
      id: row.id,
      status: overrides[row.id] ?? row.status,
    }));

    setError(null);
    setUndoable(previous);

    setPendingFor((current) => ({
      key: callsKey,
      map: {
        ...(current?.key === callsKey ? current.map : {}),
        ...Object.fromEntries(changes.map((c) => [c.id, c.status])),
      },
    }));

    startSaving(async () => {
      const result = await applyStatuses(changes);
      if (!result.ok) setError(result.message);
    });
  }

  function undo() {
    if (!undoable) return;

    const changes = undoable;
    setUndoable(null);
    setError(null);

    setPendingFor((current) => ({
      key: callsKey,
      map: {
        ...(current?.key === callsKey ? current.map : {}),
        ...Object.fromEntries(changes.map((c) => [c.id, c.status])),
      },
    }));

    startSaving(async () => {
      const result = await applyStatuses(changes);
      if (!result.ok) setError(result.message);
    });
  }

  const entry = (call: Call) => {
    const status = statusMeta(statusOf(call));
    const first = call.rows[0]!;

    /* The headline style, so a braid does not read as "Wash and blow dry".
       Same rule as the grid: the wash is free beside other work. */
    const style =
      call.rows.find((row) => row.service && !row.service.is_included_with_others)
        ?.service?.name ??
      first.service?.name ??
      "—";

    return (
      <li
        key={call.visitId}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
      >
        <span className="w-16 shrink-0 font-medium tabular-nums">
          {salonTime(first.starts_at, timezone)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="font-medium">{call.customerName}</span>
          {call.forName && (
            <span className="text-ink-muted"> · {call.forName}</span>
          )}
          <span className="block text-sm text-ink-muted">
            {style}
            {first.employee && ` · ${first.employee.full_name}`}
          </span>
          {call.notes && (
            <span className="block text-sm text-ink-muted">{call.notes}</span>
          )}
        </span>

        {/* Ringing and texting are the point of the screen, so they are the
            two biggest things on the row and they are real links — a tap on a
            phone opens the dialler with the number already in it. */}
        {call.phone ? (
          <span className="flex shrink-0 gap-2">
            <a
              href={`tel:${dial(call.phone)}`}
              className="border border-line px-3 py-2 text-sm transition-colors hover:border-ink"
            >
              Call
            </a>
            <a
              href={`sms:${dial(call.phone)}`}
              className="border border-line px-3 py-2 text-sm transition-colors hover:border-ink"
            >
              Text
            </a>
          </span>
        ) : (
          <span className="shrink-0 text-sm text-ink-muted">No number</span>
        )}

        {canManage ? (
          <span className="flex shrink-0 gap-2">
            {statusOf(call) === "pending" ? (
              <>
                <button
                  type="button"
                  onClick={() => set(call, "confirmed")}
                  className="border border-brand bg-brand px-3 py-2 text-sm text-ink-inverse transition-colors hover:bg-brand-strong"
                >
                  Confirmed
                </button>
                <button
                  type="button"
                  onClick={() => set(call, "cancelled")}
                  className="border border-line px-3 py-2 text-sm text-ink-muted transition-colors hover:border-ink hover:text-ink"
                >
                  Cancelled
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => set(call, "pending")}
                className="flex items-center gap-2 border border-line px-3 py-2 text-sm transition-colors hover:border-ink"
                title="Put it back on the list"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0"
                  style={{ background: `var(${status.token})` }}
                />
                {status.label}
              </button>
            )}
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2 text-sm">
            <span
              aria-hidden
              className="size-2.5 shrink-0"
              style={{ background: `var(${status.token})` }}
            />
            {status.label}
          </span>
        )}
      </li>
    );
  };

  return (
    <>
      <section>
        <h2 className="label border-b border-line pb-2 text-ink">
          Still to ring
          <span className="ml-2 text-ink-muted">{outstanding.length}</span>
        </h2>

        {outstanding.length === 0 ? (
          <p className="py-6 text-ink-muted">
            {calls.length === 0
              ? "Nothing booked that day."
              : "Everybody has been rung."}
          </p>
        ) : (
          <ul className="divide-y divide-line">{outstanding.map(entry)}</ul>
        )}
      </section>

      {settled.length > 0 && (
        <section className="mt-8">
          <h2 className="label border-b border-line pb-2 text-ink">
            Done
            <span className="ml-2 text-ink-muted">{settled.length}</span>
          </h2>
          <ul className="divide-y divide-line opacity-70">
            {settled.map(entry)}
          </ul>
        </section>
      )}

      {(undoable || error) && (
        <div className="sticky bottom-4 mx-auto mt-6 flex w-fit items-center gap-4 border border-ink bg-surface px-4 py-2.5 text-sm shadow-lg">
          {error ? (
            <span role="alert" className="text-brand">
              {error}
            </span>
          ) : (
            <>
              <span>{saving ? "Saving…" : "Marked"}</span>
              <button
                type="button"
                onClick={undo}
                className="underline underline-offset-4 transition-colors hover:text-brand"
              >
                Undo
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
