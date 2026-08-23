"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { STATUSES, statusMeta, type StatusKey } from "@/lib/appointments/status";
import { salonMinutes, salonTime } from "@/lib/site/datetime";

import {
  applyStatuses,
  moveVisit,
  reassignAppointment,
  resizeAppointment,
  type StatusChange,
} from "./actions";
import { DatePicker } from "./date-picker";
import { dropPlannedMove, setPlannedMove } from "./plan-actions";

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
  /*
   * When the station is free again — `ends_at` plus the service's cleanup
   * gap. Drawn as a hatched tail, because an invisible buffer is why two
   * blocks that look adjacent are refused as overlapping.
   */
  blocked_until: string;
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
  /** May drag, reassign and resize. `appointment.manage`. */
  canManage: boolean;
  /*
   * May use the highlighter. A wider group than canManage since migration
   * 042: a stylist holds no appointment permission at all, and may still mark
   * her own customer arrived or finished. The database decides which rows —
   * this only decides whether the key is a set of buttons or a legend.
   */
  canMark: boolean;
  /*
   * What a column IS, which the grid needs for one reason only: dragging
   * sideways. Where columns are dates, crossing one is a change of day and so
   * is just a bigger shift in time — the same move. Where they are people,
   * crossing one would be a REASSIGNMENT, and move_visit() cannot do that: it
   * shifts times and never touches employee_id. So a sideways drag is ignored
   * on the day view rather than silently doing something else.
   */
  columnKind: "employee" | "date";
  /*
   * The day the calendar in the corner should highlight, and the salon's own
   * today. Given here rather than rendered by the page because the status key
   * sits inside that panel, and the key is also the highlighter — so it has
   * to be where the brush state is. Omit both on a screen that wants no
   * calendar.
   */
  pickerDate?: string;
  today?: string;

  /*
   * The plan being edited, or null for the live calendar.
   *
   * Its presence is the whole difference between the two modes, and there is
   * deliberately no second component. Two copies of the hardest UI in the app
   * would drift, and a planner that disagrees with the real calendar is worse
   * than no planner.
   *
   * `moves` is target start times by visit — what the plan proposes, laid over
   * whatever the calendar currently says. Because the plan holds CHANGES and
   * not a copy of the day, a booking taken while it is open simply appears;
   * there is nothing to keep in step.
   */
  plan: {
    id: string;
    orgId: string;
    /*
     * By appointment id, not visit — reassigning and resizing are facts about
     * one appointment, and migration 044 moved the whole table to that grain
     * rather than keeping two kinds of entry.
     */
    moves: Record<
      string,
      {
        startsAt: string;
        employeeId: string | null;
        minutes: number | null;
        refused: string | null;
        applied: boolean;
      }
    >;
  } | null;
};

/* The salon's day, wider than its opening hours so an overrun is visible
   rather than clipped off the bottom. */
const DAY_START = 7 * 60;
const DAY_END = 22 * 60;

/*
 * Seven steps rather than four, and the top of the range is the point. At 40
 * pixels an hour a quarter of an hour is ten pixels and cannot be aimed at; at
 * 320 it is eighty and five minutes is a comfortable target. Zooming in is
 * therefore not just magnification — it is what makes minutes reachable.
 */
const ZOOMS = [30, 40, 60, 90, 140, 220, 320];

/**
 * How fine a dragged time may land, at this magnification.
 *
 * A quarter hour when the day is small: free movement to the minute produces
 * 10:07 starts nobody would say out loud, and at that size the difference is
 * two pixels of aim. Five minutes once a block is big enough to place
 * honestly — which is the answer to "I want to zoom into minutes".
 *
 * Tied to the zoom rather than offered as its own control, because the two
 * are the same question asked twice: how precisely can you see, and how
 * precisely may you act.
 */
function snapFor(pxPerHour: number): number {
  if (pxPerHour >= 220) return 5;
  if (pxPerHour >= 140) return 10;

  return 15;
}

/* Pixels of movement before a press becomes a drag rather than a tap. Without
   it, marking with the highlighter would move appointments by a minute or two
   whenever a finger wobbled. */
