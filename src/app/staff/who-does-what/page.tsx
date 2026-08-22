import type { Metadata } from "next";

import { requireProfile } from "@/lib/auth";
import { getServiceMatrix } from "@/lib/appointments/matrix";
import { getOrganization } from "@/lib/site/organization";

import { MatrixView } from "./matrix-view";

/**
 * Who can do what.
 *
 * The question the desk asks most often and could not answer: "can anyone do
 * knotless braids on Saturday?" Until now the only way to find out was to
 * choose the service in the booking form and see whether times came back —
 * which cannot tell "nobody here does this" apart from "everybody is busy".
 *
 * Read-only. It needs no permission beyond belonging to the salon, because
 * the public team page already lists who works here and `employee_services`
 * is readable by anonymous visitors: who performs what is exactly what a
 * customer is trying to find out.
 */

export const metadata: Metadata = {
  title: "Who does what",
};

export default async function WhoDoesWhatPage() {
  await requireProfile();

  const org = await getOrganization();
  const services = await getServiceMatrix(org.id);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-6">
      <header className="border-b border-line pb-4">
        <p className="label text-ink-muted">The team</p>
        <h1 className="mt-1 font-display text-3xl">Who does what</h1>
      </header>

      <MatrixView services={services} />
    </div>
  );
}
