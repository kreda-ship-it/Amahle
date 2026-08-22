"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * The little calendar in the corner.
 *
 * A month grid you can tap, because "the 14th" is how somebody on the
 * telephone says it and stepping there with a Next arrow is thirteen taps.
 * The previous/next/today controls stay beside the heading — they are for
 * moving through the day you are already in, which is a different action from
 * jumping to a date.
 *
 * Two shapes, because the same widget serves two habits. Month is for finding
 * a date; week is a single row and gives the grid below it the rest of the
 * screen, which is what you want once you have found it.
 *
 * Every date is a LINK rather than a button. The day is already in the URL as
 * `?date=`, so the browser's own history walks back through the days somebody
 * looked at, and a day can be sent to a colleague by pasting it.
 */

type Props = {
  /** The day being shown, `YYYY-MM-DD`. */
  selected: string;
  /** The salon's today, which is not necessarily the browser's. */
  today: string;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** `2026-08-22` as its three numbers, with no timezone anywhere near it. */
function parts(dateKey: string): [number, number, number] {
  const [y, m, d] = dateKey.split("-").map(Number);

  return [y ?? 2026, m ?? 1, d ?? 1];
}

function key(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The days to draw, always starting on a Sunday.
 *
 * `Date.UTC` throughout, deliberately. These are calendar squares, not
 * moments: the 14th of the month is the 14th everywhere, and running the
 * arithmetic in the browser's local zone is how a grid ends up a day out for
 * anybody west of the salon.
 */
function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lead = first.getUTCDay();

  const cells: (string | null)[] = Array(lead).fill(null);

  for (let day = 1; day <= days; day++) cells.push(key(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

/** The Sunday-to-Saturday week containing this date. */
function weekOf(dateKey: string): string[] {
  const [year, month, day] = parts(dateKey);
  const when = new Date(Date.UTC(year, month - 1, day));
  when.setUTCDate(when.getUTCDate() - when.getUTCDay());

  return Array.from({ length: 7 }, (_, i) => {
    const cell = new Date(when.getTime() + i * 86400000);

    return key(
      cell.getUTCFullYear(),
      cell.getUTCMonth() + 1,
      cell.getUTCDate(),
    );
  });
}

function shiftMonth(year: number, month: number, by: number) {
  const when = new Date(Date.UTC(year, month - 1 + by, 1));

  return { year: when.getUTCFullYear(), month: when.getUTCMonth() + 1 };
}

export function DatePicker({ selected, today }: Props) {
  const [selYear, selMonth] = parts(selected);
  const [shape, setShape] = useState<"month" | "week">("month");
  const [view, setView] = useState({ year: selYear, month: selMonth });

  const week = weekOf(selected);
  const cells = shape === "month" ? monthGrid(view.year, view.month) : week;

  const heading =
    shape === "month"
      ? `${MONTHS[view.month - 1]} ${view.year}`
      : `${MONTHS[parts(week[0]!)[1] - 1]} ${parts(week[0]!)[0]}`;

  function step(by: number) {
    setView((current) => shiftMonth(current.year, current.month, by));
  }

  return (
    <div className="w-full max-w-[19rem] border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        {shape === "month" ? (
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="Previous month"
            className="px-2 py-1 text-ink-muted transition-colors hover:text-ink"
          >
            &lsaquo;
          </button>
        ) : (
          <Link
            href={`/staff/day?date=${shiftDays(week[0]!, -7)}`}
            aria-label="Previous week"
            className="px-2 py-1 text-ink-muted transition-colors hover:text-ink"
          >
            &lsaquo;
          </Link>
        )}

        <p className="font-medium">{heading}</p>

        {shape === "month" ? (
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="Next month"
            className="px-2 py-1 text-ink-muted transition-colors hover:text-ink"
          >
            &rsaquo;
          </button>
        ) : (
          <Link
            href={`/staff/day?date=${shiftDays(week[0]!, 7)}`}
            aria-label="Next week"
            className="px-2 py-1 text-ink-muted transition-colors hover:text-ink"
          >
            &rsaquo;
          </Link>
        )}
      </div>

      <div className="mt-2 grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((day, index) => (
          <span
            key={index}
            className="py-1 text-center text-xs text-ink-muted"
            aria-hidden
          >
            {day}
          </span>
        ))}

        {cells.map((cell, index) => {
          if (!cell) return <span key={`gap-${index}`} />;

          const day = parts(cell)[2];
          const isSelected = cell === selected;
          const isToday = cell === today;

          return (
            <Link
              key={cell}
              href={`/staff/day?date=${cell}`}
              aria-current={isSelected ? "date" : undefined}
              className={`mx-auto flex size-8 items-center justify-center text-sm tabular-nums transition-colors ${
                isSelected
                  ? "rounded-full bg-brand text-ink-inverse"
                  : isToday
                    ? "rounded-full border border-brand text-brand"
                    : "text-ink hover:bg-surface-sunk"
              }`}
            >
              {day}
            </Link>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
        <Link
          href="/staff/day"
          className="label text-ink-muted transition-colors hover:text-ink"
        >
          Today
        </Link>

        <button
          type="button"
          onClick={() => setShape(shape === "month" ? "week" : "month")}
          className="label text-ink-muted transition-colors hover:text-ink"
        >
          {shape === "month" ? "Week" : "Month"}
        </button>
      </div>
    </div>
  );
}

/** Calendar-square arithmetic, in UTC for the reason above. */
function shiftDays(dateKey: string, by: number): string {
  const [year, month, day] = parts(dateKey);
  const when = new Date(Date.UTC(year, month - 1, day + by));

  return key(
    when.getUTCFullYear(),
    when.getUTCMonth() + 1,
    when.getUTCDate(),
  );
}