const DRAG_THRESHOLD = 4;

/* One shared empty object, so "nothing is pending" is the same reference on
   every render rather than a fresh one that rebuilds the day below it. */
const NOTHING_PENDING: Record<string, string> = {};
const NOTHING_PLANNED: Record<string, number> = {};

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

/** "6h 15m", "45m" — a length, for the label a block shows while it is resized. */
function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "0m";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** An instant, moved. Used to say where a block is landing, not where it was. */
function shifted(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
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
  canMark,
  columnKind,
  pickerDate,
  today,
  plan,
}: Props) {
  /* Measured rather than assumed: columns share the available width, so how
     wide one is depends on the screen and on how many stylists work here. */
  const gridRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const [brush, setBrush] = useState<StatusKey | null>(null);
  const [zoom, setZoom] = useState(2);
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
    /** The single row being dragged — reassigning and resizing act on it. */
    rowId: string;
    fromX: number;
    fromY: number;
    fromColumn: string;
    shift: number;
    /** Columns crossed. Only meaningful where a column is a person. */
    across: number;
    moved: boolean;
    /** A pull on the bottom edge changes the length instead of the time. */
    resizing: boolean;
  } | null>(null);

  /** A length change sent and not yet returned, in minutes. */
  const [resized, setResized] = useState<Record<string, number>>({});

  /*
   * UNDO AND REDO, IN PLANNING MODE ONLY, and the asymmetry is the point.
   *
   * On the live calendar every gesture is a write to real appointments, and
   * the honest reversal is the one already there: a strip offering to move it
   * back, for a few seconds. A stack of twenty undos over bookings that other
   * people are also editing would be a promise nothing can keep.
   *
   * A plan changes nothing until it is applied, so a full history costs
   * nothing and is exactly what a scratch surface should have. Each step
   * remembers the entry before and after; undoing writes the before back.
   */
  type PlanStep = {
    appointmentId: string;
    before: {
      startsAt: string;
      employeeId: string | null;
      minutes: number | null;
    } | null;
    after: {
      startsAt: string;
      employeeId: string | null;
      minutes: number | null;
    };
  };

  const [history, setHistory] = useState<{ done: PlanStep[]; undone: PlanStep[] }>(
    { done: [], undone: [] },
  );

  function remember(step: PlanStep) {
    // A new action makes the redo branch unreachable, as everywhere else.
    setHistory((current) => ({ done: [...current.done, step], undone: [] }));
  }

  function writeEntry(
    step: PlanStep["after"] | null,
    appointmentId: string,
  ): Promise<unknown> {
    if (!plan) return Promise.resolve();

    if (!step) return dropPlannedMove(plan.id, appointmentId);

    return setPlannedMove({
      planId: plan.id,
      appointmentId,
      targetStartsAt: step.startsAt,
      targetEmployeeId: step.employeeId,
      targetMinutes: step.minutes,
      orgId: plan.orgId,
    });
  }

  function stepBack() {
    const last = history.done[history.done.length - 1];
    if (!last || !plan) return;

    setHistory((current) => ({
      done: current.done.slice(0, -1),
      undone: [...current.undone, last],
    }));

    startSaving(async () => {
      await writeEntry(last.before, last.appointmentId);
      router.refresh();
    });
  }

  function stepForward() {
    const next = history.undone[history.undone.length - 1];
    if (!next || !plan) return;

    setHistory((current) => ({
      done: [...current.done, next],
      undone: current.undone.slice(0, -1),
    }));

    startSaving(async () => {
      await writeEntry(next.after, next.appointmentId);
      router.refresh();
    });
  }

  /*
   * PINCH TO ZOOM. Two fingers on the pane change how many pixels an hour is
   * worth, which — because `snapFor()` follows the zoom — is also what makes
   * five-minute placement possible. Held in a ref rather than state: it
   * changes on every frame of a pinch and none of those frames should cost a
   * render of forty blocks. Only the zoom STEP it settles on does.
   */
  const pinch = useRef<{ from: number; startedAt: number } | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());

  function paneDown(event: React.PointerEvent) {
    if (event.pointerType !== "touch") return;

    touches.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
  }

  function paneMove(event: React.PointerEvent) {
    if (event.pointerType !== "touch") return;
    if (!touches.current.has(event.pointerId)) return;

    touches.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    const points = [...touches.current.values()];
    if (points.length !== 2) return;

    const spread = Math.hypot(
      points[0]!.x - points[1]!.x,
      points[0]!.y - points[1]!.y,
    );

    if (!pinch.current) {
      pinch.current = { from: spread, startedAt: zoom };
      return;
    }

    /* One zoom step per 40% of spread. Coarse on purpose — the steps are the
       vocabulary, and a continuous scale would land between them. */
    const steps = Math.round(
      (spread / pinch.current.from - 1) / 0.4,
    );

    const next = Math.min(
      Math.max(pinch.current.startedAt + steps, 0),
      ZOOMS.length - 1,
    );

    if (next !== zoom) setZoom(next);
  }

  function paneUp(event: React.PointerEvent) {
    touches.current.delete(event.pointerId);

    if (touches.current.size < 2) pinch.current = null;
  }

  /** A move that has been sent but not yet come back, so the block stays put. */
  const [moved, setMoved] = useState<Record<string, number>>({});

  /*
   * Where the plan wants each visit, as an offset in minutes from where the
   * calendar actually has it. Computed rather than stored, so a booking moved
   * by hand since the plan was written shows the plan's intent shrinking to
   * nothing rather than the plan quietly applying twice.
   */
  const plannedOffset = useMemo(() => {
    if (!plan) return NOTHING_PLANNED;

    const out: Record<string, number> = {};

    for (const row of rows) {
      const entry = plan.moves[row.id];
      if (!entry || entry.applied) continue;

      const minutes = Math.round(
        (new Date(entry.startsAt).getTime() -
          new Date(row.starts_at).getTime()) /
          60_000,
      );

      if (minutes !== 0) out[row.id] = minutes;
    }

    return out;
  }, [plan, rows]);

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

  /*
   * Shared by the heading grid and the body grid, which have to agree column
   * for column. Columns take whatever room there is and stop shrinking at
   * 8.5rem, so four stylists fill a laptop and twelve overflow into a
   * sideways scroll.
   */
  const template = `3.25rem repeat(${columns.length}, minmax(8.5rem, 1fr))`;

  const heads = columns;

  function mark(row: Row) {
    if (!brush || !canMark) return;

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
  function dragStart(
    event: React.PointerEvent,
    row: Row,
    resizing = false,
  ) {
    // The highlighter owns the tap when a status is selected. One gesture, one
    // meaning — a press that both marks and moves is a press nobody trusts.
    if (brush || !canManage) return;

    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);

    setDrag({
      visitId: row.visit_id,
      rowId: row.id,
      fromX: event.clientX,
      fromY: event.clientY,
      fromColumn: row.column_id,
      shift: 0,
      across: 0,
      moved: false,
      resizing,
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
    const snap = snapFor(pxPerHour);

    /*
     * Sideways only counts where a column is a date — then crossing one is a
     * change of day, which is the same move a day further on. Where columns
     * are people it is ignored: move_visit() shifts times and never touches
     * employee_id, so honouring the gesture would silently do something other
     * than what it looks like.
     */
    /*
     * Sideways means two different things, and the column decides which.
     *
     * Where columns are DATES, crossing one is a change of day — the same move
     * a day further on, so it folds into the shift.
     *
     * Where they are PEOPLE, crossing one is a reassignment: this piece of
     * work goes to somebody else. That is a different operation on a different
     * grain — one appointment rather than the whole visit — so it is counted
     * separately and settled at the drop.
     *
     * A resize ignores sideways entirely. Pulling an edge changes a length,
     * and a length has no column.
     */
    let days = 0;
    let across = 0;

    if (!drag.resizing && gridRef.current) {
      const columnWidth =
        (gridRef.current.clientWidth - 52) / Math.max(columns.length, 1);

      if (columnWidth > 0) {
        const crossed = Math.round(dx / columnWidth);

        if (columnKind === "date") days = crossed;
        else across = crossed;
      }
    }

    setDrag({
      ...drag,
      moved: true,
      across,
      shift: Math.round(minutes / snap) * snap + days * 24 * 60,
    });
  }

  function dragEnd() {
    if (!drag) return;

    const { visitId, rowId, shift, across, moved: didMove, resizing } = drag;
    setDrag(null);

    if (!didMove) return;

    const row = rows.find((r) => r.id === rowId);

    /* ---- pulling the bottom edge: a new length ---- */
    if (resizing) {
      if (shift === 0 || !row) return;

      setError(null);
      setResized((current) => ({ ...current, [rowId]: shift }));

      const minutes =
        Math.round(
          (new Date(row.ends_at).getTime() -
            new Date(row.starts_at).getTime()) /
            60_000,
        ) + shift;

      const endsAt = new Date(
        new Date(row.ends_at).getTime() + shift * 60_000,
      ).toISOString();

      /* In a plan the length is proposed, not set. Same gesture, and the
         calendar is untouched until Apply. */
      if (plan) {
        startSaving(async () => {
          const result = await setPlannedMove({
            planId: plan.id,
            appointmentId: rowId,
            targetStartsAt: shifted(
              row.starts_at,
              plannedOffset[rowId] ?? 0,
            ),
            targetMinutes: minutes,
            orgId: plan.orgId,
          });

          if (!result.ok) setError(result.message);
        });

        return;
      }

      startSaving(async () => {
        const result = await resizeAppointment(rowId, endsAt);

        if (!result.ok) {
          setResized((current) => {
            const next = { ...current };
            delete next[rowId];

            return next;
          });

          setError(result.message);
        }
      });

      return;
    }

    /* ---- dropped in somebody else's column: a reassignment ---- */
    if (across !== 0 && columnKind === "employee" && row) {
      const fromIndex = columns.findIndex((c) => c.id === drag.fromColumn);
      const target = columns[Math.min(
        Math.max(fromIndex + across, 0),
        columns.length - 1,
      )];

      if (!target || target.id === drag.fromColumn) return;

      /*
       * The shared assistants column is not a person, so nothing can be
       * assigned TO it — create_appointment() chooses which assistant at write
       * time, and picking one by hand here would be inventing an answer the
       * scheduler is better placed to give.
       */
      if (target.id.startsWith("__")) {
        setError("Assistants are assigned automatically — drop it on a stylist.");
        return;
      }

      setError(null);

      const startsAt = shifted(row.starts_at, shift);

      if (plan) {
        startSaving(async () => {
          const result = await setPlannedMove({
            planId: plan.id,
            appointmentId: rowId,
            targetStartsAt: startsAt,
            targetEmployeeId: target.id,
            orgId: plan.orgId,
          });

          if (!result.ok) setError(result.message);
        });

        return;
      }

      startSaving(async () => {
        const result = await reassignAppointment({
          appointmentId: rowId,
          employeeId: target.id,
          startsAt,
        });

        if (!result.ok) setError(result.message);
      });

      return;
    }

    if (shift === 0) return;

    setError(null);
    setMoved((current) => ({ ...current, [visitId]: shift }));

    /*
     * IN PLANNING MODE NOTHING REACHES THE CALENDAR. The same gesture writes a
     * proposed target instead, and the block sits where the plan wants it
     * until somebody applies or discards. That is the one-way rule: live
     * bookings flow into a plan automatically, plan changes flow out only on
     * Apply.
     */
    if (plan) {
      /*
       * One entry per row of the visit, because the table is appointment-
       * grained and "the whole visit moves" is what writing all of them
       * means. Each row keeps its own offset from where it currently is, so
       * the shape of the visit survives — a founding and its finishing stay
       * the same distance apart.
       */
      const members = rows.filter((r) => r.visit_id === visitId);

      startSaving(async () => {
        for (const member of members) {
          const already = plannedOffset[member.id] ?? 0;

          const before = plan.moves[member.id] ?? null;
          const after = {
            startsAt: shifted(member.starts_at, already + shift),
            employeeId: before?.employeeId ?? null,
            minutes: before?.minutes ?? null,
          };

          remember({
            appointmentId: member.id,
            before: before
              ? {
                  startsAt: before.startsAt,
                  employeeId: before.employeeId,
                  minutes: before.minutes,
                }
              : null,
            after,
          });

          const result = await setPlannedMove({
            planId: plan.id,
            appointmentId: member.id,
            targetStartsAt: after.startsAt,
            targetEmployeeId: after.employeeId,
            targetMinutes: after.minutes,
            orgId: plan.orgId,
          });

          if (!result.ok) {
            setMoved((current) => {
              const next = { ...current };
              delete next[visitId];

              return next;
            });

            setError(result.message);
            return;
          }
        }
      });

      return;
    }

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

  const statusKey = (
    <>
      {/* ---------- the key, which is also the highlighter ---------- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {canMark && (
          <span className="label w-full text-ink-muted">
            {brush ? "Tap a booking to mark it" : "Pick a status to mark with"}
          </span>
        )}

        {STATUSES.map((status) => {
          const active = brush === status.key;

          return (
            <button
              key={status.key}
              type="button"
              disabled={!canMark}
              aria-pressed={canMark ? active : undefined}
              onClick={() => setBrush(active ? null : status.key)}
              className={`flex items-center gap-2 border px-2 py-1 text-sm transition-colors ${
                active
                  ? "border-ink bg-surface-sunk"
                  : "border-transparent hover:border-line"
              } ${canMark ? "" : "cursor-default"}`}
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
    </>
  );

  return (
    <div className="flex flex-col gap-4 xl:flex-row-reverse xl:items-start">
      {/*
        The calendar and the key together, in one panel. Both are things you
        consult rather than work in, and each was previously taking a full-
        width row from a screen whose whole problem is width.
      */}
      {pickerDate && today ? (
        <DatePicker
          selected={pickerDate}
          today={today}
          statusKey={statusKey}
        />
      ) : (
        <div className="xl:w-[17rem] xl:shrink-0">{statusKey}</div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-3">

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

        {plan && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={stepBack}
              disabled={history.done.length === 0 || saving}
              className="border border-line px-2.5 py-1 transition-colors hover:border-ink disabled:opacity-40"
              title="Undo"
              aria-label="Undo"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={stepForward}
              disabled={history.undone.length === 0 || saving}
              className="border border-line px-2.5 py-1 transition-colors hover:border-ink disabled:opacity-40"
              title="Redo"
              aria-label="Redo"
            >
              ↷
            </button>
          </div>
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
        <div
          className="max-h-[68vh] touch-pan-x touch-pan-y overflow-auto border border-line"
          onPointerDown={paneDown}
          onPointerMove={paneMove}
          onPointerUp={paneUp}
          onPointerCancel={paneUp}
        >
          {/*
            TWO GRIDS, NOT ONE, AND THAT IS THE WHOLE FIX FOR STICKY HEADINGS.

            The headings used to be cells in the same grid as the day, carrying
            `sticky top-0`. They did not stick, and the reason is easy to miss:
            a grid ITEM's containing block is its own grid area, and a sticky
            element can never travel outside its containing block. The heading
            row is one row tall, so the cells stuck for exactly their own
            height and then left with everything else.

            Lifting the headings into their own grid makes them a direct child
            of the scrolling pane instead, and a direct child's containing
            block is the pane. Identical `gridTemplateColumns` on both keeps
            the two in step, which is why the template is computed once above.
          */}
          <div
            className="sticky top-0 z-30 grid bg-surface"
            style={{ gridTemplateColumns: template }}
          >
            <div className="border-r border-b border-line" />

            {heads.map((head) => (
              <div
                key={head.id}
                className="truncate border-r border-b border-line px-2 py-2 text-center text-sm font-medium last:border-r-0"
                title={head.label}
              >
                {head.label}
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="grid"
            style={{ gridTemplateColumns: template }}
          >

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

                {/*
                  THE CLEANUP GAP, DRAWN. blocked_until is ends_at plus the
                  service's buffer, and it is what the exclusion constraint
                  actually reserves — so two blocks that merely LOOK adjacent
                  are already overlapping as far as the database is concerned,
                  and a refusal reads as arbitrary until the gap is visible.

                  Behind the blocks and not interactive: it is a consequence of
                  the service, changed on the services screen and nowhere else.
                */}
                {(laid.get(head.id) ?? []).map((block) => {
                  const row = block.row;
                  const tail =
                    (Math.round(
                      (new Date(row.blocked_until).getTime() -
                        new Date(row.ends_at).getTime()) /
                        60_000,
                    ) /
                      60) *
                    pxPerHour;

                  if (tail < 2) return null;

                  const width = 100 / block.lanes;
                  const shownOffset =
                    ((moved[row.visit_id] ?? 0) + (resized[row.id] ?? 0) === 0
                      ? 0
                      : ((moved[row.visit_id] ?? 0) / 60) * pxPerHour);

                  return (
                    <div
                      key={`${row.id}-buffer`}
                      aria-hidden
                      title="Cleanup gap — the station is not free yet"
                      className="absolute"
                      style={{
                        top: block.top + block.height + shownOffset,
                        height: tail,
                        left: `calc(${block.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        background:
                          "repeating-linear-gradient(135deg, var(--line) 0 3px, transparent 3px 7px)",
                      }}
                    />
                  );
                })}

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
                    (moved[row.visit_id] ?? 0) +
                    /* A block already moved this session carries its own
                       offset; adding the plan's as well would double it. */
                    (moved[row.visit_id] === undefined
                      ? (plannedOffset[row.id] ?? 0)
                      : 0);

                  const entry = plan?.moves[row.id] ?? null;

                  const planned =
                    plan !== null &&
                    (plannedOffset[row.id] !== undefined ||
                      moved[row.visit_id] !== undefined ||
                      entry !== null);

                  /* An entry the database would not take. Kept in the plan
                     with its reason rather than silently dropped, which is
                     the whole point of applying partially. */
                  const refused = entry?.refused ?? null;

                  const isThisRow = drag?.rowId === row.id && drag.moved;
                  const resizingThis = isThisRow && drag!.resizing;

                  /* A resize pins the top and moves the bottom, so the height
                     changes and the offset does not. */
                  const stretchMinutes = resizingThis
                    ? drag!.shift
                    : (resized[row.id] ?? 0);

                  const stretch = (stretchMinutes / 60) * pxPerHour;

                  const offset = resizingThis
                    ? (moved[row.visit_id] ?? 0) / 60 * pxPerHour
                    : (offsetMinutes / 60) * pxPerHour;

                  const dragging =
                    (drag?.visitId === row.visit_id && drag.moved) || false;

                  /* Sideways is shown by sliding the block, so it is visibly
                     heading for another column before it is let go. */
                  const sideways =
                    isThisRow && !drag!.resizing && drag!.across !== 0
                      ? drag!.across * 100
                      : 0;

                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => mark(row)}
                      onPointerDown={(event) => dragStart(event, row)}
                      onPointerMove={dragMove}
                      onPointerUp={dragEnd}
                      onPointerCancel={dragEnd}
                      disabled={!canMark && !canManage}
                      title={
                        refused
                          ? `Refused: ${refused}`
                          : `${row.customer?.full_name ?? ""} · ${label(row)} · ${salonTime(row.starts_at, timezone)}–${salonTime(row.ends_at, timezone)} · ${status.label}`
                      }
                      aria-label={`${row.customer?.full_name ?? "Appointment"}, ${label(row)}, ${salonTime(row.starts_at, timezone)}, ${status.label}`}
                      className={`absolute overflow-hidden rounded-sm border-l-[3px] px-1.5 py-0.5 text-left text-[0.6875rem] leading-[1.35] ${
                        brush
                          ? canMark
                            ? "cursor-pointer hover:brightness-95"
                            : "cursor-default"
                          : canManage
                            ? "cursor-grab active:cursor-grabbing"
                            : "cursor-default"
                      } ${ended ? "opacity-50" : ""} ${
                        dragging ? "z-10 shadow-lg ring-1 ring-ink" : ""
                      } ${
                        /* A proposal, not a booking. Dashed, so it reads as
                           unfinished at a glance rather than needing the
                           legend explained. */
                        refused
                          ? "ring-2 ring-red-600"
                          : planned && !dragging
                            ? "border border-dashed border-ink/50 ring-1 ring-ink/20"
                            : ""
                      }`}
                      style={{
                        /* `touch-action: none` is what stops a drag on the
                           salon's tablet scrolling the page instead of moving
                           the appointment. Without it the gesture belongs to
                           the browser and never reaches this component. */
                        touchAction: brush || !canManage ? undefined : "none",
                        top: block.top + offset,
                        transform: sideways
                          ? `translateX(${sideways}%)`
                          : undefined,
                        height: Math.max(block.height + stretch, 14),
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

                      {refused && (
                        <p className="truncate font-medium text-red-700">
                          {refused}
                        </p>
                      )}

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

                      {/*
                        THE TIME A BLOCK SHOWS IS WHERE ITS TOP IS, not what
                        the database currently stores. During a drag those
                        differ, and the stored one is the wrong answer: the
                        question somebody is asking mid-drag is "what time
                        would this be", and reading the old value off a block
                        that has visibly moved is how a booking is dropped in
                        the wrong place.

                        While resizing, the same idea runs on the length
                        instead — the top is pinned and the duration changes.
                      */}
                      {show.time && (
                        <p className="truncate tabular-nums text-ink-muted">
                          {salonTime(
                            offsetMinutes === 0
                              ? row.starts_at
                              : shifted(row.starts_at, offsetMinutes),
                            timezone,
                          )}
                          <span className="ml-1">
                            ·{" "}
                            {stretchMinutes !== 0
                              ? formatMinutes(
                                  Math.max(
                                    Math.round(
                                      (new Date(row.ends_at).getTime() -
                                        new Date(row.starts_at).getTime()) /
                                        60_000,
                                    ) + stretchMinutes,
                                    0,
                                  ),
                                )
                              : status.label}
                          </span>
                        </p>
                      )}
                    </button>
                  );
                })}

                {/*
                  THE RESIZE HANDLES, drawn after the blocks so they sit above
                  them, and as siblings rather than children — the block is a
                  <button> and a button inside a button is invalid HTML that
                  browsers repair by moving it out, which breaks the layout in
                  a way that is hard to see and harder to explain.

                  Six pixels of grab area on the bottom edge. Only on blocks
                  tall enough to have an edge worth grabbing, and never while
                  the highlighter owns the tap.
                */}
                {canManage &&
                  !brush &&
                  (laid.get(head.id) ?? []).map((block) => {
                    const row = block.row;
                    const isThisRow = drag?.rowId === row.id && drag.moved;
                    const stretch =
                      ((isThisRow && drag!.resizing
                        ? drag!.shift
                        : (resized[row.id] ?? 0)) /
                        60) *
                      pxPerHour;

                    const height = Math.max(block.height + stretch, 14);
                    if (height < 26) return null;

                    const width = 100 / block.lanes;

                    return (
                      <div
                        key={`${row.id}-handle`}
                        role="presentation"
                        onPointerDown={(event) => dragStart(event, row, true)}
                        onPointerMove={dragMove}
                        onPointerUp={dragEnd}
                        onPointerCancel={dragEnd}
                        title="Drag to change how long it takes"
                        className="absolute z-10 cursor-ns-resize"
                        style={{
                          touchAction: "none",
                          top: block.top + height - 6,
                          height: 8,
                          left: `calc(${block.lane * width}% + 2px)`,
                          width: `calc(${width}% - 4px)`,
                        }}
                      />
                    );
                  })}
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

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
    </div>
  );
}
