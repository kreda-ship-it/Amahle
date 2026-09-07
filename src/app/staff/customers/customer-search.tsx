"use client";

import { useEffect, useState, useTransition } from "react";

import type { CustomerMatch } from "@/lib/customers/find";
import { salonDayLabel } from "@/lib/site/datetime";

import { findCustomers } from "./actions";

/**
 * Finding somebody at the front desk.
 *
 * ASKED OF THE SERVER AS YOU TYPE, not filtered in the browser. The services
 * screen does the opposite and both are right: eighty-four services are
 * already on the page because that screen edits all of them, whereas the
 * customer list is unbounded and every row of it is a real person's name,
 * number and email. Shipping the lot to a browser so it can hide most of it
 * would be sending the salon's customer list to anybody who opens dev tools.
 *
 * A QUARTER SECOND OF QUIET BEFORE ASKING. Somebody typing a phone number
 * produces ten keystrokes in about two seconds; without a pause that is ten
 * queries, nine of which are for a number nobody finished. The delay is short
 * enough that it reads as instant and long enough that a normal typing speed
 * only ever asks once.
 *
 * RESULTS ARE TAGGED WITH THE TERM THAT PRODUCED THEM. Replies can arrive out
 * of order — a two-letter search is slower than a five-letter one because it
 * matches more — and rendering whichever landed last shows results for a word
 * that is no longer in the box. Comparing against what is on screen now is the
 * fix, and it needs no request cancelling to get right.
 */

type Props = {
  /** Shown before anybody types. The same shape, a different order. */
  recent: CustomerMatch[];
  timezone: string;
};

export function CustomerSearch({ recent, timezone }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{
    term: string;
    list: CustomerMatch[];
  } | null>(null);
  const [pending, startSearch] = useTransition();

  const term = query.trim();

  useEffect(() => {
    /* Nothing to clear on the way down. `showing` below already ignores a
       reply whose term is not the one in the box, so a short query falls
       through to the recent list without this effect writing state — which
       React now warns about, and rightly: a setState in an effect body
       renders once with the wrong answer before correcting it. */
    if (term.length < 2) return;

    const timer = setTimeout(() => {
      startSearch(async () => {
        const list = await findCustomers(term);
        setResults({ term, list });
      });
    }, 250);

    return () => clearTimeout(timer);
  }, [term]);

  /* Stale until proven current. A reply for "sa" must not be drawn under a box
     that now says "sara". */
  const showing = results?.term === term ? results.list : null;
  const searching = term.length >= 2 && (showing === null || pending);

  const list = term.length >= 2 ? (showing ?? []) : recent;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            autoFocus
            placeholder="Name, or any part of a phone number"
            aria-label="Find a customer"
            className="w-full border border-line bg-surface py-2.5 pr-12 pl-3"
          />

          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear the search"
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-ink-muted transition-colors hover:text-ink"
            >
              <span aria-hidden>✕</span>
            </button>
          )}
        </div>

        <p className="label mt-1.5 text-ink-muted" aria-live="polite">
          {term.length === 0
            ? recent.length > 0
              ? "Most recent"
              : "No customers on record yet"
            : term.length < 2
              ? "Keep going — two letters or three digits"
              : searching
                ? "Looking…"
                : `${list.length} found`}
        </p>
      </div>

      {list.length === 0 && !searching ? (
        <p className="border border-line px-4 py-8 text-center text-ink-muted">
          {term.length >= 2 ? (
            <>
              Nobody matches “{term}”. They may be booked under another number,
              or not on record yet.
            </>
          ) : (
            <>
              Nobody is on record yet. A customer is created the first time a
              booking is taken for them, online or at the desk.
            </>
          )}
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line">
          {list.map((customer) => (
            <li
              key={customer.id}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3"
            >
              <span className="font-medium">{customer.full_name}</span>

              {/* Tappable, because the reason to look somebody up at a front
                  desk is very often to ring them. */}
              <a
                href={`tel:${customer.phone}`}
                className="tabular-nums text-ink-muted underline underline-offset-4 transition-colors hover:text-ink"
              >
                {customer.phone}
              </a>

              {customer.email && (
                <span className="text-sm text-ink-muted">{customer.email}</span>
              )}

              <span className="ml-auto text-sm text-ink-muted">
                {customer.last_visit_at
                  ? `Last in ${salonDayLabel(
                      new Intl.DateTimeFormat("en-CA", {
                        timeZone: timezone,
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                      }).format(new Date(customer.last_visit_at)),
                    )}`
                  : "No visits yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
