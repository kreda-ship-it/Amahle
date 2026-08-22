"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import type { Column } from "@/lib/appointments/columns";
import { STATUSES, statusMeta, type StatusKey } from "@/lib/appointments/status";
import { salonMinutes, salonTime } from "@/lib/site/datetime";

import { applyStatuses, type StatusChange } from "./actions";

/**
 * The day, as a grid.
 *
 * PEOPLE ACROSS, TIME DOWN — the shape every salon already reads, and the
 * shape a week view in a general calendar has: it simply swaps days for
 * stylists. A card list, which this replaces, cannot answer the question the
 * desk actually asks, which is not "what is booked" but "where is the gap".
 * A gap is a shape, and only a grid has shapes.
 *
 * THE ASSISTANTS SHARE ONE COLUMN, and it is allowed to look double-booked.
 * `create_appointment()` picks whichever assistant is free at write time, so
 * nobody is ever booked *with* a named assistant and nobody asks when one is
 * free. Eight mostly-empty stripes would push the stylists off the screen to
 * answer a question no one has.
 *
 * NO END TIME IS PRINTED. The height of a block is its length — that is what
 * a grid is for, and a printed end time is the same fact told twice, taking a
 * line from a box that has four things to say in it.
 */

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
  service: { name: string; is_included_with_others: boolean } | null;
  customer: { full_name: string; phone: string } | null;
};

type Props = {
  rows: Row[];
  columns: { stylists: Column[]; support: Column[] };
  timezone: string;
  canManage: boolean;
};

/* The salon's day, wider than its opening hours so an overrun is visible
   rather than clipped off the bottom. */
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;

const ZOOMS = [40, 60, 90, 130];
const SUPPORT = "__support__";

/* One shared empty object, so "nothing is pending" is the same reference on
   every render rather than a fresh one that rebuilds the day below it. */
const NOTHING_PENDING: Record<string, string> = {};

/** A block, once it knows where it sits and who it shares the space with. */
type Placed = {
  row: Row;
  top: number;
  height: number;
  lane: number;
  lanes: number;
};

/** The same, while it is still being packed and its end still matters. */
type Packing = Placed & { endsAt: number };

/**
 * Where the blocks go in one column.
 *
 * Overlaps are laid side by side, the way every calendar does it. In a
 * stylist's column an overlap should be impossible — the exclusion constraint
 * refuses it — so seeing one is worth the width it costs: it means a row was
 * written by something that bypassed the constraint, and hiding it would hide
 * a real fault. In the shared assistants column overlaps are the normal case,
 * and this is the whole reason the column is readable.
 *
 * CLUSTERS, NOT PAIRS. Three appointments where the first and third do not
 * touch still need three lanes if the middle one overlaps both, so lanes are
 * counted across a whole chain of overlapping blocks rather than per pair.
 * Counting pairwise is the bug that makes calendars draw events on top of one
 * another once a third is added.
 */
function place(rows: Row[], timezone: string, pxPerHour: number): Placed[] {
  const sorted = [...rows].sort(
    (a, b) =>
      salonMinutes(a.starts_at, timezone) - salonMinutes(b.starts_at, timezone),
  );

  const placed: Placed[] = [];
  let cluster: Packing[] = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length > 0) {
      const lanes = Math.max(...cluster.map((block) => block.lane)) + 1;
      for (const block of cluster) block.lanes = lanes;
      placed.push(...cluster);
    }

    cluster = [];
    clusterEnd = -1;
  };

  for (const row of sorted) {
    const from = salonMinutes(row.starts_at, timezone);
    let to = salonMinutes(row.ends_at, timezone);

    // An appointment running past midnight reads as an earlier minute than it
    // started. Clamp to the foot of the grid rather than draw it upside down.
    if (to <= from) to = DAY_END;

    if (from >= clusterEnd) flush();

    // The lowest lane nobody still in progress is occupying.
    const taken = new Set(
      cluster.filter((block) => block.endsAt > from).map((block) => block.lane),
    );

    let lane = 0;
    while (taken.has(lane)) lane++;

    cluster.push({
      row,
      top: ((from - DAY_START) / 60) * pxPerHour,
      /* A thirty-minute service at the smallest zoom is twenty pixels, and
         four lines of text need more than that. Blocks never shrink below a
         readable height; the hour lines behind them carry the true length. */
      height: Math.max(((to - from) / 60) * pxPerHour, 46),
      lane,
      lanes: 1,
      endsAt: to,
    });

    clusterEnd = Math.max(clusterEnd, to);
  }

  flush();

  return placed;
}

