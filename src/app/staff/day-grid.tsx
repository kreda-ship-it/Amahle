"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { STATUSES, statusMeta, type StatusKey } from "@/lib/appointments/status";
import { salonMinutes, salonTime } from "@/lib/site/datetime";

import { applyStatuses, moveVisit, type StatusChange } from "./actions";

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

  /*
   * WHICH COLUMN THIS BELONGS IN, DECIDED ON THE SERVER.
   *
   * The grid used to work it out itself, which meant it had to know that
   * columns are people and that the assistants share one. Then the week view
   * arrived, where columns are days, and the same grid could not serve both
   * without learning a second rule.
   *
   * A function would be the obvious fix and cannot cross the boundary — props
   * handed from a server component to a client one have to be serialisable.
   * So the server tags each row instead, and this file no longer knows what a
   * column MEANS. That is why one component draws both views.
   */
  column_id: string;
};

type Props = {
  rows: Row[];
  /** In the order they are drawn, left to right. */
  columns: { id: string; label: string }[];
  timezone: string;
  canManage: boolean;
  /*
   * What a column IS, which the grid needs for one reason only: dragging
   * sideways. Where columns are dates, crossing one is a change of day and so
   * is just a bigger shift in time — the same move. Where they are people,
   * crossing one would be a REASSIGNMENT, and move_visit() cannot do that: it
   * shifts times and never touches employee_id. So a sideways drag is ignored
   * on the day view rather than silently doing something else.
   */
  columnKind: "employee" | "date";
};

/* The salon's day, wider than its opening hours so an overrun is visible
   rather than clipped off the bottom. */
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;

const ZOOMS = [40, 60, 90, 130];

/* Dragged times land on a quarter hour. Free movement to the minute produces
   10:07 starts that nobody would say out loud, and the salon's own step is
   thirty — a quarter is fine enough to squeeze somebody in and coarse enough
   to be aimed at on a phone. */
const SNAP = 15;

/* Pixels of movement before a press becomes a drag rather than a tap. Without
   it, marking with the highlighter would move appointments by a minute or two
   whenever a finger wobbled. */
const DRAG_THRESHOLD = 4;

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
      /* Barely a floor. An earlier version clamped to 46px so four lines of
         text would fit, which made every short service look like an hour —
         the grid's whole job is that a block's height IS its length. The box
         drops lines instead as it gets shorter; see `lines()` below. */
      height: Math.max(((to - from) / 60) * pxPerHour, 18),
      lane,
      lanes: 1,
      endsAt: to,
    });

    clusterEnd = Math.max(clusterEnd, to);
  }

  flush();

  return placed;
}

/**
 * How much a block can say at the height it has.
 *
 * A twenty-minute trim at the smallest zoom is thirteen pixels. Four lines of
 * text do not fit in thirteen pixels, and the honest answer is to say less
 * rather than to pretend the appointment is longer than it is — a block whose
 * height is a lie defeats the only thing a grid does better than a list.
 *
 * The order is what somebody reads out on the telephone, so what survives at
 * each size is the front of that sentence.
 */
function lines(height: number): {
  style: boolean;
  phone: boolean;
  time: boolean;
} {
  return {
    style: height >= 34,
    time: height >= 52,
    phone: height >= 72,
  };
}

/** "45 minutes later", "2 hours earlier", "1 day later" — for the undo strip. */
function describeShift(minutes: number): string {
  const when = minutes < 0 ? "earlier" : "later";
  const size = Math.abs(minutes);

  if (size >= 1440 && size % 1440 === 0) {
    const days = size / 1440;

    return `${days} ${days === 1 ? "day" : "days"} ${when}`;
  }

  if (size >= 60) {
    const hours = Math.floor(size / 60);
    const rest = size % 60;

    return rest === 0
      ? `${hours} ${hours === 1 ? "hour" : "hours"} ${when}`
      : `${hours}h ${rest}m ${when}`;
  }

  return `${size} minutes ${when}`;
}

