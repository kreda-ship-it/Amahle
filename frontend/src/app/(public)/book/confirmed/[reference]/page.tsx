import type { Metadata } from "next";
import Link from "next/link";

import { getBookingConfirmation } from "@/lib/appointments/confirmation";
import {
  salonDateKey,
  salonDayLabelLong,
  salonTime,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { formatPrice } from "@/lib/site/pricing";

/**
 * "You're booked."
 *
 * A real page at a real address rather than a message that vanishes on
 * refresh. The customer can bookmark it, and come back the morning of the
 * appointment to check what time they said.
 *
 * There is nothing to log in to and nothing to remember: the link is the
 * whole credential, which is the same bargain DECISIONS #8 struck when it
 * decided customers would never have accounts.
 */

export const metadata: Metadata = {
  title: "Your appointment",

  /*
   * Kept out of search results. There is nothing sensitive on the page, but a
   * booking reference has no business in an index — it is one person's link,
   * not a page of the website.
   */
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function ConfirmedPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const org = await getOrganization();
  const booking = await getBookingConfirmation(reference);

  if (!booking) {
    return (
      <div className="shell py-16">
      {/* The site margin, then a readable column inside it. */}
      <div className="max-w-2xl">
        <h1 className="font-display text-4xl font-light">
          We can&rsquo;t find that booking
        </h1>

        <p className="mt-4 text-ink-muted text-pretty">
          The link may be mistyped, or the appointment may have been removed.
          {org.phone && " Give us a ring and we will check for you."}
        </p>

        {org.phone && (
          <a
            href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
            className="mt-8 btn bg-brand text-ink-inverse hover:bg-brand-strong"
          >
            Call {org.phone}
          </a>
        )}
        </div>
      </div>
    );
  }

  const cancelled =
    booking.status === "cancelled" || booking.status === "no_show";

  const day = salonDayLabelLong(salonDateKey(booking.startsAt, org.timezone));
  // First service to last: what the customer needs to set aside, whether they
  // booked one thing or three.
  const from = salonTime(booking.startsAt, org.timezone);
  const to = salonTime(booking.endsAt, org.timezone);

  return (
    <div className="shell py-16">
      {/* The site margin, then a readable column inside it. */}
      <div className="max-w-2xl">
      {cancelled ? (
        <>
          <h1 className="font-display text-4xl font-light sm:text-4xl">
            This appointment was cancelled
          </h1>

          <p className="mt-4 text-ink-muted text-pretty">
            Here is what it was, in case you want to book again.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-4xl font-light sm:text-4xl">
            You&rsquo;re booked
          </h1>

          <p className="mt-4 text-lg text-ink-muted text-pretty">
            We have you down for {day.toLowerCase()}. Your time is held — we
            will ring you the day before to confirm.
          </p>
        </>
      )}

      <dl
        className={`mt-10 divide-y divide-line border-y border-line ${
          cancelled ? "opacity-60" : ""
        }`}
      >
        {booking.services.map((service, index) => (
          <Row
            key={`${service.serviceName}-${index}`}
            label={
              // Whose appointment it is matters more than its position, once
              // there is more than one person in the party.
              service.forName ??
              (booking.services.length > 1 ? `Service ${index + 1}` : "Service")
            }
            value={
              service.forName
                ? `${service.serviceName} with ${service.employeeName}`
                : service.serviceName
            }
          />
        ))}
        {!booking.services.some((service) => service.forName) && (
          <Row label="With" value={booking.employeeName} />
        )}
        <Row label="When" value={`${day}, ${from} – ${to}`} />
        <Row
          label={booking.services.length > 1 ? "Total" : "Price"}
          value={formatPrice(booking.total, "exact", org.currency) ?? "—"}
        />
      </dl>

      {/*
        No cancel button, deliberately. Cancelling online is not in v1, and a
        button that quietly does nothing is worse than no button. The phone
        works, and a person answering it can also offer another time — which
        is what someone cancelling usually wants anyway.
      */}
      {!cancelled && org.phone && (
        <div className="mt-10 bg-surface-sunk px-6 py-5">
          <h2 className="font-medium">Need to change or cancel?</h2>

          <p className="mt-1 text-sm text-ink-muted text-pretty">
            Call us as early as you can and we will move it for you.
          </p>

          <a
            href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
            className="mt-4 btn bg-brand text-ink-inverse hover:bg-brand-strong"
          >
            Call {org.phone}
          </a>
        </div>
      )}

      {org.address && !cancelled && (
        <p className="mt-8 text-sm text-ink-muted text-pretty">
          Find us at {org.address}.{" "}
          <Link href="/contact" className="font-medium text-brand hover:underline">
            Directions
          </Link>
        </p>
      )}

      <p className="mt-10 text-sm text-ink-muted text-pretty">
        Keep this page — it is the only record of your booking, and there is no
        account to log in to.
      </p>

      <Link
        href="/book"
        className="mt-6 inline-block text-sm font-medium text-brand hover:underline"
      >
        Book something else
      </Link>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 py-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
