import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { imageUrl } from "@/lib/site/images";
import { getOrganization } from "@/lib/site/organization";
import { salonStructuredData } from "@/lib/site/structured-data";
import { mapsHref, siteUrl } from "@/lib/site/url";

/**
 * The chrome every public page shares — the header at the top and the footer
 * at the bottom.
 *
 * `(public)` in parentheses is a route group: it organises files without
 * appearing in the URL. So this folder's `page.tsx` is still `/`, while
 * `/login` and `/staff` live outside the group and do not get a salon's header
 * and footer wrapped around them. Those are a tool; this is a shopfront.
 */

/**
 * Turns a printed phone number into something a phone can dial.
 *
 * `(301) 495-0114` has to become `tel:3014950114`, because the brackets and
 * spaces are for a human reading it. A leading `+` is kept — it is the one
 * punctuation mark that carries meaning, and dropping it would break any
 * number written in international form.
 */
function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");

  return `tel:${digits.startsWith("+") ? digits : digits.replace(/\+/g, "")}`;
}

function smsHref(phone: string): string {
  return telHref(phone).replace("tel:", "sms:");
}

export async function generateMetadata(): Promise<Metadata> {
  const org = await getOrganization();

  const description =
    org.content.about ?? org.content.tagline ?? `${org.name} — book by phone.`;

  return {
    /*
     * The address every other tag is measured against. Without it, Next
     * writes the share image as `/opengraph-image`, and WhatsApp — which is
     * fetching from its own servers, not from ours — has no idea what that
     * means, so the card arrives with no picture.
     */
    metadataBase: siteUrl(),

    title: {
      // The homepage sets no title of its own, so it gets this one.
      default: org.name,
      // Every other public page gets its own name plus the salon's. Defined
      // here rather than in the root layout because the root must not know
      // which salon it is serving.
      template: `%s · ${org.name}`,
    },
    description,

    /*
     * What WhatsApp, iMessage, Instagram, Slack and LinkedIn read when
     * somebody pastes a link. Without these the link renders as a bare URL —
     * no name, no description, no picture — which for a business that grows
     * by word of mouth is the version that costs the most.
     *
     * No `images` key: Next finds `opengraph-image.tsx` in this folder by
     * filename and fills it in, at the right size, with a cache-busting hash.
     *
     * `type: "website"` rather than "business.business". The business type
     * demands a street address in a rigid format and adds nothing that the
     * structured data on the page does not already say properly.
     */
    openGraph: {
      type: "website",
      siteName: org.name,
      title: org.name,
      description,
      url: siteUrl().toString(),
      locale: "en_US",
    },

    // X reads Open Graph as a fallback, but naming the card type is what
    // gets the large image rather than a thumbnail beside the text.
    twitter: {
      card: "summary_large_image",
      title: org.name,
      description,
    },
  };
}

/**
 * The salon's town, pulled off the front of its address.
 *
 * "7851 Eastern Ave, Silver Spring, MD 20910" is written the way a postal
 * service wants it, and the line under the shop name wants only the middle
 * part. Splitting on commas is crude, and it is right for every address the
 * form accepts: number and street, town, then state and ZIP.
 *
 * Returns null rather than guessing when the address is a single line — a
 * missing town prints nothing, which is better than printing half a street.
 */
