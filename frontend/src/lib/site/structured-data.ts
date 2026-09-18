import { imageUrl } from "./images";
import type { Organization } from "./organization";
import { absoluteUrl } from "./url";

/**
 * The salon, described in the format Google reads.
 *
 * This is what turns a plain blue search result into the card with opening
 * hours, a phone number and a map pin. Every fact in it is already in the
 * database and already printed on the page — this states the same things
 * again in a form a machine can be certain about, rather than one it has to
 * guess at from the layout.
 *
 * Rendered as JSON-LD inside a <script type="application/ld+json"> tag. That
 * looks alarming and is not: the browser does not execute it. `ld+json` is an
 * inert data block, and a script tag is simply where the standard puts it.
 *
 * The one rule that matters: never say anything here the page does not also
 * say in plain sight. Structured data that contradicts the visible page is
 * how a site earns a manual penalty.
 */

/** https://schema.org/HairSalon — a LocalBusiness, narrowed. */
export function salonStructuredData(org: Organization) {
  const { social, hours } = org.content;

  return {
    "@context": "https://schema.org",
    "@type": "HairSalon",
    name: org.name,
    description: org.content.about ?? org.content.tagline ?? undefined,
    url: absoluteUrl("/"),

    /*
     * A real photograph or nothing.
     *
     * This first pointed at /opengraph-image, which 404s: Next serves that
     * route under a content-hashed filename it picks itself, so the tidy path
     * does not exist. Sending Google a dead image URL is worse than sending
     * none — the generated share card is for link previews, and this field
     * wants an actual picture of the business.
     *
     * Omitted entirely until the salon has one, rather than filled with
     * something that is not theirs.
     */
    image:
      imageUrl(org.content.heroImagePath) ??
      imageUrl(org.content.logoPath) ??
      undefined,

    telephone: org.phone ?? undefined,
    email: org.email ?? undefined,

    /*
     * The address as one string, not a broken-out PostalAddress.
     *
     * Google prefers PostalAddress with streetAddress, addressLocality,
     * addressRegion and postalCode as separate fields, and schema.org accepts
     * either. We have one text column, and splitting it on commas would work
     * for "7851 Eastern Ave, Silver Spring, MD 20910" and quietly mangle the
     * next salon's — addresses do not have a shared shape across countries,
     * and a parser that is right once is worse than no parser at all.
     *
     * The real fix is separate address columns on `organizations`. That is a
     * migration, and it should happen when a salon needs it rather than being
     * guessed at now.
     */
    address: org.address ?? undefined,

    /*
     * Opening hours, one entry per day. The stored values are already 24-hour
     * "09:00" strings, which is exactly the format this expects — the one
     * place where the database's choice of format saves a conversion.
     *
     * These are the SALON's hours. They are not employee_working_hours, which
     * arrive in Phase 4 and are what availability is computed from. Telling
     * Google the salon is open is not a promise that any particular stylist
     * is in.
     */
    openingHoursSpecification: hours.map((entry) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: entry.day,
      opens: entry.open,
      closes: entry.close,
    })),

    /*
     * `sameAs` is how a search engine confirms that this website and that
     * Instagram account are the same business. Nulls are filtered out, so a
     * salon with no TikTok simply has a shorter list rather than an entry
     * pointing nowhere.
     */
    sameAs: [social.instagram, social.tiktok, social.yelp, social.facebook].filter(
      (link): link is string => Boolean(link),
    ),
  };
}
