"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { applyPlan, createPlan, discardPlan } from "../plan-actions";

/**
 * The plan's own controls — three actions, not two.
 *
 * Apply, Save and Discard. Save is the one people expect to be missing: a plan
 * you cannot leave and come back to is a scratchpad, not a plan, and the day
 * before a busy Saturday is worked out in pieces between telephone calls. It
 * needs no button, because every drag is already written down — which is worth
 * saying on the screen, since a form that saves silently is a form people
 * distrust.
 */
export function PlanBar({
  planId,
  planName,
  moveCount,
  refusedCount,
  appliedAt,
  planDate,
  orgId,
  profileId,
}: {
  planId: string | null;
  planName: string | null;
  moveCount: number;
  /** Entries the database would not take. They stay in the plan. */
  refusedCount: number;
  appliedAt: string | null;
  planDate: string;
  orgId: string;
  profileId: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  function make() {
    start(async () => {
      const result = await createPlan(name, planDate, profileId, orgId);

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      setNaming(false);
      setName("");
      router.push(`/staff/plan?date=${planDate}&plan=${result.id}`);
    });
  }

  function apply() {
    if (!planId) return;

    start(async () => {
      const result = await applyPlan(planId);

      /*
        Partial by design since migration 044. A plan of fifteen moves where
        one has been overtaken by a phone booking is not fifteen bad moves,
        and refusing all of them means doing the work again to change nothing.
        What makes that safe is that nothing is lost: refusals keep their
        reason and stay in the plan, marked on the block itself.
      */
      setMessage(
        result.ok
          ? `Applied ${result.moved}. ${
              refusedCount > 0
                ? `${refusedCount} still refused — they are marked in red.`
                : "Nothing left."
            }`
          : result.message,
      );

      if (result.ok) router.refresh();
    });
  }

  function discard() {
    if (!planId) return;

    start(async () => {
      const result = await discardPlan(planId);

      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      router.push(`/staff/plan?date=${planDate}`);
    });
  }

  if (!planId) {
    return (
      <div className="flex flex-wrap items-center gap-3 border border-line bg-surface-sunk px-4 py-3 text-sm">
        {naming ? (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Thursday, if Fikir is out"
              autoFocus
              className="min-w-0 flex-1 border border-line bg-surface px-3 py-2"
            />
            <button
              type="button"
              onClick={make}
              disabled={busy}
              className="border border-brand bg-brand px-3 py-2 text-ink-inverse disabled:opacity-40"
            >
              {busy ? "Starting…" : "Start"}
            </button>
            <button
              type="button"
              onClick={() => setNaming(false)}
              className="text-ink-muted underline underline-offset-4"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="text-ink-muted">
              No plan open. Dragging here would move appointments for real.
            </span>
            <button
              type="button"
              onClick={() => setNaming(true)}
              className="ml-auto border border-line px-3 py-2 transition-colors hover:border-ink"
            >
              Start a plan
            </button>
          </>
        )}

        {message && <span className="w-full text-brand">{message}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 border border-line bg-surface-sunk px-4 py-3 text-sm">
      <span className="font-medium">{planName}</span>

      <span className="text-ink-muted">
        {moveCount === 0
          ? "Nothing changed yet — drag, reassign or resize an appointment."
          : `${moveCount} ${moveCount === 1 ? "change" : "changes"}, saved as you go.`}
        {refusedCount > 0 && (
          <span className="ml-2 text-red-700">
            {refusedCount} refused
          </span>
        )}
      </span>

      {/* A plan reserves nothing, and somebody will assume otherwise. */}
      <span className="w-full text-xs text-ink-muted">
        Nothing here holds a slot. The calendar is unchanged until you apply.
      </span>

      {appliedAt ? (
        <span className="ml-auto text-ink-muted">Already applied</span>
      ) : (
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={apply}
            disabled={busy || moveCount === 0}
            className="border border-brand bg-brand px-3 py-2 text-ink-inverse transition-colors hover:bg-brand-strong disabled:opacity-40"
          >
            {busy ? "Applying…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={discard}
            disabled={busy}
            className="border border-line px-3 py-2 text-ink-muted transition-colors hover:border-ink hover:text-ink"
          >
            Discard
          </button>
        </span>
      )}

      {message && (
        <span role="alert" className="w-full text-brand">
          {message}
        </span>
      )}
    </div>
  );
}
