"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { addShift, removeShift, updateShift } from "./actions";

/**
 * One person's regular week.
 *
 * SEVERAL SHIFTS ON ONE DAY IS NORMAL and the screen has to make that obvious,
 * because it is how most salon rotas actually look — 09:00 to 13:00 and 14:00
 * to 18:00 is a stylist with a long lunch. Migration 013 deliberately has no
 * unique constraint on (employee, day) for exactly this reason, and a form
 * that allowed one row per day would quietly make split shifts impossible.
 *
 * A REGULAR WEEK, NOT A DATE. These are times, not moments — "Tuesday 9am"
 * stays 9am when the clocks change, and the salon's timezone turns it into a
 * real instant only when availability is computed. So there is no calendar
 * here and no year: this is the shape of an ordinary week, and a specific
 * Thursday somebody is away is time off, which is a different thing.
 */

export type Shift = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
};

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/** `09:00:00` from Postgres, `09:00` in an input. */
const short = (time: string) => time.slice(0, 5);

export function RotaEditor({
  employeeId,
  shifts,
}: {
  employeeId: string;
  shifts: Shift[];
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

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="border border-brand px-3 py-2 text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-col border border-line">
        {DAYS.map((day, dayOfWeek) => {
          const onThisDay = shifts
            .filter((shift) => shift.day_of_week === dayOfWeek)
            .sort((a, b) => a.start_time.localeCompare(b.start_time));

          return (
            <div
              key={day}
              className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-line px-4 py-3 last:border-b-0"
            >
              <span className="w-24 shrink-0 font-medium">{day}</span>

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {onThisDay.length === 0 && (
                  <span className="text-ink-muted">Not working</span>
                )}

                {onThisDay.map((shift) => (
                  <form
                    key={shift.id}
                    action={(form) =>
                      run(() =>
                        updateShift({
                          id: shift.id,
                          startTime: String(form.get("start") ?? ""),
                          endTime: String(form.get("end") ?? ""),
                        }),
                      )
                    }
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <input
                      type="time"
                      name="start"
                      defaultValue={short(shift.start_time)}
                      aria-label={`${day} start`}
                      className="border border-line bg-surface px-2 py-1 tabular-nums"
                    />
                    <span className="text-ink-muted">to</span>
                    <input
                      type="time"
                      name="end"
                      defaultValue={short(shift.end_time)}
                      aria-label={`${day} finish`}
                      className="border border-line bg-surface px-2 py-1 tabular-nums"
                    />

                    <button
                      type="submit"
                      disabled={saving}
                      className="border border-line px-2.5 py-1 transition-colors hover:border-ink disabled:opacity-40"
                    >
                      Save
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => run(() => removeShift(shift.id))}
                      className="text-ink-muted underline underline-offset-4 transition-colors hover:text-brand disabled:opacity-40"
                    >
                      Remove
                    </button>
                  </form>
                ))}

                {/* A second shift on the same day is a long lunch, which is
                    what most salon rotas look like. */}
                <form
                  action={(form) =>
                    run(() =>
                      addShift({
                        employeeId,
                        dayOfWeek,
                        startTime: String(form.get("start") ?? ""),
                        endTime: String(form.get("end") ?? ""),
                      }),
                    )
                  }
                  className="flex flex-wrap items-center gap-2 text-sm"
                >
                  <input
                    type="time"
                    name="start"
                    defaultValue="09:00"
                    aria-label={`New ${day} start`}
                    className="border border-line bg-surface px-2 py-1 tabular-nums text-ink-muted"
                  />
                  <span className="text-ink-muted">to</span>
                  <input
                    type="time"
                    name="end"
                    defaultValue="17:00"
                    aria-label={`New ${day} finish`}
                    className="border border-line bg-surface px-2 py-1 tabular-nums text-ink-muted"
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="border border-dashed border-line px-2.5 py-1 text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
                  >
                    {onThisDay.length > 0 ? "Add another" : "Add"}
                  </button>
                </form>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
