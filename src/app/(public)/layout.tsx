import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { imageUrl } from "@/lib/site/images";
import { getOrganization } from "@/lib/site/organization";

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

  return {
    title: {
      // The homepage sets no title of its own, so it gets this one.
      default: org.name,
      // Every other public page gets its own name plus the salon's. Defined
      // here rather than in the root layout because the root must not know
      // which salon it is serving.
      template: `%s · ${org.name}`,
    },
    description: org.content.about ?? org.content.tagline ?? undefined,
  };
}

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const org = await getOrganization();
  const { social } = org.content;
  const logo = imageUrl(org.content.logoPath);

  const socialLinks = [
    { label: "Instagram", href: social.instagram },
    { label: "TikTok", href: social.tiktok },
    { label: "Yelp", href: social.yelp },
    { label: "Facebook", href: social.facebook },
  ].filter((link) => link.href !== null);

  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          {/*
            A logo when the salon has one, its name in type when it does not.
            The alt text is the salon's name either way — a logo's job is to
            say who this is, so that is what someone using a screen reader
            needs to hear. Never "logo".
          */}
          <Link href="/" className="flex items-center gap-3">
            {logo ? (
              <Image
                src={logo}
                alt={org.name}
                width={160}
                height={40}
                priority
                className="h-9 w-auto sm:h-10"
              />
            ) : (
              <span className="font-display text-lg font-semibold text-ink sm:text-xl">
                {org.name}
              </span>
            )}
          </Link>

          {/*
            One entry per page that actually exists. Team, Gallery and Contact
            add their own as they are built — a link to a page that does not
            exist is worse than no link.
          */}
          <nav className="order-last w-full sm:order-none sm:w-auto">
            <ul className="flex flex-wrap gap-5 text-sm">
              <li>
                <Link href="/services" className="hover:text-brand">
                  Services &amp; Pricing
                </Link>
              </li>
              <li>
                <Link href="/team" className="hover:text-brand">
                  Our Team
                </Link>
              </li>
              <li>
                <Link href="/gallery" className="hover:text-brand">
                  Gallery
                </Link>
              </li>
              <li>
                <Link href="/contact" className="hover:text-brand">
                  Visit Us
                </Link>
              </li>
            </ul>
          </nav>

          {org.phone && (
            <a
              href={telHref(org.phone)}
              className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-strong"
            >
              Call {org.phone}
            </a>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-16 border-t border-line bg-surface-sunk">
        <div className="mx-auto grid max-w-5xl gap-8 px-5 py-12 sm:grid-cols-2">
          <div>
            <h2 className="font-display text-lg font-semibold">{org.name}</h2>

            {org.address && (
              <p className="mt-3 text-sm text-ink-muted">{org.address}</p>
            )}

            {org.phone && (
              <p className="mt-1 text-sm">
                <a className="hover:text-brand" href={telHref(org.phone)}>
                  {org.phone}
                </a>
              </p>
            )}

            {org.content.textNumber && (
              <p className="mt-1 text-sm">
                <a
                  className="hover:text-brand"
                  href={smsHref(org.content.textNumber)}
                >
                  Text {org.content.textNumber}
                </a>
              </p>
            )}

            {org.email && (
              <p className="mt-1 text-sm">
                <a className="hover:text-brand" href={`mailto:${org.email}`}>
                  {org.email}
                </a>
              </p>
            )}
          </div>

          {socialLinks.length > 0 && (
            <div>
              <h2 className="text-sm font-medium tracking-wide text-ink-muted uppercase">
                Follow us
              </h2>

              <ul className="mt-3 space-y-1 text-sm">
                {socialLinks.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-brand"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap justify-between gap-3 px-5 py-5 text-xs text-ink-muted">
            <p>
              © {new Date().getFullYear()} {org.name}
            </p>

            {/*
              Straight to /staff, with no check for whether anyone is logged
              in. /staff already sends a logged-out visitor to /login, so
              asking the database here would cost a query on every public page
              load and change nothing a visitor sees.
            */}
            <Link href="/staff" className="hover:text-brand">
              Staff sign in
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
