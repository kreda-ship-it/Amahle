"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createPlan } from "../plan-actions";

/**
 * The + at the end of the tabs.
 *
 * Sheets in a spreadsheet, which is how this was described and is the right
 * comparison: a plan is a scratch surface you may want several of, and the
 * cost of a new one should be one tap rather than a form.
 *
 * It names itself after the date and lets the name be changed later, because
 * demanding a name up front is a question asked before anybody knows the
 * answer — you find out what a plan is for by making it.
 */
export function NewPlanTab({
  planDate,
  orgId,
  profileId,
}: {
  planDate: string;
  orgId: string;
  profileId: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [failed, setFailed] = useState(false);

  function add() {
    start(async () => {
      const result = await createPlan(planDate, planDate, profileId, orgId);

      if (!result.ok) {
        setFailed(true);
        return;
      }

      router.push(`/staff/plan?date=${planDate}&plan=${result.id}`);
    });
  }

  return (
    <button
      type="button"
      onClick={add}
      disabled={busy}
      title="Another plan for this day"
      aria-label="Another plan for this day"
      className="border-b-2 border-transparent px-3 py-2 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-40"
    >
      {busy ? "…" : failed ? "could not" : "+"}
    </button>
  );
}
