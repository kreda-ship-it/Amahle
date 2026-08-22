import type { Metadata } from "next";
import Link from "next/link";

import { can, requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import { getOrganization } from "@/lib/site/organization";

import { StaffNav, type NavItem } from "./staff-nav";

/**
 * The chrome every staff page shares.
 *
 * The public site has a shopfront wrapped around it; this is the tool. They
 * deliberately look nothing alike — the public layout puts everything inside
 * `theme-dark`, and the staff area simply does not, so it inherits the light
 * palette defined on `:root` in globals.css. Somebody is in here for eight
 * hours entering phone bookings.
 *
 * WHAT THIS FILE IS NOT. It is not the thing that keeps strangers out. A
 * layout in the App Router is not re-run on every navigation between pages
 * that share it, so treating one as a security boundary gives you a guard
 * that works on the first page load and silently stops working afterwards.
 * Every page under /staff calls `requireProfile()` for itself, and that is
 * the check that counts. This file calls it too, because it needs the
 * person's name — not because it is protecting anything.
 */

export async function generateMetadata(): Promise<Metadata> {
  const org = await getOrganization();

  return {
    title: {
      default: org.name,
      // Every staff page gets its own name plus the salon's, so a browser
      // with nine tabs open still says which is which.
      template: `%s · ${org.name}`,
    },
    // The whole area, in one place. A staff page that forgets to say this
    // for itself is now covered anyway.
    robots: { index: false, follow: false },
  };
}

/**
 * The navigation, as data.
 *
 * Each entry names the permission it needs, or null for "anyone who works
 * here". The list is filtered against the database below — never against a
 * role name, which is the rule in CLAUDE.md and the reason `can()` exists.
 *
 * It is short because there is one staff page. Items get added here as their
 * pages land; a link to a page that does not exist yet is worse than no link.
 */
const NAV: { label: string; href: string; permission: string | null }[] = [
  { label: "Today", href: "/staff", permission: null },
  { label: "New booking", href: "/staff/book", permission: "appointment.create" },
];

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const org = await getOrganization();

  /*
   * Asked in parallel rather than one after another. Each `can()` is a round
   * trip to Postgres, and awaiting them in a loop would make the header wait
   * for the first before starting the second. `can()` is wrapped in React's
   * cache(), so a permission the page below also asks about costs nothing
   * twice.
   */
  const allowed = await Promise.all(
    NAV.map((item) => (item.permission ? can(item.permission) : true)),
  );

  const items: NavItem[] = NAV.filter((_, i) => allowed[i]).map(
    ({ label, href }) => ({ label, href }),
  );

  /*
   * A stylist sees their own appointments and nobody else's — a row-level
   * rule, not a screen-level one. Worth saying out loud in the chrome: a
   * stylist looking at a nearly empty salon should be told why, rather than
   * concluding the software has lost the day's bookings.
   */
  const seesEverything = await can("appointment.view_all");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      {/*
        Sticky, because this is a screen somebody scrolls all day and the way
        back to Today should never be a scroll away. Sticky rather than fixed:
        a sticky element still occupies its own space, so nothing below has to
        be pushed down by a matching margin kept in step by hand.
      */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto w-full max-w-6xl px-6">
          <div className="flex h-14 items-center justify-between gap-4">
            <Link
              href="/staff"
              className="min-w-0 truncate font-display text-lg leading-none transition-colors hover:text-brand"
            >
              {org.name}
            </Link>

            {/*
              A form, not a link. Signing out is a change to your session, and
              a change must not happen because something loaded a URL — a
              prefetch or a link-scanner would sign people out.
            */}
            <form action={signOut} className="shrink-0">
              <button
                type="submit"
                className="label text-ink-muted transition-colors hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>

          <div className="flex items-center justify-between gap-6 border-t border-line">
            <StaffNav items={items} />

            <p className="hidden min-w-0 shrink truncate py-3 text-sm text-ink-muted sm:block">
              {profile.full_name}
              <span className="text-ink-muted/70">
                {" · "}
                {profile.role.display_name}
              </span>
              {!seesEverything && (
                <span className="hidden text-ink-muted/70 lg:inline">
                  {" · your own appointments"}
                </span>
              )}
            </p>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
