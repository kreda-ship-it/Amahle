import type { Metadata } from "next";

import { currentEmployeeId, requireProfile } from "@/lib/auth";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { DetailsForm } from "./details-form";

/**
 * You.
 *
 * PROFILE AND EMPLOYEE ARE TWO THINGS and this screen is where that stops
 * being an abstraction. A profile can log in; an employee performs services.
 * The owner who never touches hair has the first and not the second; a stylist
 * who does not use the system has the second and not the first. So this page
 * shows a login always, and a roster entry only when there is one — rather
 * than assuming everybody signed in is on the calendar.
 *
 * WHAT IS EDITABLE AND WHAT IS MERELY SHOWN. Four fields, enforced in Postgres
 * by `update_my_employee_details()`. The rota below is read-only: setting who
 * works when is `employee.record.manage`, and a stylist rewriting her own
 * hours is a conversation with the owner rather than a form.
 */

export const metadata: Metadata = {
  title: "You",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday",
  "Thursday", "Friday", "Saturday",
];

/** `09:00:00` as `09:00` — the seconds are noise on a rota. */
function shortTime(value: string): string {
  return value.slice(0, 5);
}

export default async function MePage() {
  const profile = await requireProfile();
  const org = await getOrganization();
  const employeeId = await currentEmployeeId();

  const supabase = await createSupabaseServerClient();

  const employee = employeeId
    ? (
        await supabase
          .from("employees")
          .select("id, full_name, position, phone, email, bio, is_bookable")
          .eq("id", employeeId)
          .maybeSingle()
      ).data
    : null;

  const hours = employeeId
    ? (
        await supabase
          .from("employee_working_hours")
          .select("day_of_week, start_time, end_time")
          .eq("employee_id", employeeId)
          .is("deleted_at", null)
          .order("day_of_week")
          .order("start_time")
      ).data ?? []
    : [];

  const timeOff = employeeId
    ? (
        await supabase
          .from("employee_time_off")
          .select("starts_at, ends_at")
          .eq("employee_id", employeeId)
          .gte("ends_at", new Date().toISOString())
          .is("deleted_at", null)
          .order("starts_at")
      ).data ?? []
    : [];

  const dayFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: org.timezone,
    day: "numeric",
    month: "short",
  });

  return (
    <div className="flex max-w-3xl flex-col gap-6 p-5 lg:p-8">
      <header>
        <p className="label text-ink-muted">{profile.role.display_name}</p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">
          {profile.full_name}
        </h1>
        {employee?.position && (
          <p className="mt-1 text-ink-muted">{employee.position}</p>
        )}
      </header>

      <section className="border border-line">
        <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
          Your login
        </h2>
        <dl className="divide-y divide-line text-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-muted">Email you sign in with</dt>
            <dd>{profile.email}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-ink-muted">Role</dt>
            <dd>{profile.role.display_name}</dd>
          </div>
        </dl>
        {/* Changing a role is changing what somebody may do, which is the
            owner's decision and not a field on your own page. */}
        <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
          Your role decides what you can see and do. Only the owner can change
          it.
        </p>
      </section>

      {employee ? (
        <>
          <section className="border border-line">
            <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
              Your details
            </h2>
            <DetailsForm
              phone={employee.phone}
              email={employee.email}
              bio={employee.bio}
            />
          </section>

          <section className="border border-line">
            <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
              Your week
            </h2>

            {hours.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">
                No working hours set.
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {hours.map((row, index) => (
                  <li
                    key={index}
                    className="flex justify-between gap-4 px-4 py-2.5"
                  >
                    <span>{DAYS[row.day_of_week]}</span>
                    <span className="tabular-nums text-ink-muted">
                      {shortTime(row.start_time)} – {shortTime(row.end_time)}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            {/* Several rows for one day is a split shift, not a mistake —
                SCHEMA.md is explicit that most salon rotas look like this. */}
            <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
              Two rows for one day is a split shift. Ask the owner or a manager
              to change your hours.
            </p>
          </section>

          <section className="border border-line">
            <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
              Time off coming up
            </h2>

            {timeOff.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-muted">
                Nothing booked off.
              </p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {timeOff.map((row, index) => (
                  <li key={index} className="px-4 py-2.5">
                    {dayFormat.format(new Date(row.starts_at))} –{" "}
                    {dayFormat.format(new Date(row.ends_at))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        /* A real state, not an error: an owner or a receptionist can log in
           without ever appearing on the calendar. */
        <section className="border border-line px-4 py-6 text-sm text-ink-muted">
          You have a login but no place on the calendar, which is normal for
          somebody who does not perform services. There is nothing to edit
          here.
        </section>
      )}
    </div>
  );
}
