import Link from "next/link";

/**
 * The band at the foot of every public page: one heading, one button.
 *
 * Somebody who has read a whole page of prices has decided. Making them
 * scroll back to the header to act on it is the cheapest way to lose them.
 *
 * A component rather than the same markup at the bottom of five files, for
 * the same reason as PageHeading: five copies drift, and a booking button
 * that looks different on the services page than on the team page reads as
 * two different websites.
 */
export function BookingCta({ phone }: { phone?: string | null }) {
  return (
    <section className="shell pb-4">
      <div className="flex flex-wrap items-center justify-between gap-8 bg-surface-sunk px-8 py-12 sm:px-12 lg:py-16">
        <div>
          <h2 className="font-display text-3xl font-light text-balance sm:text-4xl">
            Ready when you are.
          </h2>

          {phone && (
            <p className="mt-2 text-sm text-ink-muted">
              Or call{" "}
              <a
                href={`tel:${phone.replace(/[^\d+]/g, "")}`}
                className="underline underline-offset-4 transition-colors hover:text-ink"
              >
                {phone}
              </a>
            </p>
          )}
        </div>

        <Link
          href="/book"
          className="btn bg-brand text-ink-inverse hover:bg-brand-strong"
        >
          Book an appointment
        </Link>
      </div>
    </section>
  );
}
