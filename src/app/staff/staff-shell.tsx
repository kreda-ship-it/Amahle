"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

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
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-surround text-ink-inverse transition-transform duration-200 lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 items-center justify-between px-5">
          <span className="font-display text-lg tracking-wide">{salonName}</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-ink-inverse/60 lg:hidden"
            aria-label="Close the menu"
          >
            ✕
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
                      className="flex cursor-not-allowed items-center justify-between rounded px-3 py-2 text-sm text-ink-inverse/35"
                    >
                      {item.label}
                      <span className="text-[0.625rem] tracking-wider uppercase">
                        soon
                      </span>
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
                    className={`block rounded px-3 py-2 text-sm transition-colors ${
                      active
                        ? "bg-white/10 text-ink-inverse"
                        : "text-ink-inverse/70 hover:bg-white/5 hover:text-ink-inverse"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-white/10 px-5 py-4 text-sm">
          <p className="font-medium">{fullName}</p>
          <p className="text-ink-inverse/50">{roleName}</p>
          <form action={signOutAction} className="mt-3">
            <button
              type="submit"
              className="text-ink-inverse/70 underline underline-offset-4 transition-colors hover:text-ink-inverse"
            >
              Sign out
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
