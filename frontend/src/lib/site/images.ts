import { SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Turns a stored image path into a web address the browser can fetch.
 *
 * The database holds a path — `<org_id>/hero/shopfront.jpg` — and never a full
 * address. This function is the only place in the codebase that knows how to
 * turn one into the other, which is the entire payoff for storing paths:
 *
 *   Today  https://zpndfluiyrvvujyasdbo.supabase.co/storage/v1/...
 *   Later  https://<the-production-project>.supabase.co/storage/v1/...
 *
 * The address is built from the same NEXT_PUBLIC_SUPABASE_URL the database
 * clients use. So on the day the production project exists, every photograph
 * on the site moves with it and nobody edits a single row. Had we stored full
 * addresses, every image would break at once — silently, because a dead image
 * is not an error anyone gets told about. See migration 011.
 *
 * Null in, null out. A salon with no logo has nothing to render, which is an
 * ordinary state rather than a fault, and the pages check for null and skip
 * the image entirely instead of showing a broken-image icon.
 */

/** The one public bucket holding every salon's website images. */
const BUCKET = "site-images";

export function imageUrl(path: string | null | undefined): string | null {
  if (!path) return null;

  // A path stored as `/hero/x.jpg` and one stored as `hero/x.jpg` mean the
  // same thing to a person and different things to a URL. Strip the leading
  // slash so both work.
  const cleanPath = path.replace(/^\/+/, "");

  // Likewise a trailing slash on the project URL would produce a double
  // slash, which some CDNs treat as a different address entirely.
  const base = SUPABASE_URL().replace(/\/+$/, "");

  return `${base}/storage/v1/object/public/${BUCKET}/${cleanPath}`;
}
