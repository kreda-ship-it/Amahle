import type { OpeningHours } from "./organization";

/**
 * Printing opening hours.
 *
 * These moved out of the homepage when the contact page needed them too. Two
 * copies of a time formatter is how a site ends up saying "9:00 am" on one
 * page and "09:00" on another.
 *
 * A note on what these hours are NOT. They are the salon's hours, for display
 * to a customer. They are not `employee_working_hours`, which arrive in Phase 4
 * and are what availability is actually computed from. A salon can be open
 * while the only person who does colour is off.
 */

/** `09:00` reads as `9:00 am`. The stored value stays 24-hour and sortable. */
export function formatTime(value: string): string {
  const [hours, minutes] = value.split(":");
  const hour = Number(hours);

  if (!Number.isInteger(hour)) return value;

  const suffix = hour < 12 ? "am" : "pm";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;

  return `${hour12}:${minutes ?? "00"} ${suffix}`;
}

/**
 * Collapses runs of days that open and close at the same time, so six
 * identical rows print as "Monday – Saturday". Real opening hours are almost
 * always a few blocks rather than seven separate answers, and a salon that
 * genuinely differs every day still gets seven rows.
 */
export function groupHours(hours: OpeningHours[]): OpeningHours[][] {
  return hours.reduce<OpeningHours[][]>((groups, entry) => {
    const current = groups.at(-1);
    const previous = current?.at(-1);

    if (
      current &&
      previous &&
      previous.open === entry.open &&
      previous.close === entry.close
    ) {
      current.push(entry);
      return groups;
    }

    groups.push([entry]);
    return groups;
  }, []);
}

export function describeDays(group: OpeningHours[]): string {
  if (group.length === 1) return group[0].day;

  return `${group[0].day} – ${group[group.length - 1].day}`;
}
