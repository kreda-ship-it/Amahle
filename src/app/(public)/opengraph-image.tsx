import { ImageResponse } from "next/og";

import { getOrganization } from "@/lib/site/organization";

/**
 * The picture that appears when somebody shares a link to this site.
 *
 * Drawn rather than photographed, because the salon has not sent any
 * photographs and a stock photo of somebody else's salon is worse than an
 * honest card. Every word comes from the database, so the next salon gets its
 * own without this file being touched.
 *
 * Next finds this by filename — no import, no registration. The `size` and
 * `contentType` exports below are what it writes into the Open Graph tags.
 *
 * 1200×630 is the size every platform crops from, and has been for years.
 * Anything else gets cut somewhere unflattering.
 */

export const alt = "Share card";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * Rendered per request rather than once at build.
 *
 * This reads the salon's name from the database through the same client every
 * page uses, and that client reads cookies. Cookies do not exist at build
 * time, so a static render would fail — and it would fail during `next build`,
 * which is a confusing place to meet this problem.
 */
export const dynamic = "force-dynamic";

/*
 * Tailwind classes do no work here. This is not a browser: `next/og` renders
 * the markup with Satori, which understands a subset of inline CSS and no
 * stylesheet at all. Hence the hardcoded hex values — they are the same
 * tokens as globals.css, kept in step by hand, which is the trade for having
 * a share card that needs no photograph.
 */
export default async function OpengraphImage() {
  const org = await getOrganization();
  const tagline = org.content.tagline;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#fffdfb",
          padding: "72px",
          // Satori has no default font stack the way a browser does. Naming
          // the family Next bundles keeps the text from falling back to
          // something that renders as empty boxes.
          fontFamily: "sans-serif",
          color: "#1f1a17",
        }}
      >
        {/* A bar of the brand colour, so the card is recognisable at
            thumbnail size before a word of it is readable. */}
        <div
          style={{
            display: "flex",
            width: "120px",
            height: "10px",
            backgroundColor: "#8a5a2b",
            borderRadius: "999px",
          }}
        />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: org.name.length > 28 ? 64 : 78,
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
            }}
          >
            {org.name}
          </div>

          {tagline && (
            <div
              style={{
                marginTop: "24px",
                fontSize: 32,
                lineHeight: 1.35,
                color: "#6b5d54",
                // Satori does not implement line clamping, so a salon with a
                // very long tagline would push the layout. Cut it here.
                display: "flex",
              }}
            >
              {tagline.length > 120 ? `${tagline.slice(0, 117)}…` : tagline}
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            gap: "24px",
            fontSize: 26,
            color: "#6b5d54",
          }}
        >
          {org.phone && <div style={{ display: "flex" }}>{org.phone}</div>}
          {org.address && (
            <div style={{ display: "flex" }}>{org.address}</div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
