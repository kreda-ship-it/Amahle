"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { LeadEmployee, ServiceQuestion, StaffService } from "@/lib/appointments/menu";
import type { VisitSlot } from "@/lib/appointments/visits";
import type { KnownCustomer } from "@/lib/customers/find";
import { salonTime } from "@/lib/site/datetime";

import {
  loadServiceDetail,
  loadSlots,
  loadTotals,
  lookUpCustomer,
  submitBooking,
} from "./actions";

/**
 * The dense one-screen entry form.
 *
 * ONE SCREEN, NOT A WIZARD, and that is the whole design. The public booking
 * form asks one question per page because it is leading a stranger on a phone.
 * This is used by somebody with a customer on the line who needs to answer
 * "when can you do it?" without navigating anywhere — so everything is
 * visible, state lives in this component rather than in the URL, and nothing
 * is submitted until the end.
 *
 * WHAT IS COMPUTED HERE: nothing. Prices, durations and free times all come
 * back from server actions that ask Postgres. A running total added up in a
 * browser is one that can disagree with the appointment it produces, and one
 * that anybody with dev tools can edit.
 */

type Props = {
  services: StaffService[];
  today: string;
  currency: string;
  timezone: string;
};

/** "6h 15m", "45m". Minutes are what the database deals in. */
function formatMinutes(minutes: number): string {
  if (minutes <= 0) return "—";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;

  return `${hours}h ${rest}m`;
}