function townOf(address: string | null): string | null {
  if (!address) return null;

  const parts = address.split(",").map((part) => part.trim());

  return parts.length >= 2 ? (parts[1] ?? null) : null;
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await getOrganization();
  const { social } = org.content;
  const logo = imageUrl(org.content.logoPath);
  const town = townOf(org.address);

  const socialLinks = [
    { label: "Instagram", href: social.instagram },
    { label: "TikTok", href: social.tiktok },
    { label: "Yelp", href: social.yelp },
    { label: "Facebook", href: social.facebook },
  ].filter((link) => link.href !== null);

  const navLinks = [
    { label: "Services", href: "/services" },
    { label: "Team", href: "/team" },
    { label: "Gallery", href: "/gallery" },
    { label: "Visit", href: "/contact" },
  ];

  const establishedLine = [
    org.content.foundedYear ? `Est. ${org.content.foundedYear}` : null,
    town,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      {/*
        The salon described in the format Google reads — what turns a plain
        blue search result into the card with hours, a phone number and a map
        pin. Inert data, not code: the browser does not execute ld+json.

        `dangerouslySetInnerHTML` is the only way to put raw text inside a
        script tag in React, and the name is a warning about untrusted input.
        This input is not untrusted — it is our own object, serialised by
        JSON.stringify, which escapes everything a salon could type into its
        own name. Nothing here comes from a visitor.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(salonStructuredData(org)),
        }}
      />

      {/*
        Everything public lives inside `theme-dark`. The class carries the
        palette (see globals.css) — the staff area sits outside it and stays
        light, which is why the tool and the shopfront can look nothing alike
        while sharing every component.
      */}
      <div className="theme-dark flex flex-1 flex-col">
      {/*
        The header follows you down the page.

        `sticky` rather than `fixed`: a sticky element still takes up its own
        space at the top of the document, so nothing has to be pushed down by
        a matching margin that then has to be kept in step by hand.

        `backdrop-blur` with a nearly-opaque background is what stops the
        photographs underneath from showing through as mud while still giving
        the bar a sense of depth as content slides under it.
      */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="shell flex h-20 items-center justify-between gap-6 lg:h-24">
          {/*
            A logo when the salon has one, its name set in type when it does
            not. The alt text is the salon's name either way — a logo's job is
            to say who this is, so that is what someone using a screen reader
            needs to hear. Never "logo".
          */}
          <Link href="/" className="flex min-w-0 items-center gap-4">
            {/*
              A logo when the salon has one, its name set in type when it does
              not. The alt text is the salon's name either way — a logo's job
              is to say who this is, so that is what somebody using a screen
              reader needs to hear. Never "logo".

              `blend-gold` is what makes gold-on-black artwork sit on the bar
              with no visible rectangle around it — see the note on the
              utility in globals.css.
            */}
            {logo ? (
              <Image
                src={logo}
                alt={org.name}
                width={1164}
                height={824}
                priority
                className="blend-gold h-12 w-auto lg:h-16"
              />
            ) : (
              <span className="truncate font-display text-xl leading-none tracking-wide text-ink lg:text-2xl">
                {org.name}
              </span>
            )}

            {/*
              Hidden below `lg`. On a phone the logo alone fills the bar, and
              a founding year squeezed in beside it is the first thing to wrap
              onto a second line and break the header.
            */}
            {establishedLine && (
              <span className="label hidden shrink-0 text-ink-muted lg:inline">
                {establishedLine}
              </span>
            )}
          </Link>

          <div className="flex items-center gap-6">
            {/*
              The full menu appears once there is room for it. Below that the
              four pages are reachable from the footer and from the site's own
              sections, and the bar keeps the one control that matters.
            */}
            <nav className="hidden md:block">
              <ul className="flex items-center gap-7">
                {navLinks.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-ink-muted transition-colors hover:text-ink"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>

            {org.phone && (
              <a
                href={telHref(org.phone)}
                className="hidden text-sm text-ink-muted transition-colors hover:text-ink lg:block"
              >
                {org.phone}
              </a>
            )}

            <Link
              href="/book"
              className="btn bg-brand px-7 py-3 text-ink-inverse hover:bg-brand-strong"
            >
              Book
            </Link>
          </div>
        </div>

        {/*
          The same four links again, as a row under the bar, for the screens
          too narrow to fit them beside the logo.

          A scrolling row rather than a hamburger menu. A menu button needs
          JavaScript, a state variable, an outside-click handler and a focus
          trap to be usable with a keyboard — all of that to hide four words
          that fit on the screen anyway.
        */}
        <nav className="border-t border-line md:hidden">
          <ul className="shell flex gap-6 overflow-x-auto py-3">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="label whitespace-nowrap text-ink-muted transition-colors hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-20 bg-surround text-ink">
        <div className="shell grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:py-16">
          <div className="lg:col-span-2">
            <h2 className="font-display text-3xl font-light">
              {org.name}
            </h2>

            {org.content.tagline && (
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-ink-muted">
                {org.content.tagline}
              </p>
            )}
          </div>

          <div>
            <h3 className="label text-ink-muted">Visit</h3>

            {org.address && (
              <p className="mt-4 text-sm leading-relaxed">
                <a
                  href={mapsHref(org.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ink/80 underline decoration-line underline-offset-4 transition-colors hover:text-brand hover:decoration-brand"
                >
                  {org.address}
                </a>
              </p>
            )}

            <ul className="mt-4 space-y-1.5 text-sm">
              {org.phone && (
                <li>
                  <a
                    className="transition-colors hover:text-brand"
                    href={telHref(org.phone)}
                  >
                    {org.phone}
                  </a>
                </li>
              )}

              {org.content.textNumber && (
                <li>
                  <a
                    className="transition-colors hover:text-brand"
                    href={smsHref(org.content.textNumber)}
                  >
                    Text {org.content.textNumber}
                  </a>
                </li>
              )}

              {org.email && (
                <li>
                  <a
                    className="transition-colors hover:text-brand"
                    href={`mailto:${org.email}`}
                  >
                    {org.email}
                  </a>
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="label text-ink-muted">More</h3>

            <ul className="mt-4 space-y-1.5 text-sm">
              {navLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="transition-colors hover:text-brand"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}

              {socialLinks.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="transition-colors hover:text-brand"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-line">
          <div className="shell flex flex-wrap justify-between gap-3 py-5 text-xs text-ink-muted">
            <p>
              © {new Date().getFullYear()} {org.name}
            </p>

            {/*
              Straight to /staff, with no check for whether anyone is logged
              in. /staff already sends a logged-out visitor to /login, so
              asking the database here would cost a query on every public page
              load and change nothing a visitor sees.
            */}
            <Link href="/staff" className="transition-colors hover:text-brand">
              Staff sign in
            </Link>
          </div>
        </div>
      </footer>
      </div>
    </>
  );
}
