import type { Metadata } from "next";

import { can, requireProfile } from "@/lib/auth";
import { getServiceMatrix } from "@/lib/appointments/matrix";
import { getOrganization } from "@/lib/site/organization";
import { createSupabaseServerClient } from "@/lib/supabase/server";

import { MatrixView, type RosterPerson } from "./matrix-view";

/**
 * Who can do what.
 *
 * The question the desk asks most often and could not answer: "can anyone do
 * knotless braids on Saturday?" Until now the only way to find out was to
 * choose the service in the booking form and see whether times came back —
 * which cannot tell "nobody here does this" apart from "everybody is busy".
 *
 * READABLE BY EVERYONE, EDITABLE BY FEW. It needs no permission to look at,
 * because the public team page already lists who works here and
 * `employee_services` is readable by anonymous visitors: who performs what is
 * exactly what a customer is trying to find out. Changing it is a different
 * matter, and `employee.record.manage` is the key migration 014 put on it.
 *
 * The permission is asked here and passed down as an answer. The screen never
 * decides for itself who may write — and if the answer is somehow wrong, the
 * policies refuse the write anyway. This governs which controls are DRAWN,
 * not what is allowed.
 */

export const metadata: Metadata = {
  title: "Who does what",
};

export const dynamic = "force-dynamic";

export default async function WhoDoesWhatPage() {
  await requireProfile();

  const org = await getOrganization();
  const supabase = await createSupabaseServerClient();

  const [services, canEdit, { data: roster }] = await Promise.all([
    getServiceMatrix(org.id),
    can("employee.record.manage"),
    /*
     * Who may be offered as a choice.
     *
     * `is_bookable` is in the filter and has to be, because `getServiceMatrix`
     * drops unbookable people from the lists it builds. Offering somebody the
     * matrix will not show back is a box that will not stay ticked — the write
     * succeeds, the refresh returns nothing, and the screen looks broken while
     * behaving correctly. Marking somebody bookable is the team screen's job.
     */
    supabase
      .from("employees")
      .select("id, full_name")
      .eq("org_id", org.id)
      .eq("is_active", true)
      .eq("is_bookable", true)
      .is("deleted_at", null)
      .order("display_order"),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-5 lg:p-8">
      <header className="border-b border-line pb-4">
        <p className="label text-ink-muted">The team</p>
        <h1 className="mt-1 font-display text-3xl">Who does what</h1>
        {canEdit && (
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            Open a style to say who performs it. A stylist who <em>leads</em>{" "}
            takes it from the start; somebody who <em>finishes</em> takes over
            once the founding is done. Both are read the moment you tick them —
            by the booking form, by the calendar, and by the public site.
          </p>
        )}
      </header>

      <MatrixView
        services={services}
        roster={(roster ?? []) as RosterPerson[]}
        canEdit={canEdit}
      />
    </div>
  );
}
