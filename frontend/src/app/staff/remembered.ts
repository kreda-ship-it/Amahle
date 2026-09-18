"use client";

import { useSyncExternalStore } from "react";

/**
 * A yes/no the browser remembers, shared by everything that asks for it.
 *
 * WHY THIS EXISTS RATHER THAN useState. A panel you fold away should still be
 * folded when you come back. `useState` forgets on every navigation, so the
 * calendar sprang open again every time you moved to another day — which is
 * the one action guaranteed to follow folding it away.
 *
 * WHY AN EXTERNAL STORE RATHER THAN AN EFFECT. localStorage is not reactive:
 * two panels reading the same key would not hear each other, and the obvious
 * fix — read it in an effect and call setState — renders once with the wrong
 * answer before correcting itself. On a fold-away panel that is a visible
 * flinch on every page load. `useSyncExternalStore` takes a server snapshot
 * separately, so the first paint is already right.
 *
 * The same shape `StaffShell` uses for the sidebar's width. That one predates
 * this and is left alone deliberately: it is load-bearing on every staff page,
 * and rewriting it to save a few lines is not worth the risk today.
 */

/* One event for every key. A panel re-reading its own value because a
   different panel changed is a wasted render, not a wrong one, and there are
   two of these on screen at most. */
const EVENT = "staff-remembered-change";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  /* Another tab. Rare, and free to support. */
  window.addEventListener("storage", onChange);

  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Returns the remembered value and a setter, like `useState`.
 *
 * `fallback` is what an unvisited browser gets, and it is also the server
 * snapshot — so the markup the server sends matches the first client render
 * and hydration has nothing to correct.
 */
export function useRemembered(
  key: string,
  fallback: boolean,
): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => {
      const stored = window.localStorage.getItem(key);

      return stored === null ? fallback : stored === "true";
    },
    () => fallback,
  );

  function set(next: boolean) {
    window.localStorage.setItem(key, String(next));
    window.dispatchEvent(new Event(EVENT));
  }

  return [value, set];
}
