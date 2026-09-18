"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";

import type { MatrixService } from "@/lib/appointments/matrix";

import { clearWhoDoes, setWhoDoes, type MatrixRole } from "./actions";

/**
 * The matrix, narrowed two ways and now editable.
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
 *
 * The editor keeps that shape rather than fighting it: open one style and the
 * whole roster appears beneath it with two boxes each. Seventeen rows of two
 * is a form; fifty by seventeen is a spreadsheet nobody can read.
 */

/** Somebody who may be offered as a choice — active, and bookable. */
export type RosterPerson = { id: string; full_name: string };

type Props = {
  services: MatrixService[];
  roster: RosterPerson[];
  canEdit: boolean;
};

export function MatrixView({ services, roster, canEdit }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [personId, setPersonId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

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

  /*
   * No optimistic tick, deliberately, and it is the opposite call from the
   * calendar's drag — where a block that waited for the server before moving
   * would feel broken.
   *
   * This is not that. A box here decides what the booking engine will and
   * will not offer, it is pressed a handful of times when somebody new
   * arrives, and the honest thing is to show what the database actually
   * holds. Half a second of a disabled checkbox costs nothing; a tick that
   * appears and then silently un-ticks on the next refresh costs trust in
   * the one screen that says who can be booked.
   */
  function toggle(
    serviceId: string,
    employeeId: string,
    role: MatrixRole,
    on: boolean,
  ) {
    setMessage(null);

    start(async () => {
      const result = on
        ? await setWhoDoes(serviceId, employeeId, role)
        : await clearWhoDoes(serviceId, employeeId, role);

      if (result.ok) router.refresh();
      else setMessage(result.message);
    });
  }

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
            no times, which reads as fully booked. Marked below
            {canEdit && ", and openable"}.
          </span>
        </p>
      )}

      {message && (
        <p className="border border-line bg-surface-sunk px-4 py-3 text-sm text-brand">
          {message}
        </p>
      )}

      {shown.length === 0 ? (
        <p className="py-12 text-center text-ink-muted">
          Nothing matches that.
        </p>
      ) : (
        <ul className="divide-y divide-line border border-line">
          {shown.map((service) => {
            const open = openId === service.id;

            /* Membership as sets, so a row of seventeen people does not walk
               two arrays seventeen times over. */
            const leads = new Set(service.leads.map((person) => person.id));
            const assists = new Set(service.assists.map((person) => person.id));

            return (
              <li key={service.id}>
                <div
                  className={
                    canEdit
                      ? "cursor-pointer px-4 py-3 transition-colors hover:bg-surface-sunk"
                      : "px-4 py-3"
                  }
                  {...(canEdit
                    ? {
                        role: "button",
                        tabIndex: 0,
                        "aria-expanded": open,
                        onClick: () => setOpenId(open ? null : service.id),
                        onKeyDown: (event: React.KeyboardEvent) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setOpenId(open ? null : service.id);
                        },
                      }
                    : {})}
                >
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
                      {canEdit && (
                        <span aria-hidden className="text-ink-muted">
                          {open ? "−" : "+"}
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
                          {index > 0 && (
                            <span className="text-ink-muted">, </span>
                          )}
                          {person.full_name}
                        </span>
                      ))}
                    </p>
                  )}

                  {/* Only styles long enough to hand over have finishers, so
                      an absence here is normal rather than a gap. */}
                  {service.assists.length > 0 && (
                    <p className="mt-0.5 text-sm">
                      <span className="text-ink-muted">Finishes: </span>
                      {service.assists.map((person, index) => (
                        <span key={person.id} className={mark(person.id)}>
                          {index > 0 && (
                            <span className="text-ink-muted">, </span>
                          )}
                          {person.full_name}
                        </span>
                      ))}
                    </p>
                  )}
                </div>

                {canEdit && open && (
                  <div className="border-t border-line bg-surface-sunk px-4 py-4">
                    {roster.length === 0 ? (
                      <p className="text-sm text-ink-muted">
                        Nobody on the roster is marked bookable, so there is
                        nobody to choose.
                      </p>
                    ) : (
                      <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-x-2">
                        <span className="label pb-2 text-ink-muted">
                          Person
                        </span>
                        <span className="label pb-2 text-center text-ink-muted">
                          Leads
                        </span>
                        <span className="label pb-2 text-center text-ink-muted">
                          Finishes
                        </span>

                        {roster.map((person) => (
                          <Fragment key={person.id}>
                            <span className="border-t border-line py-2 text-sm">
                              {person.full_name}
                            </span>

                            {(["lead", "assist"] as const).map((role) => {
                              const on =
                                role === "lead"
                                  ? leads.has(person.id)
                                  : assists.has(person.id);

                              return (
                                <label
                                  key={role}
                                  className="flex items-center justify-center border-t border-line py-2"
                                >
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    disabled={busy}
                                    onChange={(event) =>
                                      toggle(
                                        service.id,
                                        person.id,
                                        role,
                                        event.target.checked,
                                      )
                                    }
                                    className="h-4 w-4 disabled:opacity-40"
                                  />
                                  <span className="sr-only">
                                    {person.full_name}{" "}
                                    {role === "lead" ? "leads" : "finishes"}{" "}
                                    {service.name}
                                  </span>
                                </label>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                    )}

                    {/* The consequence that surprises people, said where the
                        box is rather than in a document nobody opens. */}
                    <p className="mt-4 max-w-prose text-xs text-ink-muted">
                      Somebody who leads at least one style gets their own
                      column on the calendar. Everybody who only ever finishes
                      shares the last one.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
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
