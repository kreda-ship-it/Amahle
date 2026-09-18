import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site/url";

/**
 * Served at /robots.txt. A note to search engines about which parts of the
 * site they may read.
 *
 * This lives at the app root rather than inside `(public)`, because
 * robots.txt has to sit at the very top of a domain to count — a route group
 * would not change the URL, but keeping it here says plainly that it covers
 * the whole site and not just the public half.
 *
 * `/staff` and `/login` are disallowed. Neither is a secret and neither is
 * protected by this file — the database is what refuses a stranger, and
 * robots.txt is a request that only polite crawlers honour. It is here so
 * that a salon's login form does not turn up in Google when somebody searches
 * their name, which is noise for a customer and mildly embarrassing for the
 * salon.
 *
 * Never list something here that actually needs protecting. A public file
 * naming your private paths is a map, not a lock.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/staff", "/login"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
