import type { MetadataRoute } from "next";

import { absoluteUrl } from "@/lib/site/url";

/**
 * Served at /sitemap.xml — a plain list of every public page, so a search
 * engine does not have to discover them by following links.
 *
 * Five pages is small enough that Google would find them all anyway. It costs
 * almost nothing, and it means a page added later is found in days rather
 * than whenever a crawler happens back.
 *
 * The staff area is absent, matching robots.ts. A sitemap is an invitation;
 * there is no sense inviting a crawler to a login form.
 *
 * `priority` is a hint about relative importance within this site, not a
 * ranking lever — it says the homepage matters more than the gallery, and
 * nothing about how this salon compares to any other. `changeFrequency` is
 * likewise advisory. Both are widely ignored; neither is worth agonising
 * over.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const updated = new Date();

  return [
    {
      url: absoluteUrl("/"),
      lastModified: updated,
      changeFrequency: "monthly",
      priority: 1,
    },
    {
      // The page most likely to be the reason somebody searched at all.
      url: absoluteUrl("/services"),
      lastModified: updated,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: absoluteUrl("/team"),
      lastModified: updated,
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: absoluteUrl("/gallery"),
      lastModified: updated,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: absoluteUrl("/contact"),
      lastModified: updated,
      changeFrequency: "yearly",
      priority: 0.8,
    },
  ];
}
