import type { Metadata } from "next";

import { formatTime } from "@/lib/site/hours";
import { getOrganization } from "@/lib/site/organization";

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
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="font-display text-4xl font-semibold sm:text-5xl">
        Visit Us
      </h1>

      <p className="mt-4 max-w-2xl text-lg text-ink-muted text-pretty">
        Call to book, or come in and say hello.
      </p>

      <div className="mt-12 grid gap-12 sm:grid-cols-2">
        <section>
          <h2 className="font-display text-xl font-semibold">Where we are</h2>

          {org.address ? (
            <>
              {/*
                <address> is the correct element for contact details of the
                page's owner, and browsers and screen readers treat it as such.
                It italicises by default, which is not wanted here.
              */}
              <address className="mt-3 not-italic text-ink-muted">
                {org.address}
              </address>

              {directionsUrl && (
                <a
                  href={directionsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block font-medium text-brand hover:text-brand-strong"
                >
                  Get directions
                </a>
              )}
            </>
          ) : (
            <p className="mt-3 text-ink-muted">
              Call us and we will point you the right way.
            </p>
          )}
        </section>

        <section>
          <h2 className="font-display text-xl font-semibold">Reach us</h2>

          <ul className="mt-3 space-y-2 text-ink-muted">
            {org.phone && (
              <li>
                <a
                  href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
                  className="hover:text-brand"
                >
                  {org.phone}
                </a>
              </li>
            )}

            {textNumber && (
              <li>
                <a
                  href={`sms:${textNumber.replace(/[^\d+]/g, "")}`}
                  className="hover:text-brand"
                >
                  {textNumber} <span className="text-sm">(text)</span>
                </a>
              </li>
            )}

            {org.email && (
              <li>
                <a href={`mailto:${org.email}`} className="hover:text-brand">
                  {org.email}
                </a>
              </li>
            )}
          </ul>
        </section>
      </div>

      {hours.length > 0 && (
        <section className="mt-12">
          <h2 className="font-display text-xl font-semibold">Opening hours</h2>

          {/*
            All seven days, one per row, rather than the homepage's collapsed
            runs. Somebody on this page came looking for one particular day.
          */}
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {hours.map((entry) => (
              <li
                key={entry.day}
                className="flex justify-between gap-6 py-3 text-ink-muted"
              >
                <span className="font-medium text-ink">{entry.day}</span>
                <span className="whitespace-nowrap">
                  {formatTime(entry.open)} – {formatTime(entry.close)}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-ink-muted">
            Hours can change on public holidays. Call ahead if you are making a
            special trip.
          </p>
        </section>
      )}

      {promotion && (
        <p className="mt-12 rounded-2xl bg-surface-sunk px-6 py-5 text-ink-muted text-pretty">
          {promotion}
        </p>
      )}

      {org.phone && (
        <div className="mt-12">
          <a
            href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
            className="inline-block rounded-full bg-brand px-6 py-3 font-medium text-white transition-colors hover:bg-brand-strong"
          >
            Call {org.phone}
          </a>
        </div>
      )}
    </div>
  );
}
