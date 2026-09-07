import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/lib/auth";
import { getDayColumns } from "@/lib/appointments/columns";
import { markableStatuses } from "@/lib/appointments/status";
import { combine, getRota } from "@/lib/appointments/rota";
import {
  salonDateKey,
  salonDayLabel,
  salonDayLabelLong,
  salonDayRange,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DayGrid, type Row } from "../day-grid";
import { NewPlanTab } from "./new-plan-tab";
import { PlanBar } from "./plan-bar";

/**
 * Planning mode.
 *
 * The same calendar in a second mode, not a second calendar — it is the same
 * `DayGrid`, given a plan instead of null. Two copies of the hardest UI in the
 * app would drift, and a planner that disagrees with the real calendar is
 * worse than no planner at all.
 *
 * CHANGES FLOW ONE WAY. A booking taken while a plan is open appears here
 * immediately, because the plan holds proposed MOVES and never a copy of the
 * day — there is nothing to keep in step. Plan changes reach the calendar only
 * on Apply. And the live day stays directly editable at /staff/day: this is an
 * overlay, not a gate.
 *
 * TABS ARE PLANS. One per day of the coming week by default, and a second for
 * the same day whenever it is wanted — "Thursday" beside "Thursday, if Fikir
 * is out". A plan carries its own name, which is what makes that free.
 */

export const metadata: Metadata = {
  title: "Planning",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

function shiftDays(dateKey: string, by: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const when = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + by));

  return when.toISOString().slice(0, 10);
}