export function DayGrid({ rows, columns, timezone, canManage }: Props) {
  const [brush, setBrush] = useState<StatusKey | null>(null);
  const [zoom, setZoom] = useState(1);
  const [showWash, setShowWash] = useState(false);
  const [showEnded, setShowEnded] = useState(false);
  const [undoable, setUndoable] = useState<StatusChange[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const pxPerHour = ZOOMS[zoom] ?? 60;

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

  useEffect(() => {
    if (!undoable) return;

    const timer = setTimeout(() => setUndoable(null), 8000);

    return () => clearTimeout(timer);
  }, [undoable]);

  const visible = useMemo(
    () =>
      rows.filter(
        (row) =>
          showEnded || statusMeta(overrides[row.id] ?? row.status).holdsTheSlot,
      ),
    [rows, showEnded, overrides],
  );

  const endedCount = rows.filter(
    (row) => !statusMeta(overrides[row.id] ?? row.status).holdsTheSlot,
  ).length;

  /*
   * WHAT A BLOCK IS CALLED.
   *
   * The salon's wash and blow dry is free beside other work and charged when
   * it is the whole visit, and `is_included_with_others` is the flag that says
   * so. A customer having braids does not think of herself as having two
   * appointments, and two blocks labelled "Wash and blow dry" and "Knotless
   * braids" make one head look like two customers.
   *
   * So a block takes its name from the visit's headline service — the first
   * one that is not merely included — and the wash block in the assistants'
   * column reads "Knotless braids" too, which is true: that is what the wash
   * is for. Turning the filter on puts each row's own service name back.
   *
   * NOTHING IS HIDDEN. Leaving the wash off the grid would free forty-five
   * minutes of somebody's day that is not free, and a calendar that
   * understates the day is the one staff stop trusting first.
   */
  const headline = useMemo(() => {
    const byVisit = new Map<string, string>();

    for (const row of rows) {
      if (!row.service || row.service.is_included_with_others) continue;
      if (!byVisit.has(row.visit_id)) byVisit.set(row.visit_id, row.service.name);
    }

    return byVisit;
  }, [rows]);

  const label = (row: Row) =>
    showWash
      ? (row.service?.name ?? "—")
      : (headline.get(row.visit_id) ?? row.service?.name ?? "—");

  /** Everything in one column, placed. Support rows all land in the last one. */
  const laid = useMemo(() => {
    const byColumn = new Map<string, Row[]>();
    const supportIds = new Set(columns.support.map((person) => person.id));

    for (const row of visible) {
      const id = row.employee?.id;
      const column = !id ? SUPPORT : supportIds.has(id) ? SUPPORT : id;
      const list = byColumn.get(column) ?? [];
      list.push(row);
      byColumn.set(column, list);
    }

    const out = new Map<string, Placed[]>();

    for (const [column, list] of byColumn) {
      out.set(column, place(list, timezone, pxPerHour));
    }

    return out;
  }, [visible, columns.support, timezone, pxPerHour]);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = DAY_START; m <= DAY_END; m += 60) out.push(m);

    return out;
  }, []);

  const gridHeight = ((DAY_END - DAY_START) / 60) * pxPerHour;

  const heads = [
    ...columns.stylists,
    ...(columns.support.length > 0
      ? [{ id: SUPPORT, full_name: "Assistants" }]
      : []),
  ];

  function mark(row: Row) {
    if (!brush || !canManage) return;

    const was = overrides[row.id] ?? row.status;
    if (was === brush) return;

    setError(null);
    setUndoable([{ id: row.id, status: was }]);

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
              {/* The mark carries the colour; the word carries the meaning.
                  Around one man in twelve cannot reliably separate red from
                  green, so colour is never asked to say anything alone. */}
              <span
                aria-hidden
                className="size-3 shrink-0"
                style={{ background: `var(${status.token})` }}
              />
              {status.label}
            </button>
          );
        })}
      </div>

      {/* ---------- what is shown, and how big ---------- */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showWash}
            onChange={(event) => setShowWash(event.target.checked)}
          />
          <span>Show wash &amp; blow dry separately</span>
        </label>

        {endedCount > 0 && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={showEnded}
              onChange={(event) => setShowEnded(event.target.checked)}
            />
            <span>
              Show {endedCount} cancelled
            </span>
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span className="label text-ink-muted">Zoom</span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0, z - 1))}
            disabled={zoom === 0}
            aria-label="Zoom out"
            className="border border-line px-2.5 py-1 transition-colors hover:border-ink disabled:opacity-40"
          >
            &minus;
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOMS.length - 1, z + 1))}
            disabled={zoom === ZOOMS.length - 1}
            aria-label="Zoom in"
            className="border border-line px-2.5 py-1 transition-colors hover:border-ink disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* ---------- the grid ---------- */}
      {heads.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">
          Nobody is set up to take bookings yet.
        </p>
      ) : (
        <div className="overflow-x-auto border border-line">
          <div className="min-w-max">
            {/* The heading row follows you down a long day. */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface">
              <div className="w-14 shrink-0 border-r border-line" />
              {heads.map((head) => (
                <div
                  key={head.id}
                  className="w-44 shrink-0 border-r border-line px-2 py-2 text-center text-sm font-medium last:border-r-0"
                >
                  {head.full_name}
                </div>
              ))}
            </div>

            <div className="flex">
              {/* The clock down the side. */}
              <div
                className="relative w-14 shrink-0 border-r border-line"
                style={{ height: gridHeight }}
              >
                {hours.map((minute) => (
                  <span
                    key={minute}
                    className="absolute right-2 -translate-y-1/2 text-xs tabular-nums text-ink-muted"
                    style={{ top: ((minute - DAY_START) / 60) * pxPerHour }}
                  >
                    {String(Math.floor(minute / 60)).padStart(2, "0")}:00
                  </span>
                ))}
              </div>

              {heads.map((head) => (
                <div
                  key={head.id}
                  className="relative w-44 shrink-0 border-r border-line last:border-r-0"
                  style={{ height: gridHeight }}
                >
                  {/* The hour lines. Half-hours are deliberately absent — at
                      forty pixels an hour they turn the column into a ladder
                      and the blocks stop standing out from it. */}
                  {hours.map((minute) => (
                    <div
                      key={minute}
                      aria-hidden
                      className="absolute inset-x-0 border-t border-line"
                      style={{ top: ((minute - DAY_START) / 60) * pxPerHour }}
                    />
                  ))}

                  {(laid.get(head.id) ?? []).map((block) => {
                    const row = block.row;
                    const status = statusMeta(overrides[row.id] ?? row.status);
                    const ended = !status.holdsTheSlot;
                    const width = 100 / block.lanes;

                    return (
                      <button
                        key={row.id}
                        type="button"
                        onClick={() => mark(row)}
                        disabled={!brush || !canManage}
                        aria-label={`${row.customer?.full_name ?? "Appointment"}, ${label(row)}, ${salonTime(row.starts_at, timezone)}`}
                        className={`absolute overflow-hidden rounded-sm border-l-4 px-1.5 py-1 text-left text-xs leading-tight ${
                          brush && canManage
                            ? "cursor-pointer hover:brightness-95"
                            : "cursor-default"
                        } ${ended ? "opacity-50" : ""}`}
                        style={{
                          top: block.top,
                          height: block.height,
                          left: `calc(${block.lane * width}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                          /* The status colour carries the block: a tint for
                             the body, the full value on the edge. Never the
                             only signal — the status word is in the box. */
                          borderLeftColor: `var(${status.token})`,
                          background: `color-mix(in oklab, var(${status.token}) 12%, var(--surface))`,
                        }}
                      >
                        {/* Name, style, number, start — one per line, in the
                            order somebody reads them out on the telephone. */}
                        <p className={`truncate font-medium ${ended ? "line-through" : ""}`}>
                          {row.customer?.full_name?.split(" ")[0] ?? "—"}
                          {row.for_name && (
                            <span className="font-normal"> · {row.for_name}</span>
                          )}
                          {row.employee_requested && (
                            <span className="text-brand" title="Asked for by name">
                              {" ★"}
                            </span>
                          )}
                        </p>

                        <p className="truncate">
                          {label(row)}
                          {row.phase === "finish" && (
                            <span className="text-ink-muted"> · finishing</span>
                          )}
                        </p>

                        {row.customer?.phone && (
                          <p className="truncate tabular-nums text-ink-muted">
                            {row.customer.phone}
                          </p>
                        )}

                        <p className="truncate tabular-nums text-ink-muted">
                          {salonTime(row.starts_at, timezone)}
                          <span className="ml-1">· {status.label}</span>
                        </p>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
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
