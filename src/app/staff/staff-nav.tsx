"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The staff area's navigation.
 *
 * "use client" for one reason only: `usePathname()` reads the address the
 * browser is currently at, and that is not something the server knows while
 * rendering a layout. Everything else about this bar — which links exist at
 * all — is decided on the server and handed down as props, so no permission
 * check ever runs in the browser.
 *
 * That split matters. A client component's props are visible to anyone who
 * looks, so this one is given the links a person may use and never the
 * reasons. There is no `can()` here, no permission key, and nothing about
 * what the person is not allowed to do.
 */

export type NavItem = { label: string; href: string };

/**
 * Is this the link for the page we are on?
 *
 * `/staff` is the root of the area, so it matches only itself — otherwise it
 * would light up on every page inside the section. Everything else matches
 * its own prefix, so `/staff/customers/abc` still marks "Customers" as
 * current.
 */
function isCurrent(pathname: string, href: string): boolean {
  if (href === "/staff") return pathname === "/staff";

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function StaffNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Staff area">
      {/*
        A scrolling row rather than a hamburger menu, matching the public
        site's header for the same reason: a menu button needs JavaScript, a
        state variable, an outside-click handler and a focus trap before it is
        usable with a keyboard, and all of that to hide a handful of words
        that fit on the screen anyway.
      */}
      <ul className="flex gap-5 overflow-x-auto">
        {items.map((item) => {
          const current = isCurrent(pathname, item.href);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                /*
                  `aria-current="page"` is what tells a screen reader which
                  link is the one you are on. The underline says it to
                  everyone else; without this, the two audiences do not get
                  the same information.
                */
                aria-current={current ? "page" : undefined}
                className={`label whitespace-nowrap border-b-2 py-3 transition-colors ${
                  current
                    ? "border-brand text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
