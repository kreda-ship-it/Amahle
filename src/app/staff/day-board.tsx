"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { STATUSES, statusMeta, type StatusKey } from "@/lib/appointments/status";
import { salonTime } from "@/lib/site/datetime";

import { applyStatuses, type StatusChange } from "./actions";

/**
 * The day, and marking it up.
 *
 * The reading half of this used to be the whole page. What is new is the
 * writing half: until now nothing in the system could move an appointment off
 * `pending`, so every booking ever taken sat there.
 *
 * THE HIGHLIGHTER. Choose a status from the key, then tap appointments to give
 * it to them. That shape is chosen for the day before, which is what this is
 * actually for: the salon rings ten people and marks the eight who answered.
 * A dropdown on each row would be ten dropdowns and thirty taps.
 *
 * UNDO RATHER THAN A CONFIRM DIALOG. A confirmation on every tap would destroy
 * the speed the highlighter exists for, and the tap is only ever one status
 * that a second tap can put back. So marking is immediate and reversible for a
 * few seconds, which protects the mis-tap without taxing the ninety-nine taps
 * that were correct.
 */

/* One shared empty object, so "nothing is pending" is the same reference on
   every render. A fresh `{}` would change identity each time and rebuild the
   whole day below it. */
const NOTHING_PENDING: Record<string, string> = {};

