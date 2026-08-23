"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import type { NavItem } from "./nav";

/**
 * The frame every staff screen sits in.
 *
 * A client component for one reason: the sidebar opens and closes, and that is
 * state. Everything it displays — who is signed in, which items they may see —
 * was decided on the server and handed down, so no permission is ever
 * evaluated in the browser.
 *
 * On a large screen the sidebar is simply there. On a small one it slides over
 * the content, because a salon tablet held in one hand has no width to spare
 * and the person holding it is usually mid-conversation.
 */
/*
 * The sidebar's width, as an external store.
 *
 * localStorage is not reactive, so a change in one place would not reach a
 * component in another. One custom event does that job, and keeps every part
 * of the shell reading the same value.
 */
const WIDTH_EVENT = "staff-sidebar-change";

function subscribeToWidth(onChange: () => void): () => void {
  window.addEventListener(WIDTH_EVENT, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(WIDTH_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readWidth(): boolean {
  return window.localStorage.getItem("staff-sidebar") !== "narrow";
}

export function StaffShell({
  navigation,
  fullName,
  roleName,
  salonName,
  signOutAction,
  children,
}: {
  navigation: NavItem[];
  fullName: string;
  roleName: string;
  salonName: string;
  signOutAction: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  /*
   * Collapsed on a desktop, which is a different thing from the small-screen
   * drawer above. The calendar is the widest screen in the app and the one
   * people live in; sixteen rems of navigation is most of a stylist's column
   * when the day is busy. Remembered in the browser, because a sidebar that
   * reopens on every navigation is worse than one that never closes.
   *
   * `useSyncExternalStore` rather than an effect that reads localStorage and
   * calls setState. That shape cascades a render on every mount and React now
   * warns about it — and it has a real fault behind the warning: the server
   * renders wide, the effect then renders narrow, and the sidebar visibly
   * snaps shut after the page has appeared. This asks for a server snapshot
   * separately, so hydration matches and the collapse is already applied on
   * the first paint.
   */
  const wide = useSyncExternalStore(subscribeToWidth, readWidth, () => true);

  function toggleWide() {
    window.localStorage.setItem("staff-sidebar", wide ? "narrow" : "wide");
    window.dispatchEvent(new Event(WIDTH_EVENT));
  }

  const pathname = usePathname();

  return (
    <div className="flex min-h-full flex-1">
      {/*
        The dimmer behind an open sidebar. It is also the way out of it: on a
        phone, tapping the page you can see is the thing people try first.
      */}
      {open && (
        <button
          type="button"
          aria-label="Close the menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-surround text-ink-inverse transition-all duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${wide ? "" : "lg:w-14"}`}
      >
        <div className="flex h-16 items-center justify-between gap-2 px-4">
          {wide && (
            <span className="truncate font-display text-lg tracking-wide">
              {salonName}
            </span>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-inverse/60 lg:hidden"
            aria-label="Close the menu"
          >
            ✕
          </button>

          {/* Desktop only: the small screen already has the drawer. */}
          <button
            type="button"
            onClick={toggleWide}
            aria-label={wide ? "Collapse the menu" : "Expand the menu"}
            title={wide ? "Collapse the menu" : "Expand the menu"}
            className="hidden size-8 shrink-0 items-center justify-center text-ink-inverse/60 transition-colors hover:text-ink-inverse lg:flex"
          >
            <span aria-hidden>{wide ? "«" : "»"}</span>
          </button>
        </div>

        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-0.5">
            {navigation.map((item) => {
              const active =
                item.href === "/staff"
                  ? pathname === "/staff"
                  : pathname.startsWith(item.href);

              if (!item.built) {
                return (
                  <li key={item.href}>
                    <span
                      aria-disabled
                      title={wide ? undefined : `${item.label} — soon`}
                      className={`flex cursor-not-allowed items-center justify-between rounded py-2 text-sm text-ink-inverse/35 ${
                        wide ? "px-3" : "justify-center px-0"
                      }`}
                    >
                      {wide ? item.label : item.label.charAt(0)}
                      {wide && (
                        <span className="text-[0.625rem] tracking-wider uppercase">
                          soon
                        </span>
                      )}
                    </span>
                  </li>
                );
              }

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    /* Collapsed, the label becomes an initial and moves into
                       the tooltip — never removed, because an icon rail with
                       no names is a memory test. */
                    title={wide ? undefined : item.label}
                    className={`block rounded py-2 text-sm transition-colors ${
                      wide ? "px-3" : "px-0 text-center"
                    } ${
                      active
                        ? "bg-white/10 text-ink-inverse"
                        : "text-ink-inverse/70 hover:bg-white/5 hover:text-ink-inverse"
                    }`}
                  >
                    {wide ? item.label : item.label.charAt(0)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div
          className={`border-t border-white/10 py-4 text-sm ${wide ? "px-5" : "px-2 text-center"}`}
        >
          {wide ? (
            <>
              <p className="font-medium">{fullName}</p>
              <p className="text-ink-inverse/50">{roleName}</p>
            </>
          ) : (
            <p className="font-medium" title={`${fullName} · ${roleName}`}>
              {fullName.charAt(0)}
            </p>
          )}

          <form action={signOutAction} className="mt-3">
            <button
              type="submit"
              title="Sign out"
              className="text-ink-inverse/70 underline underline-offset-4 transition-colors hover:text-ink-inverse"
            >
              {wide ? "Sign out" : "⏻"}
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5 lg:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open the menu"
            className="flex size-9 items-center justify-center border border-line"
          >
            <span aria-hidden>☰</span>
          </button>
          <span className="font-display text-lg">{salonName}</span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
