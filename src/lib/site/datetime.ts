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

/**
 * How far the salon's clock is from UTC at one particular instant, in minutes.
 *
 * Asked of a moment rather than of a zone, because the answer changes twice a
 * year. New York is -300 in January and -240 in July, and a function that
 * returned one number for "America/New_York" would be wrong for half the year.
 *
 * The trick is to format the instant IN the salon's zone, then read those
 * wall-clock parts back as though they were UTC. The gap between that and the
 * real instant is the offset.
 */
function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const value = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);

  const asIfUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );

  return (asIfUtc - instant.getTime()) / 60000;
}

/**
 * A wall-clock time in the salon turned into a real instant.
 *
 * `salonInstant("2026-08-25", "14:30", "America/New_York")` is half past two
 * that afternoon in the salon, as an ISO string the database can store. The
 * inverse of `salonTime()`, and the piece that lets a receptionist type a time
 * rather than choose one that was offered.
 *
 * **Why the offset is looked up twice.** The first lookup asks what the offset
 * is at roughly the right moment, which is enough to land within an hour of
 * the answer. On the two days a year the clocks move, that first guess can sit
 * on the wrong side of the change and give an offset an hour out. Correcting
 * with the offset at the corrected instant settles it.
 *
 * The genuinely ambiguous hour — 01:30 on the morning the clocks go back
 * happens twice — resolves to the first of the two. Nobody is booked at half
 * past one in the morning, and picking one deterministically beats refusing.
 */
export function salonInstant(
  dateKey: string,
  time: string,
  timeZone: string,
): string {
  const naive = Date.parse(`${dateKey}T${time}:00Z`);

  const firstGuess = naive - zoneOffsetMinutes(new Date(naive), timeZone) * 60000;
  const settled =
    naive - zoneOffsetMinutes(new Date(firstGuess), timeZone) * 60000;

  return new Date(settled).toISOString();
}
