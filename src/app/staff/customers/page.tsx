import type { Metadata } from "next";

import { requirePermission } from "@/lib/auth";
import { recentCustomers } from "@/lib/customers/find";
import { getOrganization } from "@/lib/site/organization";

import { CustomerSearch } from "./customer-search";

/**
 * Finding a customer.
 *
 * The most-used action at any front desk, and until now it did not exist
 * anywhere in this application. `lookUpCustomer` on the booking form wants a
 * whole number and an exact match — right for recognising a caller as the
 * receptionist types, useless for "it's Sara, I was in three weeks ago, can I
 * have the same again".
 *
 * BEHIND `customer.view`, which Owner, Manager, Receptionist and Stylist all
 * hold. The page states it rather than relying on the nav to have hidden the
 * link, because a layout is not re-run between pages that share it and a
 * typed URL reaches this file directly.
 *
 * WHAT IS NOT HERE YET: opening one. A row shows a name, a number you can tap
 * to ring, an email and when they were last in — a phone book, which is most
 * of what the desk asks for. History, care notes and flags are the customer
 * record, and that is the next screen rather than a bigger version of this one.
 */

export const metadata: Metadata = {
  title: "Customers",
  robots: { index: false, follow: false },
};

/* Never cached. Somebody booked ten minutes ago has to be findable. */
export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  await requirePermission("customer.view");

  const org = await getOrganization();
  const recent = await recentCustomers(org.id);

  return (
    <div className="flex max-w-4xl flex-col gap-6 p-5 lg:p-8">
      <header>
        <p className="label text-ink-muted">The book</p>
        <h1 className="mt-1 font-display text-3xl lg:text-4xl">Customers</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Search by name, or by any part of a phone number — the last four
          digits off a missed call are enough.
        </p>
      </header>

      <CustomerSearch recent={recent} timezone={org.timezone} />
    </div>
  );
}
