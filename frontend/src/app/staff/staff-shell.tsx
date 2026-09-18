"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

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

/*
 * Whether this is a desktop, as a second external store.
 *
 * COLLAPSING AND THE DRAWER ARE TWO DIFFERENT THINGS and they were sharing one
 * variable. `wide` is a preference about the desktop rail — the « button,
 * remembered in localStorage. The drawer is what the same aside becomes below
 * `lg`, where it is always 16rem and always slides over the page.
 *
 * The width rule knew that (`lg:w-14` is scoped to the breakpoint). The label
 * rule did not. So collapsing the rail on a laptop and then narrowing the
 * window opened a full-width drawer with every item rendered as a single
 * initial — a column reading D, T, T, P, T, T, W, Y that names nothing.
 *
 * 1024px is Tailwind's `lg`. It has to stay equal to the `lg:` variants on the
 * aside, or the width and the labels disagree at exactly one breakpoint.
 */
const DESKTOP = "(min-width: 1024px)";

function subscribeToDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP);
  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

function readDesktop(): boolean {
  return window.matchMedia(DESKTOP).matches;
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
  const desktop = useSyncExternalStore(subscribeToDesktop, readDesktop, () => true);

  /*
   * Only a desktop rail may shorten a label to its initial. Below `lg` the
   * drawer has the whole 16rem and says the words.
   */
  const collapsed = desktop && !wide;

  /*
   * Being open only means anything where the drawer exists. Derived rather
   * than reset by an effect when the window is widened — the same reason the
   * stores above are stores: an effect that calls setState renders once with
   * the wrong answer first, and here the wrong answer is a dimmer covering a
   * desktop that has no drawer.
   */
  const drawerOpen = open && !desktop;

  /*
   * What a full-screen overlay owes the page underneath it: a way out that is
   * not a tap, and no scrolling behind it. Neither is optional once the thing
   * covers the whole screen. A focus trap is NOT here — that needs more than
   * a listener, and is worth doing properly rather than badly.
   */
  useEffect(() => {
    if (!drawerOpen) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    const wasOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = wasOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

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
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close the menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        /*
         * THE SHELL OWNS EVERYTHING FROM z-40 UP; a screen inside it stops at
         * z-30. The day grid's column headings are `sticky top-0 z-30`, which
         * tied with this and won on document order alone — so the calendar's
         * headings painted a white stripe straight across an open drawer.
         * Ties go to whichever element comes later, and content always comes
         * later than the frame around it.
         */
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-surround text-ink-inverse transition-all duration-200 print:hidden lg:static lg:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } ${wide ? "" : "lg:w-14"}`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
          {!collapsed && (
            <span className="truncate font-display text-lg tracking-wide">
              {salonName}
            </span>
          )}

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex size-9 items-center justify-center text-ink-inverse/60 lg:hidden"
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

        {/* Twelve items and a short screen — a phone in landscape — used to
            push the name and Sign out off the bottom with no way back. The
            list is the only part that scrolls; the head and foot are pinned. */}
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
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
                      title={collapsed ? `${item.label} — soon` : undefined}
                      className={`flex cursor-not-allowed items-center justify-between rounded py-2 text-sm text-ink-inverse/35 ${
                        collapsed ? "justify-center px-0" : "px-3"
                      }`}
                    >
                      {collapsed ? item.label.charAt(0) : item.label}
                      {!collapsed && (
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
                    title={collapsed ? item.label : undefined}
                    className={`block rounded py-2 text-sm transition-colors ${
                      collapsed ? "px-0 text-center" : "px-3"
                    } ${
                      active
                        ? "bg-white/10 text-ink-inverse"
                        : "text-ink-inverse/70 hover:bg-white/5 hover:text-ink-inverse"
                    }`}
                  >
                    {collapsed ? item.label.charAt(0) : item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div
          className={`shrink-0 border-t border-white/10 py-4 text-sm ${collapsed ? "px-2 text-center" : "px-5"}`}
        >
          {!collapsed ? (
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
              {collapsed ? "⏻" : "Sign out"}
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-5 print:hidden lg:hidden">
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
