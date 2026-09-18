import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { getDayColumns } from "@/lib/appointments/columns";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { RotaEditor, type Shift } from "./rota-editor";
import { TimeOffEditor, type TimeOff } from "./time-off";

/**
 * Who works when.
 *
 * THE INPUT TO EVERY AVAILABILITY ANSWER IN THE SYSTEM, and until now the only
 * way to change it was to write SQL. `employee_working_hours` decides what the
 * booking form offers, what `schedule_permits()` will accept on the write path,
 * and — since the rota started being drawn — which parts of the calendar are
 * shaded. A salon that cannot say "Fikir works Saturdays now" without
 * telephoning a developer has not really been handed anything.
 *
 * ONE PERSON AT A TIME, chosen in the URL, like the week view. Seven days
 * across ten people is a spreadsheet, and a spreadsheet is what this is
 * replacing.
 *
 * TIME OFF IS HERE TOO, having first been argued into a screen of its own.
 * The tables really are different — a rota is a fact about the clock, a
 * holiday is a real moment — but that is a reason for two TABLES, not two
 * screens. "When is Fikir available" is one question, and answering half of it
 * here and half elsewhere would mean the same employee picker twice and two
 * places to check before booking somebody.
 */

export const metadata: Metadata = {
  title: "Who works when",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function RotaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  /* DECISIONS #24's roster key. Setting somebody's hours is managing the team,
     and migration 013 deliberately did not invent a second key for it. */
  await requirePermission("employee.record.manage");

  const params = await searchParams;
  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const columns = await getDayColumns(org.id);
  const everyone = [...columns.stylists, ...columns.support];

  const chosen = params.employee ?? everyone[0]?.id ?? "";

  const [{ data }, { data: away }] = chosen
    ? await Promise.all([
        supabase
          .from("employee_working_hours")
          .select("id, day_of_week, start_time, end_time")
          .eq("org_id", org.id)
          .eq("employee_id", chosen)
          .is("deleted_at", null)
          .order("day_of_week")
          .order("start_time"),

        /* Only what is still to come. A rota screen is for deciding what
           happens next; last August's holiday is history, and history lives
           in the audit log rather than in a list to scroll past. */
        supabase
          .from("employee_time_off")
          .select("id, starts_at, ends_at")
          .eq("org_id", org.id)
          .eq("employee_id", chosen)
          .gte("ends_at", new Date().toISOString())
          .is("deleted_at", null)
          .order("starts_at"),
      ])
    : [{ data: [] }, { data: [] }];

  const person = everyone.find((one) => one.id === chosen);

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-5 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <p className="label text-ink-muted">The team</p>
          <h1 className="mt-1 font-display text-3xl lg:text-4xl">
            {person?.full_name ?? "Who works when"}
          </h1>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            The ordinary week. Every booking the website offers is worked out
            from this, so a change here shows up in the booking form
            immediately.
          </p>
        </div>

        {/* A form rather than a dropdown needing JavaScript — the choice
            belongs in the URL, so a rota can be sent to somebody. */}
        <form className="flex items-center gap-2 text-sm">
          <select
            name="employee"
            defaultValue={chosen}
            aria-label="Whose rota"
            className="border border-line bg-surface px-3 py-2"
          >
            {everyone.map((one) => (
              <option key={one.id} value={one.id}>
                {one.full_name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="border border-line px-3 py-2 transition-colors hover:border-ink"
          >
            Show
          </button>
        </form>
      </header>

      {!chosen ? (
        <p className="border border-line px-4 py-8 text-center text-ink-muted">
          Nobody is on the team yet.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          <RotaEditor employeeId={chosen} shifts={(data ?? []) as Shift[]} />

          <TimeOffEditor
            employeeId={chosen}
            away={(away ?? []) as TimeOff[]}
            timezone={org.timezone}
          />
        </div>
      )}

      <p className="text-sm text-ink-muted">
        Two shifts on one day is a long lunch, and normal. Times are the
        salon&rsquo;s own clock — &ldquo;Tuesday 9am&rdquo; stays 9am when the
        clocks change.
      </p>
    </div>
  );
}
