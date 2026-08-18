/**
 * Printing dates and times in the salon's own timezone.
 *
 * Every timestamp from the database is a real moment — an instant, with no
 * timezone of its own. The salon thinks in wall-clock time: "quarter to
 * eleven on Tuesday". Turning one into the other needs the organization's
 * `timezone`, and getting it wrong is the kind of bug that only appears for
 * customers in another state, or for everyone on the two days a year the
 * clocks change.
 *
 * So every function here takes the timezone explicitly. There is deliberately
 * no default: a missing timezone should be a type error, not a page that
 * silently renders in whatever zone the server happens to sit in. Vercel's
 * servers are UTC, so the failure would not even show up in local
 * development.
 */

/**
 * The salon-local calendar date, as `YYYY-MM-DD`.
 *
 * Used as a grouping key, never shown to anyone. `en-CA` is a deliberate
 * trick rather than a claim about Canada: it is the locale whose short date
 * format is already ISO order, so no reassembling of parts is needed.
 */
export function salonDateKey(when: Date | string, timeZone: string): string {
  const date = typeof when === "string" ? new Date(when) : when;

  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** `10:45 AM`, in the salon's timezone. */
export function salonTime(when: Date | string, timeZone: string): string {
  const date = typeof when === "string" ? new Date(when) : when;

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/**
 * `Tue 2 Sep` — short enough for a row of day buttons on a phone.
 *
 * Takes a `YYYY-MM-DD` key rather than a moment, because the day chooser is
 * about calendar dates and not about instants. Formatted in UTC from midday,
 * which sounds odd and is the point: midday is far enough from either edge
 * that no timezone offset can push it onto a neighbouring date.
 */
export function salonDayLabel(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(middayUtc(dateKey));
}

/** `Tuesday, 2 September` — for confirming a choice back to someone. */
export function salonDayLabelLong(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(middayUtc(dateKey));
}

/**
 * The next `count` calendar dates in the salon's timezone, starting today.
 *
 * Pure calendar arithmetic on UTC midday, so adding a day is adding a day —
 * no daylight saving change can turn 14 days into 13 or 15.
 */
export function salonDaysFrom(
  timeZone: string,
  count: number,
  from: Date = new Date(),
): string[] {
  const start = middayUtc(salonDateKey(from, timeZone));
  const days: string[] = [];

  for (let i = 0; i < count; i++) {
    const day = new Date(start.getTime() + i * 24 * 60 * 60 * 1000);

    days.push(
      [
        day.getUTCFullYear(),
        String(day.getUTCMonth() + 1).padStart(2, "0"),
        String(day.getUTCDate()).padStart(2, "0"),
      ].join("-"),
    );
  }

  return days;
}

/** `2026-09-02` as midday UTC on that calendar date. */
function middayUtc(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day, 12));
}
