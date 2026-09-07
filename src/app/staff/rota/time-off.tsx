"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { addTimeOff, removeTimeOff } from "./actions";

/**
 * When somebody is away.
 *
 * ON THIS PAGE RATHER THAN ITS OWN, having first argued the opposite. The
 * tables are genuinely different — a rota is a fact about the clock, a holiday
 * is a real moment — but that is a reason for two TABLES, not two screens.
 * "When is Fikir available" is one question, and answering half of it here and
 * half somewhere else would mean the same employee picker twice and two places
 * to look before booking somebody.
 *
 * PAST ENTRIES ARE NOT SHOWN. A rota screen is for deciding what happens next;
 * last August's holiday is history, and history belongs in the audit log
 * rather than in a list somebody has to scroll past.
 *
 * NOTHING HERE BLOCKS AN APPOINTMENT. Time off is not an appointment, so the
 * exclusion constraint has never seen it — it governs what customers are
 * OFFERED, and DECISIONS #30 is explicit that staff may book straight through
 * it. Somebody will assume otherwise, so the screen says so.
 */

export type TimeOff = {
  id: string;
  starts_at: string;
  ends_at: string;
};

export function TimeOffEditor({
  employeeId,
  away,
  timezone,
}: {
  employeeId: string;
  away: TimeOff[];
  timezone: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);

    startSaving(async () => {
      const result = await work();

      if (!result.ok) setError(result.message ?? "That did not work.");
      else router.refresh();
    });
  }

  /* Formatted in the salon's clock, not the browser's — somebody checking the
     rota from another state has to see the same dates as the desk. */
  const when = (starts: string, ends: string) => {
    const day = (value: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(value));

    const time = (value: string) =>
      new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(value));

    /* A whole-day entry ends at midnight, which reads as the NEXT day unless
       a second is taken off it first. "14th to 17th 00:00" is the 14th to the
       16th to everybody except a computer. */
    const lastMoment = new Date(new Date(ends).getTime() - 1000).toISOString();
    const wholeDays = time(starts) === "12:00 AM" && time(ends) === "12:00 AM";

    if (wholeDays) {
      return day(starts) === day(lastMoment)
        ? day(starts)
        : `${day(starts)} – ${day(lastMoment)}`;
    }

    return `${day(starts)} ${time(starts)} – ${day(ends)} ${time(ends)}`;
  };

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="label border-b border-line pb-2 text-ink">Away</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Holidays and blocked time. The booking form stops offering these
          hours; the desk can still book straight through them.
        </p>
      </div>

      {error && (
        <p role="alert" className="border border-brand px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {away.length > 0 && (
        <ul className="divide-y divide-line border border-line">
          {away.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
            >
              <span className="tabular-nums">
                {when(entry.starts_at, entry.ends_at)}
              </span>

              <button
                type="button"
                disabled={saving}
                onClick={() => run(() => removeTimeOff(entry.id))}
                className="text-ink-muted underline underline-offset-4 transition-colors hover:text-brand disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        action={(form) =>
          run(() =>
            addTimeOff({
              employeeId,
              fromDate: String(form.get("fromDate") ?? ""),
              toDate: String(form.get("toDate") ?? ""),
              fromTime: String(form.get("fromTime") ?? ""),
              toTime: String(form.get("toTime") ?? ""),
            }),
          )
        }
        className="flex flex-wrap items-end gap-2 border border-line p-3 text-sm"
      >
        <label className="flex flex-col gap-1">
          <span className="label text-ink-muted">From</span>
          <input
            type="date"
            name="fromDate"
            required
            className="border border-line bg-surface px-2 py-1 tabular-nums"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-muted">To</span>
          <input
            type="date"
            name="toDate"
            required
            className="border border-line bg-surface px-2 py-1 tabular-nums"
          />
        </label>

        {/* Blank means the whole day, which is nearly every case. The times
            are for the dentist at two o'clock. */}
        <label className="flex flex-col gap-1">
          <span className="label text-ink-muted">From time</span>
          <input
            type="time"
            name="fromTime"
            className="border border-line bg-surface px-2 py-1 tabular-nums"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-muted">To time</span>
          <input
            type="time"
            name="toTime"
            className="border border-line bg-surface px-2 py-1 tabular-nums"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="border border-line px-3 py-1.5 transition-colors hover:border-ink disabled:opacity-40"
        >
          Add
        </button>

        <span className="text-ink-muted">
          Leave the times blank for whole days.
        </span>
      </form>
    </section>
  );
}
