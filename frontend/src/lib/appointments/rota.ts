import { salonDayRange, salonMinutes } from "@/lib/site/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * When somebody is actually in the building.
 *
 * WHY THE CALENDAR NEEDS THIS AND DID NOT HAVE IT. A column with nothing in it
 * means two completely different things — this person is free, or this person
 * is not here — and until now the grid drew them identically. A receptionist
 * looking at Tuesday saw four empty columns and no way to tell that one of
 * them belongs to somebody on holiday. `employee_working_hours` and
 * `employee_time_off` have existed since migration 013 and no screen has ever
 * read them.
 *
 * MINUTES FROM MIDNIGHT, IN THE SALON'S OWN CLOCK, because that is what a grid
 * draws with — the same unit `salonMinutes()` gives the blocks. The conversion
 * happens here, on the server, so the browser never has to know the salon's
 * timezone to place a shaded band.
 *
 * NO PERMISSION CHECK. Migration 013 grants reading the rota to anybody
 * belonging to the organization, and says why: everyone needs to know who is
 * working today, because that is the calendar. Row-level security scopes it to
 * one salon; there is no key beyond belonging.
 */

/** A stretch of the day, in minutes from midnight. `to` is exclusive. */
export type Span = { from: number; to: number };

export type ColumnRota = {
  /** When this column is open. Empty means nobody is in at all. */
  working: Span[];
  /** Holidays and blocked time, drawn over the top. */
  off: Span[];
};

/** `09:00:00` as 540. */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);

  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Which day of the week a calendar date is. UTC, so no offset can shift it. */
function dayOfWeek(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);

  return new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
}

/** Overlapping stretches merged, so two shifts that touch draw as one. */
function merge(spans: Span[]): Span[] {
  if (spans.length === 0) return [];

  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const out: Span[] = [sorted[0]!];

  for (const span of sorted.slice(1)) {
    const last = out[out.length - 1]!;

    if (span.from <= last.to) last.to = Math.max(last.to, span.to);
    else out.push({ ...span });
  }

  return out;
}

/**
 * The rota for a set of people across a set of days.
 *
 * Keyed `employeeId|dateKey`, because both views need a different slice of the
 * same answer: the day shows many people on one date, the week shows one
 * person across seven. One query pair serves both rather than two functions
 * that could drift.
 */
export async function getRota(input: {
  orgId: string;
  employeeIds: string[];
  dateKeys: string[];
  timezone: string;
}): Promise<Map<string, ColumnRota>> {
  const out = new Map<string, ColumnRota>();

  if (input.employeeIds.length === 0 || input.dateKeys.length === 0) return out;

  const supabase = await createSupabaseServerClient();

  /* The whole window in one go. Time off is asked for by instant because that
     is how it is stored — a holiday is a real moment, unlike a rota, which is
     a fact about the clock. Migration 013's note. */
  const first = salonDayRange(input.dateKeys[0]!, input.timezone);
  const last = salonDayRange(
    input.dateKeys[input.dateKeys.length - 1]!,
    input.timezone,
  );

  const [{ data: hours }, { data: away }] = await Promise.all([
    supabase
      .from("employee_working_hours")
      .select("employee_id, day_of_week, start_time, end_time")
      .eq("org_id", input.orgId)
      .in("employee_id", input.employeeIds)
      .is("deleted_at", null),

    supabase
      .from("employee_time_off")
      .select("employee_id, starts_at, ends_at")
      .eq("org_id", input.orgId)
      .in("employee_id", input.employeeIds)
      .is("deleted_at", null)
      .lt("starts_at", last.to)
      .gt("ends_at", first.from),
  ]);

  for (const employeeId of input.employeeIds) {
    for (const dateKey of input.dateKeys) {
      const dow = dayOfWeek(dateKey);
      const day = salonDayRange(dateKey, input.timezone);

      const working = merge(
        (hours ?? [])
          .filter(
            (row) => row.employee_id === employeeId && row.day_of_week === dow,
          )
          /* Several rows on one day is a split shift, not a bug — migration
             013 deliberately has no unique constraint. */
          .map((row) => ({
            from: toMinutes(row.start_time),
            to: toMinutes(row.end_time),
          })),
      );

      const off = merge(
        (away ?? [])
          .filter((row) => row.employee_id === employeeId)
          .map((row) => {
            /* Clipped to this day, then read as wall-clock minutes. A holiday
               that swallows the whole day lands as 00:00 to 24:00 rather than
               as whatever hour it happens to start on. */
            const from = row.starts_at > day.from ? row.starts_at : day.from;
            const to = row.ends_at < day.to ? row.ends_at : day.to;

            if (from >= to) return null;

            return {
              from:
                from === day.from ? 0 : salonMinutes(from, input.timezone),
              to: to === day.to ? 1440 : salonMinutes(to, input.timezone),
            };
          })
          .filter((span): span is Span => span !== null),
      );

      out.set(`${employeeId}|${dateKey}`, { working, off });
    }
  }

  return out;
}

/**
 * Several people's rotas as one.
 *
 * The assistants share a column, so it is open whenever ANY of them is in.
 * Shading it by one person's hours would say the salon is shut while somebody
 * is standing in it.
 */
export function combine(rotas: ColumnRota[]): ColumnRota {
  return {
    working: merge(rotas.flatMap((rota) => rota.working)),
    /* Time off is only drawn where nobody is left to cover — an assistant on
       holiday while three others work is not a closed column. */
    off: [],
  };
}