export function DayGrid({
  rows,
  columns,
  timezone,
  canManage,
  columnKind,
}: Props) {
  /* Measured rather than assumed: columns share the available width, so how
     wide one is depends on the screen and on how many stylists work here. */
  const gridRef = useRef<HTMLDivElement>(null);

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

  /*
   * A drag in progress. `from` is where the pointer went down, `shift` is how
   * far the visit would move if it were let go now — in minutes, already
   * snapped. Held as one object so a render can never see half a drag.
   */
  const [drag, setDrag] = useState<{
    visitId: string;
    fromX: number;
    fromY: number;
    shift: number;
    moved: boolean;
  } | null>(null);

  /** A move that has been sent but not yet come back, so the block stays put. */
  const [moved, setMoved] = useState<Record<string, number>>({});

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

  /** Everything in one column, placed. */
  const laid = useMemo(() => {
    const byColumn = new Map<string, Row[]>();

    for (const row of visible) {
      const list = byColumn.get(row.column_id) ?? [];
      list.push(row);
      byColumn.set(row.column_id, list);
    }

    const out = new Map<string, Placed[]>();

    for (const [column, list] of byColumn) {
      out.set(column, place(list, timezone, pxPerHour));
    }

    return out;
  }, [visible, timezone, pxPerHour]);

  const hours = useMemo(() => {
    const out: number[] = [];
    for (let m = DAY_START; m <= DAY_END; m += 60) out.push(m);

    return out;
  }, []);

  const gridHeight = ((DAY_END - DAY_START) / 60) * pxPerHour;

  const heads = columns;

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

  /*
   * DRAGGING.
   *
   * Pointer events rather than mouse events, so a finger on the salon's tablet
   * and a mouse on the desk take the same path. Capture means the block keeps
   * receiving moves even when the pointer leaves it, which it does constantly
   * — the block is a hundred pixels wide and a drag crosses the whole day.
   *
   * The whole visit moves, so a drag on a founding drags its finishing too.
   * That is decided in Postgres by move_visit(); here it only has to be shown,
   * which is why the preview offsets every block sharing the visit id.
   */
  function dragStart(event: React.PointerEvent, row: Row) {
    // The highlighter owns the tap when a status is selected. One gesture, one
    // meaning — a press that both marks and moves is a press nobody trusts.
    if (brush || !canManage) return;

    (event.target as Element).setPointerCapture?.(event.pointerId);

    setDrag({
      visitId: row.visit_id,
      fromX: event.clientX,
      fromY: event.clientY,
      shift: 0,
      moved: false,
    });
  }

  function dragMove(event: React.PointerEvent) {
    if (!drag) return;

    const dx = event.clientX - drag.fromX;
    const dy = event.clientY - drag.fromY;

    if (
      !drag.moved &&
      Math.abs(dx) < DRAG_THRESHOLD &&
      Math.abs(dy) < DRAG_THRESHOLD
    ) {
      return;
    }

    const minutes = (dy / pxPerHour) * 60;

    /*
     * Sideways only counts where a column is a date — then crossing one is a
     * change of day, which is the same move a day further on. Where columns
     * are people it is ignored: move_visit() shifts times and never touches
     * employee_id, so honouring the gesture would silently do something other
     * than what it looks like.
     */
    let days = 0;

    if (columnKind === "date" && gridRef.current) {
      const columnWidth =
        (gridRef.current.clientWidth - 52) / Math.max(columns.length, 1);

      if (columnWidth > 0) days = Math.round(dx / columnWidth);
    }

    setDrag({
      ...drag,
      moved: true,
      shift: Math.round(minutes / SNAP) * SNAP + days * 24 * 60,
    });
  }

  function dragEnd() {
    if (!drag) return;

    const { visitId, shift, moved: didMove } = drag;
    setDrag(null);

    if (!didMove || shift === 0) return;

    setError(null);
    setMoved((current) => ({ ...current, [visitId]: shift }));

    startSaving(async () => {
      const result = await moveVisit(visitId, shift);

      if (!result.ok) {
        // Put it back where it was — the database refused, so the block must
        // not sit somewhere it is not.
        setMoved((current) => {
          const next = { ...current };
          delete next[visitId];

          return next;
        });

        setError(result.message);
        return;
      }

      /* Undo a move by moving it back. Same operation, opposite sign, so
         there is no separate "restore" path to get wrong. */
      setUndoMove({ visitId, shift: -shift });
    });
  }

  /** A move that can be put back, offered for a few seconds like a marking. */
  const [undoMove, setUndoMove] = useState<{
    visitId: string;
    shift: number;
  } | null>(null);

  useEffect(() => {
    if (!undoMove) return;

    const timer = setTimeout(() => setUndoMove(null), 8000);

    return () => clearTimeout(timer);
  }, [undoMove]);

  function undoTheMove() {
    if (!undoMove) return;

    const { visitId, shift } = undoMove;
    setUndoMove(null);
    setError(null);

    setMoved((current) => ({
      ...current,
      [visitId]: (current[visitId] ?? 0) + shift,
    }));

    startSaving(async () => {
      const result = await moveVisit(visitId, shift);
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
        /*
         * The grid scrolls inside itself rather than making the page tall.
         * Fifteen hours at any readable zoom is well past a screen, and a
         * pane with its own scroll is what lets the column headings and the
         * clock stay put while you move through the day.
         */
        <div className="max-h-[68vh] overflow-auto border border-line">
          <div
            ref={gridRef}
            className="grid"
            style={{
              /*
                Columns share whatever room there is and stop shrinking at
                8.5rem. Four stylists fill a laptop; twelve overflow and the
                pane scrolls sideways. A fixed width did neither — it left
                dead space at one end of the range and forced a scrollbar at
                the other.
              */
              gridTemplateColumns: `3.25rem repeat(${heads.length}, minmax(8.5rem, 1fr))`,
            }}
          >
            {/* The corner sits above both sticky edges, so neither slides
                under it. */}
            <div className="sticky top-0 left-0 z-30 border-r border-b border-line bg-surface" />

            {heads.map((head) => (
              <div
                key={head.id}
                className="sticky top-0 z-20 truncate border-r border-b border-line bg-surface px-2 py-2 text-center text-sm font-medium last:border-r-0"
                title={head.label}
              >
                {head.label}
              </div>
            ))}

            {/* The clock, which stays put as the pane scrolls sideways. */}
            <div
              className="sticky left-0 z-10 border-r border-line bg-surface"
              style={{ height: gridHeight }}
            >
              {hours.map((minute) => (
                <span
                  key={minute}
                  className="absolute right-1.5 -translate-y-1/2 text-[0.6875rem] tabular-nums text-ink-muted"
                  style={{ top: ((minute - DAY_START) / 60) * pxPerHour }}
                >
                  {String(Math.floor(minute / 60)).padStart(2, "0")}:00
                </span>
              ))}
            </div>

            {heads.map((head) => (
              <div
                key={head.id}
                className="relative border-r border-line last:border-r-0"
                style={{ height: gridHeight }}
              >
                {/* Hour lines only. Half-hours turn the column into a ladder
                    at the smaller zooms and the blocks stop standing out
                    from it. */}
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
                  const show = lines(block.height);

                  /*
                   * How far this block is from where the database thinks it
                   * is: a drag in progress, plus any move already sent and not
                   * yet confirmed. Both are in minutes, so both become pixels
                   * the same way.
                   */
                  const offsetMinutes =
                    (drag?.visitId === row.visit_id ? drag.shift : 0) +
                    (moved[row.visit_id] ?? 0);

                  const offset = (offsetMinutes / 60) * pxPerHour;
                  const dragging = drag?.visitId === row.visit_id && drag.moved;

                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => mark(row)}
                      onPointerDown={(event) => dragStart(event, row)}
                      onPointerMove={dragMove}
                      onPointerUp={dragEnd}
                      onPointerCancel={dragEnd}
                      disabled={!canManage}
                      title={`${row.customer?.full_name ?? ""} · ${label(row)} · ${salonTime(row.starts_at, timezone)}–${salonTime(row.ends_at, timezone)} · ${status.label}`}
                      aria-label={`${row.customer?.full_name ?? "Appointment"}, ${label(row)}, ${salonTime(row.starts_at, timezone)}, ${status.label}`}
                      className={`absolute overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-[0.6875rem] leading-[1.35] ${
                        !canManage
                          ? "cursor-default"
                          : brush
                            ? "cursor-pointer hover:brightness-95"
                            : "cursor-grab active:cursor-grabbing"
                      } ${ended ? "opacity-50" : ""} ${
                        dragging ? "z-10 shadow-lg ring-1 ring-ink" : ""
                      }`}
                      style={{
                        /* `touch-action: none` is what stops a drag on the
                           salon's tablet scrolling the page instead of moving
                           the appointment. Without it the gesture belongs to
                           the browser and never reaches this component. */
                        touchAction: brush || !canManage ? undefined : "none",
                        top: block.top + offset,
                        height: block.height,
                        left: `calc(${block.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        /* The status colour carries the block: a tint for the
                           body, the full value on the edge. Never the only
                           signal — the word is in the box whenever it fits,
                           and always in the tooltip. */
                        borderLeftColor: `var(${status.token})`,
                        background: `color-mix(in oklab, var(${status.token}) 12%, var(--surface))`,
                      }}
                    >
                      {/* Name, style, number, start — one per line, in the
                          order somebody reads them out on the telephone.
                          Lines drop off the bottom as the block gets shorter
                          rather than the block growing to fit them. */}
                      <p
                        className={`truncate font-medium ${ended ? "line-through" : ""}`}
                      >
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

                      {show.style && (
                        <p className="truncate">
                          {label(row)}
                          {row.phase === "finish" && (
                            <span className="text-ink-muted"> · finishing</span>
                          )}
                        </p>
                      )}

                      {show.phone && row.customer?.phone && (
                        <p className="truncate tabular-nums text-ink-muted">
                          {row.customer.phone}
                        </p>
                      )}

                      {show.time && (
                        <p className="truncate tabular-nums text-ink-muted">
                          {salonTime(row.starts_at, timezone)}
                          <span className="ml-1">· {status.label}</span>
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- undo, and anything that went wrong ---------- */}
      {/*
        One strip for both kinds of change. A marking and a move are undone the
        same way from the reader's point of view, and two strips racing each
        other for the same corner would be worse than either.
      */}
      {(undoable || undoMove || error) && (
        <div className="sticky bottom-4 mx-auto flex w-fit items-center gap-4 border border-ink bg-surface px-4 py-2.5 text-sm shadow-lg">
          {error ? (
            <span role="alert" className="text-brand">
              {error}
            </span>
          ) : undoMove ? (
            <>
              <span>
                {saving
                  ? "Moving…"
                  : `Moved ${describeShift(-undoMove.shift)}`}
              </span>
              <button
                type="button"
                onClick={undoTheMove}
                className="underline underline-offset-4 transition-colors hover:text-brand"
              >
                Undo
              </button>
            </>
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
