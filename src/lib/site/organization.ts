import { cache } from "react";

import type { Json } from "@/lib/supabase/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Which salon is this website for?
 *
 * Every public page asks this one function and gets back an organization,
 * including its `id` — which is what each page then scopes its queries by. No
 * page ever names a salon itself. That is the whole reason this file exists:
 * one set of pages serves every salon, and the only thing that differs is the
 * row they are handed.
 *
 * Today the answer comes from an environment variable, which means one
 * deployment serves one salon. That is correct for now and it is not the end
 * state. When several salons share a deployment, the slug will come from the
 * request's hostname instead — a change to the two lines inside
 * `currentOrgSlug()` and to nothing else in the application.
 *
 * Note this is not a security boundary. Every salon's name, address and
 * opening hours are public by definition, and the `organizations_select_anon`
 * policy lets an anonymous visitor read any of them. Picking the right salon
 * here is about serving the right *content*, not about hiding anything. The
 * things that genuinely must not leak — staff phone numbers, customer records
 * — are protected by column grants and row-level security in the database,
 * not by this function.
 */

/**
 * The salon this site serves when nothing says otherwise.
 *
 * A default rather than a hard requirement, so that a fresh clone runs without
 * anyone having to discover an undocumented environment variable first.
 */
const DEFAULT_ORG_SLUG = "kedus-hair-salon";

function currentOrgSlug(): string {
  return process.env.SITE_ORG_SLUG || DEFAULT_ORG_SLUG;
}

/** One day's opening hours, as the salon wants them printed. */
export type OpeningHours = {
  day: string;
  open: string;
  close: string;
};

/**
 * Social links. Every one is optional and any of them may be null — the site
 * skips a missing link entirely rather than rendering a dead icon.
 */
export type SocialLinks = {
  instagram: string | null;
  tiktok: string | null;
  yelp: string | null;
  facebook: string | null;
};

/**
 * The written content of the public site, as opposed to the salon's factual
 * details. Lives in `organizations.public_settings`, a single JSON column,
 * because it is read-only to the site, changes rarely, and nothing queries it.
 * See the note in `seed-kedus.sql` for why it is not a table.
 */
export type SiteContent = {
  tagline: string | null;
  about: string | null;
  foundedYear: number | null;
  promotion: string | null;
  textNumber: string | null;
  hours: OpeningHours[];
  social: SocialLinks;

  /*
   * Image PATHS, not addresses — `<org_id>/hero/shopfront.jpg`. Pass them
   * through `imageUrl()` from ./images to get something a browser can fetch.
   *
   * These live in public_settings rather than in a table because each is a
   * single value, exactly like the tagline. `gallery_images` is a table
   * because a gallery is a list: ordered, captioned, and changing.
   */
  heroImagePath: string | null;
  heroImageAlt: string | null;
  logoPath: string | null;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  content: SiteContent;
};

/*
 * Postgres describes a `jsonb` column as "some JSON" and nothing more, so
 * TypeScript cannot know what is inside `public_settings`. The readers below
 * check as they go and fall back rather than trust.
 *
 * That is not paranoia about attackers — only staff can write this column.
 * It is that a missing key is a completely ordinary state. A salon that has
 * not written an "about" paragraph yet should get a page without one, not a
 * crash.
 */

function asRecord(value: Json | undefined): Record<string, Json | undefined> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function asText(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function asNumber(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asHours(value: Json | undefined): OpeningHours[] {
  if (!Array.isArray(value)) return [];

  // flatMap with an empty array drops anything malformed instead of rendering
  // a row reading "undefined – undefined".
  return value.flatMap((entry) => {
    const row = asRecord(entry);
    const day = asText(row.day);
    const open = asText(row.open);
    const close = asText(row.close);

    return day && open && close ? [{ day, open, close }] : [];
  });
}

function asSocial(value: Json | undefined): SocialLinks {
  const row = asRecord(value);

  return {
    instagram: asText(row.instagram),
    tiktok: asText(row.tiktok),
    yelp: asText(row.yelp),
    facebook: asText(row.facebook),
  };
}

function readContent(value: Json | null): SiteContent {
  const row = asRecord(value ?? undefined);

  return {
    tagline: asText(row.tagline),
    about: asText(row.about),
    foundedYear: asNumber(row.founded_year),
    promotion: asText(row.promotion),
    textNumber: asText(row.text_number),
    hours: asHours(row.hours),
    social: asSocial(row.social),
    heroImagePath: asText(row.hero_image),
    heroImageAlt: asText(row.hero_image_alt),
    logoPath: asText(row.logo),
  };
}

/**
 * The salon this site serves.
 *
 * Wrapped in React's `cache()`, exactly as the functions in /lib/auth are: the
 * header, the footer, the page and the metadata all need the organization, and
 * between them they cause one database query per request rather than four.
 *
 * Throws rather than returning null. Every public page is built on top of this
 * — there is no sensible page to render without it — so a clear sentence in
 * the terminal beats each page separately discovering it has nothing.
 */
export const getOrganization = cache(async (): Promise<Organization> => {
  const slug = currentOrgSlug();
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("organizations")
    .select(
      "id, name, slug, timezone, currency, phone, email, address, public_settings",
    )
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Could not load the organization "${slug}": ${error.message}`,
    );
  }

  if (!data) {
    throw new Error(
      `No organization has the slug "${slug}". Check SITE_ORG_SLUG in ` +
        `.env.local, and check the row exists and is not soft-deleted.`,
    );
  }

  return {
    id: data.id,
    name: data.name,
    slug: data.slug,
    timezone: data.timezone,
    currency: data.currency,
    phone: data.phone,
    email: data.email,
    address: data.address,
    content: readContent(data.public_settings),
  };
});
