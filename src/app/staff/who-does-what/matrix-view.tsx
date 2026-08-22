"use client";

import { useMemo, useState } from "react";

import type { MatrixService } from "@/lib/appointments/matrix";

/**
 * The matrix, narrowed two ways.
 *
 * NOT A GRID, deliberately. The obvious rendering of "who can do what" is a
 * table of services down one side and people across the top — and at this
 * salon that is fifty-odd rows by seventeen columns, which is unreadable on a
 * laptop and impossible on the phone somebody is actually holding while the
 * customer waits.
 *
 * So it is a list that answers whichever question was asked. Type a style and
 * see who can take it; choose a person and see what they can take. Same data,
 * and the narrowing is the feature.
 */

type Props = { services: MatrixService[] };

export function MatrixView({ services }: Props) {
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState("");

  /** Everybody who appears anywhere in the matrix, named once. */
  const people = useMemo(() => {
    const seen = new Map<string, string>();

    for (const service of services) {
      for (const person of [...service.leads, ...service.assists]) {
        if (!seen.has(person.id)) seen.set(person.id, person.full_name);
      }
    }

    return [...seen.entries()]
      .map(([id, full_name]) => ({ id, full_name }))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [services]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return services.filter((service) => {
      if (
        needle &&
        !service.name.toLowerCase().includes(needle) &&
        !(service.category ?? "").toLowerCase().includes(needle)
      ) {
        return false;
      }

      if (personId) {
        const involved = [...service.leads, ...service.assists].some(
          (person) => person.id === personId,
        );
        if (!involved) return false;
      }

      return true;
    });
  }, [services, query, personId]);

  /*
   * A service nobody leads cannot be booked by anybody, through any path —
   * `get_visit_slots()` returns nothing for it and `create_appointment()`
   * refuses it. That is a gap in the matrix rather than a fact about the
   * salon, and it is invisible everywhere else in the application: the
   * booking form simply shows no times, which reads as "fully booked".
   */
  const unbookable = shown.filter((service) => service.leads.length === 0);

  const mark = (id: string) =>
    personId && id === personId ? "font-medium text-brand" : "";

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-ink-muted">Find a style</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="knotless, cornrow, trim…"
            autoComplete="off"
            className="border border-line bg-surface px-3 py-2"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-ink-muted">Or pick a person</span>
          <select
            value={personId}
            onChange={(event) => setPersonId(event.target.value)}
            className="border border-line bg-surface px-3 py-2"
          >
            <option value="">Everyone</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.full_name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {unbookable.length > 0 && (
        <p className="border border-line bg-surface-sunk px-4 py-3 text-sm">
          <span className="font-medium">
            {unbookable.length}{" "}
            {unbookable.length === 1 ? "style has" : "styles have"} nobody to
            lead {unbookable.length === 1 ? "it" : "them"}.
          </span>{" "}
          <span className="text-ink-muted">
            Nothing can be booked against{" "}
            {unbookable.length === 1 ? "it" : "them"} — the booking form shows
            no times, which reads as fully booked. Marked below.
          </span>
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">
          Nothing matches that.
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line">
          {shown.map((service) => (
            <li key={service.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 className="font-medium">{service.name}</h2>

                <div className="flex items-center gap-2">
                  {service.category && (
                    <span className="label text-ink-muted">
                      {service.category}
                    </span>
                  )}
                  {!service.isBookableOnline && (
                    <span
                      className="label border border-line px-1.5 py-0.5 text-ink-muted"
                      title="Shown on the price list with a call-us note, not a Book button"
                    >
                      Phone only
                    </span>
                  )}
                </div>
              </div>

              {service.leads.length === 0 ? (
                <p className="mt-1.5 text-sm text-brand">
                  Nobody leads this — it cannot be booked.
                </p>
              ) : (
                <p className="mt-1.5 text-sm">
                  <span className="text-ink-muted">Leads: </span>
                  {service.leads.map((person, index) => (
                    <span key={person.id} className={mark(person.id)}>
                      {index > 0 && <span className="text-ink-muted">, </span>}
                      {person.full_name}
                    </span>
                  ))}
                </p>
              )}

              {/* Only styles long enough to hand over have finishers, so an
                  absence here is normal rather than a gap. */}
              {service.assists.length > 0 && (
                <p className="mt-0.5 text-sm">
                  <span className="text-ink-muted">Finishes: </span>
                  {service.assists.map((person, index) => (
                    <span key={person.id} className={mark(person.id)}>
                      {index > 0 && <span className="text-ink-muted">, </span>}
                      {person.full_name}
                    </span>
                  ))}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="text-sm text-ink-muted">
        {shown.length} of {services.length} styles
        {personId &&
          ` · ${people.find((person) => person.id === personId)?.full_name}`}
      </p>
    </>
  );
}
