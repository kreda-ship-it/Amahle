/**
 * The eight statuses an appointment can hold, in one place.
 *
 * SCHEMA.md lists them and the database's check constraint enforces them; this
 * is the vocabulary the screens share so a colour, a word and an order are not
 * each decided three times over.
 *
 * `pending` and `confirmed` are not "maybe" and "yes". Every appointment holds
 * its slot from the moment it exists, because the exclusion constraint says
 * so. What they track is the salon's confidence that the customer will turn
 * up: `pending` is booked, `confirmed` is booked and reconfirmed by telephone
 * the day before. That is why a customer is told "you're booked" on a pending
 * appointment — they are.
 */

export type StatusKey =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "no_show"
  | "late_arrival";

export type StatusMeta = {
  key: StatusKey;
  /** What a person reads. Never the raw key. */
  label: string;
  /** The CSS custom property carrying its colour. See globals.css. */
  token: string;
  /**
   * False for the two that stop holding the slot. A cancelled or no-show row
   * is still shown — greyed and struck through — because a status with a
   * colour cannot also be invisible, and because "she cancelled" is something
   * the desk needs to see rather than a row that silently disappeared.
   */
  holdsTheSlot: boolean;
};

/**
 * In the order a day actually runs, which is the order the key renders in.
 * Not alphabetical, and not the order the check constraint happens to list.
 */
export const STATUSES: StatusMeta[] = [
  { key: "pending", label: "Booked", token: "--status-pending", holdsTheSlot: true },
  { key: "confirmed", label: "Confirmed", token: "--status-confirmed", holdsTheSlot: true },
  { key: "checked_in", label: "Here", token: "--status-checked-in", holdsTheSlot: true },
  { key: "in_progress", label: "In the chair", token: "--status-in-progress", holdsTheSlot: true },
  { key: "completed", label: "Done", token: "--status-completed", holdsTheSlot: true },
  { key: "late_arrival", label: "Late", token: "--status-late", holdsTheSlot: true },
  { key: "cancelled", label: "Cancelled", token: "--status-cancelled", holdsTheSlot: false },
  { key: "no_show", label: "No show", token: "--status-no-show", holdsTheSlot: false },
];

const BY_KEY = new Map(STATUSES.map((status) => [status.key, status]));

/**
 * The status, or a safe stand-in.
 *
 * A row carrying a status this file has not heard of is a database that has
 * moved ahead of the application — a new value added by migration before the
 * screen learned about it. Rendering it as its own raw key is honest and
 * cannot crash the day view, which is the screen that must never go down.
 */
export function statusMeta(key: string): StatusMeta {
  return (
    BY_KEY.get(key as StatusKey) ?? {
      key: key as StatusKey,
      label: key,
      token: "--status-pending",
      holdsTheSlot: true,
    }
  );
}
