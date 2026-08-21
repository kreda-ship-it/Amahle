import type { Metadata } from "next";

import { formatTime } from "@/lib/site/hours";
import { getOrganization } from "@/lib/site/organization";

import { BookingCta } from "../booking-cta";
import { PageHeading } from "../page-heading";

/**
 * Contact, hours and directions.
 *
 * The reference page. Where the homepage summarises — six identical days
 * collapsed into "Monday – Saturday" — this one lists all seven, because
 * somebody is here to answer one specific question and it is usually "are you
 * open on Sunday".
 */

export const metadata: Metadata = {
  title: "Visit Us",
  description: "Where to find us, when we are open, and how to reach us.",
};

export default async function ContactPage() {
  const org = await getOrganization();
  const { hours, textNumber, promotion } = org.content;

  /*
   * A link to a map rather than a map embedded in the page.
   *
   * On a phone this opens whichever map app the person already uses and
   * already trusts, with directions from where they are actually standing. An
   * embedded map cannot do that, loads a large third-party script, and watches
   * the visitor on the salon's behalf.
   *
   * There is a second reason today: this address is not confirmed. It pairs a
   * Washington DC street with a Maryland ZIP code, taken from the salon's own
   * website — see SESSION_LOG, 2026-08-15. A link that opens a search is
   * honest about being a best guess. A map pinned to a precise point looks
   * authoritative and would send someone to the wrong door.
   */
  const directionsUrl = org.address
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(org.address)}`
    : null;

  return (
    <>
      <PageHeading
        eyebrow="Visit"
        title="Where to find us"
        intro="Call to book, or come in and say hello."
      />

      <div className="shell grid gap-10 py-10 sm:grid-cols-2">
        <section>
          <h2 className="label border-b border-brand/30 pb-3 text-ink">
            Where we are
          </h2>

          {org.address ? (
            <>
              {/*
                <address> is the correct element for contact details of the
                page's owner, and browsers and screen readers treat it as such.
                It italicises by default, which is not wanted here.
              */}
              <address className="mt-4 not-italic">
                <a
                  href={directionsUrl ?? "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-display text-2xl leading-snug text-pretty underline decoration-brand/40 underline-offset-8 transition-colors hover:decoration-brand"
                >
                  {org.address}
                </a>
              </address>

              {directionsUrl && (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="label mt-3 inline-block border-b border-brand pb-1 text-brand transition-colors hover:border-brand-strong hover:text-brand-strong"
                >
                  Directions &rarr;
                </a>
              )}
            </>
          ) : (
            <p className="mt-4 text-ink-muted">
              Call us and we will point you the right way.
            </p>
          )}
        </section>

        <section>
          <h2 className="label border-b border-brand/30 pb-3 text-ink">Reach us</h2>

          <ul className="mt-4 space-y-2">
            {org.phone && (
              <li>
                <a
                  href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                  className="font-display text-2xl font-normal transition-colors hover:text-brand"
                >
                  {org.phone}
                </a>
              </li>
            )}

            {textNumber && (
              <li>
                <a
                  href={`sms:${textNumber.replace(/[^\d+]/g, "")}`}
                  className="transition-colors hover:text-brand"
                >
                  {textNumber} <span className="label text-ink-muted">Text</span>
                </a>
              </li>
            )}

            {org.email && (
              <li>
                <a
                  href={`mailto:${org.email}`}
                  className="text-ink-muted transition-colors hover:text-brand"
                >
                  {org.email}
                </a>
              </li>
            )}
          </ul>
        </section>
      </div>

      {hours.length > 0 && (
        <section className="shell pb-14">
          <h2 className="label border-b border-brand/30 pb-3 text-ink">
            Opening hours
          </h2>

          {/*
            All seven days, one per row, rather than the homepage's collapsed
            runs. Somebody on this page came looking for one particular day.
          */}
          <ul className="divide-y divide-line border-b border-line">
            {hours.map((entry) => (
              <li
                key={entry.day}
                className="label flex justify-between gap-6 py-3"
              >
                <span className="text-ink">{entry.day}</span>
                <span className="whitespace-nowrap text-ink-muted tabular-nums">
                  {formatTime(entry.open)} &ndash; {formatTime(entry.close)}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-ink-muted text-pretty">
            Hours can change on public holidays. Call ahead if you are making a
            special trip.
          </p>
        </section>
      )}

      {promotion && (
        <p className="label shell bg-surface-sunk py-5 text-center text-ink-muted">
          {promotion}
        </p>
      )}


      <BookingCta phone={org.phone} />
    </>
  );
}
