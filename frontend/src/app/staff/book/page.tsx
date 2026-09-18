import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { getStaffServices } from "@/lib/appointments/menu";
import { salonDateKey } from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";

import { EntryForm } from "./entry-form";

/**
 * Taking a booking over the telephone.
 *
 * PROJECT.md calls this the feature that decides whether the project survives
 * contact with reality. The salon will not stop taking phone bookings, so a
 * calendar that only receives what the website sends is wrong within a day,
 * and a calendar staff do not trust is one they abandon for paper.
 *
 * It is also the first screen in the application that can reach the booking
 * engine built on 2026-08-22 — the service tree, priced answers, a visit
 * founded by a stylist and finished by an assistant. The public site still
 * books single-employee visits through the older function.
 *
 * This page fetches only what does not depend on a choice: the salon, and the
 * whole menu. Everything after the first tap — what a service asks, who can
 * lead it, what it costs, when it can start — comes from the server actions in
 * `actions.ts`, because all of it depends on answers nobody has given yet.
 */

export const metadata: Metadata = {
  title: "New booking",
};

/* Never cached. The times offered are a picture of the calendar as it is now,
   and a cached one would offer slots taken ten minutes ago. */
export const dynamic = "force-dynamic";

export default async function NewBookingPage() {
  /*
   * The page guards itself, and it guards on the permission rather than merely
   * on being logged in. A stylist holds none of the appointment keys, so this
   * sends them back to the day view rather than showing a form the database
   * would refuse at the end.
   */
  await requirePermission("appointment.create");

  const org = await getOrganization();
  const services = await getStaffServices(org.id);
  const today = salonDateKey(new Date(), org.timezone);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="border-b border-line pb-4">
        <p className="label text-ink-muted">Phone booking</p>
        <h1 className="mt-1 font-display text-3xl">New booking</h1>
      </header>

      <EntryForm
        services={services}
        today={today}
        currency={org.currency}
        timezone={org.timezone}
      />
    </div>
  );
}
