"use client";

import {
  STATUSES,
  statusMeta,
  type StatusKey,
} from "@/lib/appointments/status";

import { useRemembered } from "./remembered";

/**
 * The status key, which is also the highlighter.
 *
 * ITS OWN BOX, and that is the whole point of this file. The key used to be
 * handed to `DatePicker` and rendered inside it, on the reasoning that both
 * are small panels you consult rather than work in. True, and it had a fault
 * nobody noticed until the calendar learned to stay folded: the calendar's
 * collapsed state returns a single date chip and nothing else, so hiding the
 * calendar hid the highlighter too — and once that state was remembered, the
 * only way to mark an appointment disappeared permanently.
 *
 * Two panels that fold independently. Consulting the calendar and marking a
 * day are different jobs, and a day spent marking wants the key open and the
 * month grid gone.
 *
 * THE BRUSH SURVIVES FOLDING, and the chip says so. A hidden panel with a
 * live brush would mean tapping an appointment silently changed it, which is
 * the sort of thing that teaches people not to touch anything. So the
 * collapsed chip carries the status it is currently marking with, in its
 * colour AND in words.
 */

type Props = {
  /*
   * May this person actually mark, or is this only a legend? A stylist holds
   * no appointment permission and may still mark her own work, so the answer
   * is not a role — the caller works it out and the database decides which
   * rows. See migration 042.
   */
  canMark: boolean;
  brush: StatusKey | null;
  onBrush: (next: StatusKey | null) => void;
};

export function StatusPanel({ canMark, brush, onBrush }: Props) {
  const [shown, setShown] = useRemembered("staff-status-key-shown", true);

  const active = brush ? statusMeta(brush) : null;

  if (!shown) {
    return (
      <button
        type="button"
        onClick={() => setShown(true)}
        aria-expanded={false}
        title={canMark ? "Show the status key" : "Show the key"}
        className="flex shrink-0 items-center gap-2 border border-line bg-surface px-3 py-2 text-sm transition-colors hover:border-ink"
      >
        {active ? (
          <>
            <span
              aria-hidden
              className="size-3 shrink-0"
              style={{ background: `var(${active.token})` }}
            />
            <span>Marking {active.label.toLowerCase()}</span>
          </>
        ) : (
          <>
            <span aria-hidden>✎</span>
            <span>{canMark ? "Mark" : "Key"}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="w-[17rem] max-w-full shrink-0 border border-line bg-surface p-2.5">
      <div className="flex items-start justify-between gap-2">
        {/* What the panel is for, which changes as you use it. Somebody who
            may only look gets a legend and is told so. */}
        <p className="label text-ink-muted">
          {!canMark
            ? "Status key"
            : brush
              ? "Tap a booking to mark it"
              : "Pick a status to mark with"}
        </p>

        <button
          type="button"
          onClick={() => setShown(false)}
          aria-expanded
          aria-label="Hide the status key"
          title="Hide the status key"
          className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center text-ink-muted transition-colors hover:text-ink"
        >
          <span aria-hidden>✕</span>
        </button>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {STATUSES.map((status) => {
          const selected = brush === status.key;

          return (
            <button
              key={status.key}
              type="button"
              disabled={!canMark}
              aria-pressed={canMark ? selected : undefined}
              onClick={() => onBrush(selected ? null : status.key)}
              className={`flex items-center gap-2 border px-2 py-1 text-sm transition-colors ${
                selected
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
    </div>
  );
}