export function EntryForm({ services, today, currency, timezone }: Props) {
  const router = useRouter();

  const [serviceId, setServiceId] = useState<string>("");
  const [questions, setQuestions] = useState<ServiceQuestion[]>([]);
  const [employees, setEmployees] = useState<LeadEmployee[]>([]);
  /** Chosen answers, keyed by question. Several ids only for a `many` question. */
  const [answers, setAnswers] = useState<Record<string, string[]>>({});

  const [totals, setTotals] = useState({ price: 0, minutes: 0 });

  const [date, setDate] = useState(today);
  const [employeeId, setEmployeeId] = useState<string>("");
  const [slots, setSlots] = useState<VisitSlot[]>([]);
  const [chosen, setChosen] = useState<VisitSlot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [forName, setForName] = useState("");
  const [notes, setNotes] = useState("");
  const [requested, setRequested] = useState(false);
  const [known, setKnown] = useState<KnownCustomer | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  /*
   * Only questions whose condition is met. `depends_on_option_id` is the
   * conditional edge of the tree — "which colour?" appears only once "the
   * salon provides the hair" has been chosen. One level deep, by design.
   */
  const chosenIds = useMemo(() => Object.values(answers).flat(), [answers]);

  const visibleQuestions = useMemo(
    () =>
      questions.filter(
        (question) =>
          question.depends_on_option_id === null ||
          chosenIds.includes(question.depends_on_option_id),
      ),
    [questions, chosenIds],
  );

  /*
   * The selection, in the shape every database function takes. Only answers to
   * questions still on screen count — answering "which colour", then changing
   * your mind about whose hair it is, must not leave the colour in the price.
   */
  const selection = useMemo(() => {
    if (!serviceId) return [];

    const live = visibleQuestions.flatMap(
      (question) => answers[question.id] ?? [],
    );

    return [{ serviceId, optionIds: live }];
  }, [serviceId, visibleQuestions, answers]);

  /* A stable string, so effects fire when the ANSWERS change rather than
     whenever React rebuilds the array around them. */
  const selectionKey = JSON.stringify(selection);

  /* ---- what a service asks, and who can lead it ---- */
  useEffect(() => {
    if (!serviceId) {
      setQuestions([]);
      setEmployees([]);
      return;
    }

    let live = true;

    loadServiceDetail(serviceId).then((detail) => {
      if (!live) return;
      setQuestions(detail.questions);
      setEmployees(detail.employees);
      setAnswers({});
      setEmployeeId("");
    });

    return () => {
      live = false;
    };
  }, [serviceId]);

  /* ---- the running total ---- */
  useEffect(() => {
    if (!serviceId) {
      setTotals({ price: 0, minutes: 0 });
      return;
    }

    let live = true;

    loadTotals(JSON.parse(selectionKey)).then((result) => {
      if (live) setTotals(result);
    });

    return () => {
      live = false;
    };
  }, [serviceId, selectionKey]);

  /* ---- suggested times ---- */
  useEffect(() => {
    if (!serviceId) {
      setSlots([]);
      return;
    }

    let live = true;
    setLoadingSlots(true);
    setChosen(null);

    loadSlots({
      serviceIds: [serviceId],
      date,
      employeeId: employeeId || null,
      selection: JSON.parse(selectionKey),
    })
      .then((result) => {
        if (live) setSlots(result);
      })
      .finally(() => {
        if (live) setLoadingSlots(false);
      });

    return () => {
      live = false;
    };
  }, [serviceId, date, employeeId, selectionKey]);

  /* ---- do we know this number? ---- */
  useEffect(() => {
    if (phone.replace(/\D/g, "").length < 7) {
      setKnown(null);
      return;
    }

    // Debounced: a lookup per keystroke would be a query per keystroke.
    const timer = setTimeout(() => {
      lookUpCustomer(phone).then(setKnown);
    }, 400);

    return () => clearTimeout(timer);
  }, [phone]);

  /* Offer the salon's spelling of a name we already hold, rather than
     overwriting what is being typed. The database would keep its own version
     anyway; this stops the receptionist thinking she created someone new. */
  useEffect(() => {
    if (known && !name.trim()) setName(known.full_name);
  }, [known, name]);

  function toggleAnswer(question: ServiceQuestion, optionId: string) {
    setAnswers((current) => {
      const existing = current[question.id] ?? [];

      if (question.selection === "many") {
        return {
          ...current,
          [question.id]: existing.includes(optionId)
            ? existing.filter((id) => id !== optionId)
            : [...existing, optionId],
        };
      }

      // A single-answer question toggles off when its own answer is tapped
      // again, so a non-required question can be un-answered.
      return {
        ...current,
        [question.id]: existing.includes(optionId) ? [] : [optionId],
      };
    });
  }

  function book() {
    setError(null);

    if (!chosen) {
      setError("Choose a time.");
      return;
    }

    startSaving(async () => {
      const result = await submitBooking({
        serviceIds: [serviceId],
        employeeIds: [chosen.employeeId],
        startsAt: chosen.startsAt,
        selection: JSON.parse(selectionKey),
        customerName: name,
        customerPhone: phone,
        customerEmail: email || null,
        forName: forName || null,
        notes: notes || null,
        employeeRequested: requested,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      // Straight to the day it landed on, so the booking is seen rather than
      // taken on trust.
      router.push(`/staff?date=${result.date}`);
    });
  }

  const employeeName = (id: string) =>
    employees.find((employee) => employee.id === id)?.full_name ?? "—";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="flex flex-col gap-6">
        {/* ---------- the service ---------- */}
        <section className="border border-line">
          <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
            Service
          </h2>

          <div className="p-4">
            <select
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              className="w-full border border-line bg-surface px-3 py-2"
            >
              <option value="">Choose a service…</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {service.category ? ` — ${service.category}` : ""}
                </option>
              ))}
            </select>

            {/* Every question the chosen style asks, in the salon's order. */}
            {visibleQuestions.map((question) => (
              <fieldset key={question.id} className="mt-5">
                <legend className="label text-ink-muted">
                  {question.prompt}
                  {!question.is_required && (
                    <span className="normal-case"> (optional)</span>
                  )}
                </legend>

                <div className="mt-2 flex flex-wrap gap-2">
                  {question.options.map((option) => {
                    const picked = (answers[question.id] ?? []).includes(
                      option.id,
                    );

                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => toggleAnswer(question, option.id)}
                        className={`border px-3 py-2 text-sm transition-colors ${
                          picked
                            ? "border-brand bg-brand text-ink-inverse"
                            : "border-line hover:border-ink"
                        }`}
                      >
                        {option.name}
                        {option.duration_delta_minutes !== 0 && (
                          <span className="ml-2 text-xs opacity-70">
                            {option.duration_delta_minutes > 0 ? "+" : ""}
                            {formatMinutes(
                              Math.abs(option.duration_delta_minutes),
                            )}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        {/* ---------- when ---------- */}
        <section className="border border-line">
          <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
            When
          </h2>

          <div className="flex flex-col gap-4 p-4">
            <div className="flex flex-wrap gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-ink-muted">Day</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="border border-line bg-surface px-3 py-2"
                />
              </label>

              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="text-ink-muted">With</span>
                <select
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  className="border border-line bg-surface px-3 py-2"
                >
                  <option value="">Anyone who does it</option>
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.full_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!serviceId ? (
              <p className="text-sm text-ink-muted">
                Choose a service to see times.
              </p>
            ) : loadingSlots ? (
              <p className="text-sm text-ink-muted">Looking…</p>
            ) : slots.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No times that day. Try another day, or another stylist.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {slots.map((slot) => {
                  const picked = chosen?.startsAt === slot.startsAt &&
                    chosen?.employeeId === slot.employeeId;

                  return (
                    <button
                      key={`${slot.startsAt}-${slot.employeeId}`}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => setChosen(slot)}
                      className={`border px-3 py-2 text-sm tabular-nums transition-colors ${
                        picked
                          ? "border-brand bg-brand text-ink-inverse"
                          : "border-line hover:border-ink"
                      }`}
                    >
                      {salonTime(slot.startsAt, timezone)}
                      <span className="ml-2 text-xs opacity-70">
                        {employeeName(slot.employeeId)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ---------- who ---------- */}
        <section className="border border-line">
          <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
            Customer
          </h2>

          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Phone</span>
              <input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                inputMode="tel"
                autoComplete="off"
                className="border border-line bg-surface px-3 py-2"
              />
              {/* The salon's own spelling, so a known customer is recognised
                  rather than quietly duplicated under a new one. */}
              {known && (
                <span className="text-xs text-brand">
                  {known.full_name}
                  {known.visits !== null &&
                    ` — ${known.visits} ${known.visits === 1 ? "visit" : "visits"}`}
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
                className="border border-line bg-surface px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Email (optional)</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="off"
                className="border border-line bg-surface px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">
                If it is for somebody else (optional)
              </span>
              <input
                value={forName}
                onChange={(event) => setForName(event.target.value)}
                placeholder="e.g. her daughter Amira"
                autoComplete="off"
                className="border border-line bg-surface px-3 py-2"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm sm:col-span-2">
              <span className="text-ink-muted">Notes (optional)</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={2}
                className="border border-line bg-surface px-3 py-2"
              />
            </label>

            {/*
              The star on the day view. Off by default and deliberately: it
              means the customer asked for this person BY NAME, and defaulting
              it on would mark every booking as a request and make the mark
              worthless. See DECISIONS #32.
            */}
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={requested}
                onChange={(event) => setRequested(event.target.checked)}
              />
              <span>They asked for this stylist by name</span>
            </label>
          </div>
        </section>
      </div>

      {/* ---------- the summary, and the button ---------- */}
      <aside className="lg:sticky lg:top-32 lg:self-start">
        <div className="border border-line">
          <h2 className="border-b border-line bg-surface-sunk px-4 py-2.5 font-medium">
            Summary
          </h2>

          <dl className="divide-y divide-line text-sm">
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ink-muted">Price</dt>
              <dd className="tabular-nums">
                {totals.price > 0 ? money.format(totals.price) : "—"}
              </dd>
            </div>

            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ink-muted">Takes</dt>
              <dd className="tabular-nums">{formatMinutes(totals.minutes)}</dd>
            </div>

            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-ink-muted">Starts</dt>
              <dd className="tabular-nums">
                {chosen ? salonTime(chosen.startsAt, timezone) : "—"}
              </dd>
            </div>
          </dl>

          {/*
            Who would actually do it. A braid is founded by a stylist and
            finished by an assistant, so a visit is legitimately several rows
            across several people — and the receptionist is asked "who will I
            be with?" while the customer is still on the line.

            Nobody picks the finishers. They are chosen inside
            create_appointment() at write time, because minutes pass between
            seeing a time and pressing the button, so this is what WOULD
            happen rather than a promise.
          */}
          {chosen && chosen.assignment.length > 1 && (
            <div className="border-t border-line px-4 py-3 text-sm">
              <p className="label text-ink-muted">Who</p>
              <ul className="mt-2 space-y-1">
                {chosen.assignment.map((row, index) => (
                  <li key={index} className="flex justify-between gap-3">
                    <span>{employeeName(row.employee_id)}</span>
                    <span className="text-ink-muted">
                      {row.phase === "lead" ? "founding" : "finishing"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && (
            <p role="alert" className="border-t border-line px-4 py-3 text-sm text-brand">
              {error}
            </p>
          )}

          <div className="border-t border-line p-4">
            <button
              type="button"
              onClick={book}
              disabled={saving || !chosen}
              className="btn w-full bg-brand text-ink-inverse hover:bg-brand-strong disabled:opacity-40"
            >
              {saving ? "Booking…" : "Book it"}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
