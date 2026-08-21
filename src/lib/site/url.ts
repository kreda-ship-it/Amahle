/**
 * Where this site lives on the internet.
 *
 * Almost nothing needs to know this. Links inside the site are written as
 * `/services` and the browser works the rest out. But three things cannot use
 * a relative address, because the thing reading them is not a browser sitting
 * on our site:
 *
 *   - Open Graph tags. WhatsApp fetches the share image from its own servers.
 *     `/opengraph-image` means nothing to WhatsApp.
 *   - sitemap.xml. Google is told the address of every page, in full.
 *   - Structured data, for the same reason.
 *
 * Three sources, in order of how much they can be trusted:
 *
 *   1. NEXT_PUBLIC_SITE_URL — set deliberately. Once there is a real domain,
 *      this is the answer, and it is the only one that survives a custom
 *      domain being pointed at the deployment.
 *   2. VERCEL_PROJECT_PRODUCTION_URL — Vercel sets this by itself. It is the
 *      stable production address rather than the per-deployment preview URL,
 *      so a preview build does not advertise itself to Google as the real
 *      site.
 *   3. localhost, for development.
 *
 * A wrong value here fails quietly and badly: every share card and every
 * sitemap entry points somewhere that does not exist, and nothing errors.
 */
const FALLBACK = "http://localhost:3000";

export function siteUrl(): URL {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  // Vercel gives a bare hostname with no scheme, and it is always https.
  const raw = explicit || (vercel ? `https://${vercel}` : FALLBACK);

  try {
    return new URL(raw);
  } catch {
    // A malformed variable should not take the whole site down over a
    // share card. Fall back and carry on.
    return new URL(FALLBACK);
  }
}

/** An absolute address for a path within this site. */
export function absoluteUrl(path: string): string {
  return new URL(path, siteUrl()).toString();
}

/**
 * A link that opens this address in whatever map app the visitor uses.
 *
 * Google's universal search URL rather than `maps://` or an Apple Maps link.
 * On an iPhone this hands off to the Maps or Google Maps app if either is
 * installed and falls back to the browser if neither is; on Android it opens
 * Google Maps; on a desktop it opens a map in a tab. One address that works
 * everywhere beats sniffing the visitor's device and guessing wrong.
 *
 * A search rather than a pinned coordinate, deliberately. This address pairs a
 * Washington DC street with a Maryland ZIP — see SESSION_LOG, 2026-08-15 — and
 * a search is honest about being a best guess where a dropped pin would look
 * authoritative and send somebody to the wrong door.
 */
export function mapsHref(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
