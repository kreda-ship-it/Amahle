"use client";

import { useMemo, useState } from "react";

import { ServiceRow, type ServiceRowData } from "./service-row";

/**
 * The menu, with a way to find one thing in it.
 *
 * WHY THIS EXISTS. The tree groups eighty-four services under ten headings,
 * which is the right way to READ a menu and a slow way to reach one row.
 * "Selam sent the real price for the medium knotless" means scrolling past
 * sixty services to reach it, and the headings do not help because you
 * already know what it is called.
 *
 * FILTERED IN THE BROWSER, NOT THE DATABASE. Every service is already on the
 * page — the screen loads the whole menu because it edits the whole menu.
 * Asking Postgres again per keystroke would be slower, would need a debounce,
 * and would put a network round trip between a letter and the list moving.
 * Eighty-four rows is nothing to filter locally. This stops being true at a
 * few thousand, which is not a number a salon menu reaches.
 *
 * THE HEADING COUNTS AS PART OF THE NAME. Typing "braid" finds everything
 * filed under Braids, not only the services with "braid" in their own name.
 * That is what somebody means by the word, and the alternative — matching
 * names alone — makes the search look broken on the very branch it was
 * opened for.
 */

export type Section = {
  key: string;
  heading: string;
  list: ServiceRowData[];
};

type Props = {
  sections: Section[];
  currency: string;
  defaultBuffer: number | null;
};

export function ServiceList({ sections, currency, defaultBuffer }: Props) {
  const [query, setQuery] = useState("");

  const total = useMemo(
    () => sections.reduce((count, section) => count + section.list.length, 0),
    [sections],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();

    if (!needle) return sections;

    return sections
      .map((section) => {
        /* A heading that matches keeps its whole branch — asking for "braids"
           and being shown four of the eleven is a worse answer than none. */
        if (section.heading.toLowerCase().includes(needle)) return section;

        return {
          ...section,
          list: section.list.filter((service) =>
            service.name.toLowerCase().includes(needle),
          ),
        };
      })
      .filter((section) => section.list.length > 0);
  }, [sections, query]);

  const found = shown.reduce((count, section) => count + section.list.length, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            /* Escape clears, which is what the key does in every other search
               box somebody has used. Not autofocused: this screen is reached
               to edit a number, and stealing the caret on arrival would mean
               the first thing typed goes into the wrong box. */
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            placeholder="Find a service — name or heading"
            aria-label="Find a service"
            className="w-full border border-line bg-surface py-2.5 pr-20 pl-3 text-sm"
          />

          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              title="Clear the search"
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-muted transition-colors hover:text-ink"
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>

        {/* A count rather than nothing, because a filtered list that looks
            like the whole list is how somebody concludes a service is
            missing and adds it twice. */}
        <p className="label text-ink-muted" aria-live="polite">
          {query.trim()
            ? `${found} of ${total} services`
            : `${total} services`}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="border border-line px-4 py-8 text-center text-ink-muted">
          Nothing matches “{query.trim()}”.
        </p>
      ) : (
        shown.map((section) => (
          <section key={section.key} className="border border-line">
            <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
              {section.heading}
              <span className="ml-2 text-sm font-normal text-ink-muted">
                {section.list.length}
              </span>
            </h2>

            <ul className="divide-y divide-line">
              {section.list.map((service) => (
                <ServiceRow
                  key={service.id}
                  service={service}
                  currency={currency}
                  defaultBuffer={defaultBuffer}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