export type Row = {
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

type Props = {
  rows: Row[];
  timezone: string;
  /** Whether this person may change a status at all. Comes from can(). */
  canManage: boolean;
};

export function DayBoard({ rows, timezone, canManage }: Props) {
  const [brush, setBrush] = useState<StatusKey | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [undoable, setUndoable] = useState<StatusChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  /*
   * What has been marked but not yet come back from the server, keyed by the
   * rows it was marked against. Same trick as the booking form: when the
   * server sends a fresh day the key stops matching and the local guesses drop
   * themselves, so there is nothing to clear and no way to mask somebody
   * else's change for longer than one round trip.
   */
  const rowsKey = useMemo(
    () => rows.map((row) => `${row.id}:${row.status}`).join(","),
    [rows],
  );

  const [pendingFor, setPendingFor] = useState<{
    key: string;
    map: Record<string, string>;
  } | null>(null);

  const overrides = useMemo(
    () => (pendingFor?.key === rowsKey ? pendingFor.map : NOTHING_PENDING),
    [pendingFor, rowsKey],
  );

  const statusOf = (row: Row) => overrides[row.id] ?? row.status;

  /* The undo strip is offered for a few seconds and then withdrawn. Long
     enough to catch a mis-tap, short enough that it is never mistaken for a
     permanent control. */
  useEffect(() => {
    if (!undoable) return;

    const timer = setTimeout(() => setUndoable(null), 8000);

    return () => clearTimeout(timer);
  }, [undoable]);

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          showEnded ||
          statusMeta(overrides[row.id] ?? row.status).holdsTheSlot,
      ),
    [rows, showEnded, overrides],
  );

  const endedCount = rows.filter(
    (row) => !statusMeta(statusOf(row)).holdsTheSlot,
  ).length;

  /*
   * One entry per person who has something on, in the order the salon lists
   * them. An employee with an empty day is not shown: this is a working
   * screen, not a roster.
   */
  const byEmployee = useMemo(() => {
    const map = new Map<string, { name: string; rows: Row[] }>();

    for (const row of visible) {
      const id = row.employee?.id ?? "unassigned";
      const entry = map.get(id);

      if (entry) entry.rows.push(row);
      else
        map.set(id, {
          name: row.employee?.full_name ?? "Nobody assigned",
          rows: [row],
        });
    }

    return [...map.values()];
  }, [visible]);

  /*
   * A short mark per visit — A, B, C — so the same customer's founding and
   * finishing can be recognised as one job across two columns. The visit id is
   * a UUID and unreadable; what the desk needs is "these two are the same
   * head".
   */
  const visitMark = useMemo(() => {
    const marks = new Map<string, string>();

    for (const row of visible) {
      if (!marks.has(row.visit_id)) {
        const n = marks.size;
        marks.set(
          row.visit_id,
          String.fromCharCode(65 + (n % 26)) +
            (n >= 26 ? String(Math.floor(n / 26)) : ""),
        );
      }
    }

    return marks;
  }, [visible]);

  function mark(row: Row) {
    if (!brush || !canManage) return;

    const was = statusOf(row);
    if (was === brush) return;

    setError(null);
    setUndoable([{ id: row.id, status: was }]);

    // A cancelled row would otherwise vanish under the finger that marked it,
    // taking the undo strip's context with it.
    if (!statusMeta(brush).holdsTheSlot) setShowEnded(true);

    setPendingFor((current) => ({
      key: rowsKey,
      map: {
        ...(current?.key === rowsKey ? current.map : {}),
        [row.id]: brush,
      },
    }));

    startSaving(async () => {
      const result = await applyStatuses([{ id: row.id, status: brush }]);
      if (!result.ok) setError(result.message);
    });
  }

  function undo() {
    if (!undoable) return;

    const changes = undoable;
    setUndoable(null);
    setError(null);

    setPendingFor((current) => ({
      key: rowsKey,
      map: {
        ...(current?.key === rowsKey ? current.map : {}),
        ...Object.fromEntries(changes.map((c) => [c.id, c.status])),
      },
    }));

    startSaving(async () => {
      const result = await applyStatuses(changes);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      {/* ---------- the key, which is also the highlighter ---------- */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line pb-4">
        {canManage && (
          <span className="label text-ink-muted">
            {brush ? "Tap to mark" : "Pick a status"}
          </span>
        )}

        {STATUSES.map((status) => {
          const active = brush === status.key;

          return (
            <button
              key={status.key}
              type="button"
              disabled={!canManage}
              aria-pressed={canManage ? active : undefined}
              onClick={() => setBrush(active ? null : status.key)}
              className={`flex items-center gap-2 border px-2 py-1 text-sm transition-colors ${
                active
                  ? "border-ink bg-surface-sunk"
                  : "border-transparent hover:border-line"
              } ${canManage ? "" : "cursor-default"}`}
            >
              {/*
                The mark carries the colour; the word carries the meaning. One
                man in twelve cannot reliably tell red from green, so the
                colour is never asked to say anything on its own.
              */}
              <span
                aria-hidden
                className="size-3 shrink-0"
                style={{ background: `var(${status.token})` }}
              />
              {status.label}
            </button>
          );
        })}

        {endedCount > 0 && (
          <button
            type="button"
            onClick={() => setShowEnded((current) => !current)}
            className="label ml-auto text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
          >
            {showEnded ? "Hide" : "Show"} {endedCount} cancelled
          </button>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">Nothing booked.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {byEmployee.map((person) => (
            <section key={person.name} className="border border-line">
              <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
                {person.name}
                <span className="ml-2 text-sm font-normal text-ink-muted">
                  {person.rows.length}
                </span>
              </h2>

              <ul className="divide-y divide-line">
                {person.rows.map((row) => {
                  const status = statusMeta(statusOf(row));
                  const ended = !status.holdsTheSlot;

                  const Element = brush && canManage ? "button" : "div";

                  return (
                    <li key={row.id}>
                      <Element
                        {...(brush && canManage
                          ? {
                              type: "button" as const,
                              onClick: () => mark(row),
                              "aria-label": `Mark ${row.customer?.full_name ?? "this appointment"} as ${statusMeta(brush).label}`,
                            }
                          : {})}
                        className={`block w-full px-4 py-3 text-left ${
                          brush && canManage
                            ? "cursor-pointer transition-colors hover:bg-surface-sunk"
                            : ""
                        } ${ended ? "opacity-55" : ""}`}
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span
                            className={`font-medium tabular-nums ${ended ? "line-through" : ""}`}
                          >
                            {salonTime(row.starts_at, timezone)}
                            <span className="text-ink-muted">
                              {" – "}
                              {salonTime(row.ends_at, timezone)}
                            </span>
                          </span>

                          <span className="label text-ink-muted">
                            {visitMark.get(row.visit_id)}
                          </span>
                        </div>

                        <p className={`mt-1 ${ended ? "line-through" : ""}`}>
                          {row.customer?.full_name ?? "—"}
                          {row.for_name && (
                            <span className="text-ink-muted">
                              {" · "}
                              {row.for_name}
                            </span>
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
                            request she should ask about first. DECISIONS #32.
                          */}
                          {row.employee_requested && (
                            <span className="ml-2 text-brand" title="Asked for by name">
                              ★
                            </span>
                          )}
                        </p>

                        {/* The status, on every row, always with its word. */}
                        <p className="mt-1.5 flex items-center gap-2 text-xs">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0"
                            style={{ background: `var(${status.token})` }}
                          />
                          {status.label}
                        </p>

                        {row.notes && (
                          <p className="mt-2 border-l-2 border-line pl-3 text-sm text-ink-muted">
                            {row.notes}
                          </p>
                        )}
                      </Element>

                      {/* Outside the marking target, so tapping the number
                          rings the customer rather than marking the row. */}
                      {row.customer?.phone && (
                        <a
                          href={`tel:${row.customer.phone.replace(/[^\d+]/g, "")}`}
                          className="mb-3 ml-4 inline-block text-sm text-ink-muted underline underline-offset-4"
                        >
                          {row.customer.phone}
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* ---------- undo, and anything that went wrong ---------- */}
      {(undoable || error) && (
        <div className="sticky bottom-4 mx-auto flex items-center gap-4 border border-ink bg-surface px-4 py-2.5 text-sm shadow-lg">
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