export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* Planning is managing appointments, so it needs the same key. Somebody who
     may only look at the calendar is sent back rather than shown a board whose
     every action the database would refuse. */
  const profile = await requirePermission("appointment.manage");

  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const today = salonDateKey(new Date(), org.timezone);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? "")
    ? (params.date as string)
    : today;

  const { from, to } = salonDayRange(day, org.timezone);

  const [{ data: plansData }, { data, error }, columns] = await Promise.all([
    supabase
      .from("schedule_plans")
      .select("id, name, plan_date, applied_at, created_by")
      .eq("plan_date", day)
      .is("deleted_at", null)
      .order("created_at"),
    supabase
      .from("appointments")
      .select(
        `id, visit_id, starts_at, ends_at, blocked_until, phase, status, employee_requested,
         for_name, notes, price, source,
         employee:employees (id, full_name),
         service:services (name, is_included_with_others),
         customer:customers (id, full_name, phone)`,
      )
      .gte("starts_at", from)
      .lt("starts_at", to)
      .is("deleted_at", null)
      .order("starts_at"),
    getDayColumns(org.id),
  ]);

  const plans = plansData ?? [];

  /* The seven days around the one being planned, so a week can be worked
     through without going back to the calendar each time. */
  const week = Array.from({ length: 7 }, (_, i) => shiftDays(day, i - 3));
  const active = plans.find((p) => p.id === params.plan) ?? plans[0] ?? null;

  /*
   * The plan's entries, by appointment. The grid turns each into an offset
   * against wherever the calendar currently has that row, so a booking moved
   * by hand since the plan was written simply shrinks the proposal to
   * nothing rather than applying twice.
   */
  const moves: Record<
    string,
    {
      startsAt: string;
      employeeId: string | null;
      minutes: number | null;
      refused: string | null;
      applied: boolean;
    }
  > = {};

  let moveCount = 0;
  let refusedCount = 0;

  if (active) {
    const { data: moveRows } = await supabase
      .from("schedule_plan_moves")
      .select(
        "appointment_id, target_starts_at, target_employee_id, target_minutes, refused_reason, applied_at",
      )
      .eq("plan_id", active.id)
      .is("deleted_at", null);

    for (const move of moveRows ?? []) {
      moves[move.appointment_id] = {
        startsAt: move.target_starts_at,
        employeeId: move.target_employee_id,
        minutes: move.target_minutes,
        refused: move.refused_reason,
        applied: move.applied_at !== null,
      };

      if (move.applied_at === null) moveCount++;
      if (move.refused_reason && move.applied_at === null) refusedCount++;
    }
  }

  const supportIds = new Set(columns.support.map((person) => person.id));
  const SUPPORT = "__support__";

  const rows = ((data ?? []) as unknown as Omit<Row, "column_id">[]).map(
    (row) => ({
      ...row,
      column_id:
        !row.employee?.id || supportIds.has(row.employee.id)
          ? SUPPORT
          : row.employee.id,
    }),
  ) as Row[];

  /* Same rota the live day draws — a plan laid over a day that does not show
     who is in would propose moves onto people who are not there. */
  const rota = await getRota({
    orgId: org.id,
    employeeIds: [...columns.stylists, ...columns.support].map((p) => p.id),
    dateKeys: [day],
    timezone: org.timezone,
  });

  const heads = [
    ...columns.stylists.map((p) => ({
      id: p.id,
      label: p.full_name,
      rota: rota.get(`${p.id}|${day}`),
    })),
    ...(columns.support.length > 0
      ? [
          {
            id: SUPPORT,
            label: "Assistants",
            rota: combine(
              columns.support
                .map((p) => rota.get(`${p.id}|${day}`))
                .filter((entry) => entry !== undefined),
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4 p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="label text-ink-muted">Planning</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {salonDayLabelLong(day)}
          </h1>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <Link
            href={`/staff/plan?date=${shiftDays(day, -1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &larr;
          </Link>
          <Link
            href={`/staff/day?date=${day}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            Live calendar
          </Link>
          <Link
            href={`/staff/plan?date=${shiftDays(day, 1)}`}
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            &rarr;
          </Link>
        </div>
      </header>

      {/*
        The tabs, and the + beside them — sheets in a spreadsheet, which is
        the shape this was asked for in. More than one plan for a day is
        normal rather than an edge case: "Thursday" beside "Thursday, if Fikir
        is out". The week strip underneath is the other half of the same idea,
        because a plan belongs to a DATE and flipping between days is the
        commoner move than flipping between versions of one.
      */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1 border-b border-line">
          {plans.map((p) => (
            <Link
              key={p.id}
              href={`/staff/plan?date=${day}&plan=${p.id}`}
              aria-current={p.id === active?.id ? "page" : undefined}
              className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                p.id === active?.id
                  ? "border-brand text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {p.name}
              {p.applied_at && <span className="ml-2 text-xs">applied</span>}
            </Link>
          ))}

          <NewPlanTab planDate={day} orgId={org.id} profileId={profile.id} />
        </div>

        <div className="flex flex-wrap gap-1 text-sm">
          {week.map((d) => (
            <Link
              key={d}
              href={`/staff/plan?date=${d}`}
              aria-current={d === day ? "page" : undefined}
              className={`border px-2.5 py-1 tabular-nums transition-colors ${
                d === day
                  ? "border-ink bg-surface-sunk"
                  : "border-line text-ink-muted hover:border-ink hover:text-ink"
              }`}
              title={d}
            >
              {salonDayLabel(d)}
            </Link>
          ))}
        </div>
      </div>

      <PlanBar
        planId={active?.id ?? null}
        planName={active?.name ?? null}
        moveCount={moveCount}
        refusedCount={refusedCount}
        appliedAt={active?.applied_at ?? null}
        planDate={day}
        orgId={org.id}
        profileId={profile.id}
      />

      {error ? (
        <p className="text-ink-muted">
          The day could not be loaded. {error.message}
        </p>
      ) : (
        <DayGrid
          rows={rows}
          columns={heads}
          timezone={org.timezone}
          currency={org.currency}
          canManage
          markable={markableStatuses(true, true)}
          ownEmployeeId={null}
          columnKind="employee"
          pickerDate={day}
          today={today}
          plan={
            active && !active.applied_at
              ? { id: active.id, orgId: org.id, moves }
              : null
          }
        />
      )}
    </div>
  );
}
