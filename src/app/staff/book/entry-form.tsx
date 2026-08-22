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
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [date, setDate] = useState(today);
  const [employeeId, setEmployeeId] = useState<string>("");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [forName, setForName] = useState("");
  const [notes, setNotes] = useState("");
  const [requested, setRequested] = useState(false);

  /*
   * The squeeze-you-in case. A receptionist knows things the rota does not —
   * that a stylist agreed to stay late, that the customer is already sitting
   * in the shop. create_appointment() lets a STAFF booking past the rota, the
   * lead's availability and even the present moment, so the form has to let
   * her say so. Off by default: the suggestions are right nearly always, and
   * a form that opened on the override would train people to ignore them.
   */
  const [manualOn, setManualOn] = useState(false);
  const [manualTime, setManualTime] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  /*
   * EVERY FETCHED THING IS STORED WITH THE QUESTION IT ANSWERS.
   *
   * The obvious shape — a state variable per answer, cleared in an effect
   * when the question changes — has two faults. It calls setState
   * synchronously inside an effect, which React now warns about because it
   * cascades renders; and between the change and the clear it shows the
   * PREVIOUS service's questions and prices, which is a wrong answer rather
   * than a slow one.
   *
   * Keeping the key beside the value fixes both. If the key no longer
   * matches what is on screen, the value is simply not this question's
   * answer, and the component says so without anybody having to remember to
   * clear it. "Loading" then needs no state at all: it IS the state of
   * having asked something the stored answer does not match.
   */
  const [detail, setDetail] = useState<{
    serviceId: string;
    questions: ServiceQuestion[];
    employees: LeadEmployee[];
  } | null>(null);

  const [totalsFor, setTotalsFor] = useState<{
    key: string;
    price: number;
    minutes: number;
  } | null>(null);

  const [slotsFor, setSlotsFor] = useState<{
    key: string;
    slots: VisitSlot[];
  } | null>(null);

  const [chosenFor, setChosenFor] = useState<{
    key: string;
    slot: VisitSlot;
  } | null>(null);

  const [knownFor, setKnownFor] = useState<{
    digits: string;
    customer: KnownCustomer | null;
  } | null>(null);

  const money = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );

  /* Memoised because `visibleQuestions` below depends on it, and a fresh []
     on every render would rebuild that list — and the selection built from
     it — every time anything on this screen changed. */
  const questions = useMemo(
    () => (detail?.serviceId === serviceId ? detail.questions : []),
    [detail, serviceId],
  );

  const employees = detail?.serviceId === serviceId ? detail.employees : [];

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
  const slotsKey = `${date}|${employeeId}|${selectionKey}`;
  const digits = phone.replace(/\D/g, "");

  const totals =
    totalsFor?.key === selectionKey
      ? { price: totalsFor.price, minutes: totalsFor.minutes }
      : { price: 0, minutes: 0 };

  const slots = slotsFor?.key === slotsKey ? slotsFor.slots : [];
  const loadingSlots = serviceId !== "" && slotsFor?.key !== slotsKey;
  const chosen = chosenFor?.key === slotsKey ? chosenFor.slot : null;

  const known =
    digits.length >= 7 && knownFor?.digits === digits ? knownFor.customer : null;

  /* The salon's own spelling of a name we already hold, used when the box is
     left empty. find_or_create_customer() fills blanks and never overwrites,
     so sending it back is a no-op — this is so the receptionist does not have
     to retype a name the salon already curated. */
  const effectiveName = name.trim() || known?.full_name || "";

  /* ---- what a service asks, and who can lead it ---- */
  useEffect(() => {
    if (!serviceId) return;

    let live = true;

    loadServiceDetail(serviceId).then((result) => {
      if (live) setDetail({ serviceId, ...result });
    });

    return () => {
      live = false;
    };
  }, [serviceId]);

  /* Answers belong to the service that asked. Changing service clears them,
     and this is an event handler rather than an effect for that reason. */
  function chooseService(id: string) {
    setServiceId(id);
    setAnswers({});
    setEmployeeId("");
  }

  /* ---- the running total ---- */
  useEffect(() => {
    if (!serviceId) return;

    let live = true;

    loadTotals(JSON.parse(selectionKey)).then((result) => {
      if (live) setTotalsFor({ key: selectionKey, ...result });
    });

    return () => {
      live = false;
    };
  }, [serviceId, selectionKey]);

  /* ---- suggested times ---- */
  useEffect(() => {
    if (!serviceId) return;

    let live = true;

    loadSlots({
      serviceIds: [serviceId],
      date,
      employeeId: employeeId || null,
      selection: JSON.parse(selectionKey),
    }).then((result) => {
      if (live) setSlotsFor({ key: slotsKey, slots: result });
    });

    return () => {
      live = false;
    };
  }, [serviceId, date, employeeId, selectionKey, slotsKey]);

  /* ---- do we know this number? ---- */
  useEffect(() => {
    if (digits.length < 7) return;

    // Debounced: a lookup per keystroke would be a query per keystroke.
    const timer = setTimeout(() => {
      lookUpCustomer(phone).then((customer) =>
        setKnownFor({ digits, customer }),
      );
    }, 400);

    return () => clearTimeout(timer);
  }, [digits, phone]);

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

    if (manualOn && !manualTime) {
      setError("Type a time, or turn the override off.");
      return;
    }
    if (manualOn && !employeeId) {
      setError("Choose who is doing it — a time you set yourself needs a name.");
      return;
    }
    if (!manualOn && !chosen) {
      setError("Choose a time.");
      return;
    }

    startSaving(async () => {
      const result = await submitBooking({
        serviceIds: [serviceId],
        employeeIds: [manualOn ? employeeId : chosen!.employeeId],
        startsAt: manualOn ? "" : chosen!.startsAt,
        manual: manualOn ? { date, time: manualTime } : null,
        selection: JSON.parse(selectionKey),
        customerName: effectiveName,
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
              onChange={(event) => chooseService(event.target.value)}
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

            {/*
              The override. Everything below it is still shown — the
              suggestions stay on screen so the receptionist can see what she
              is overruling rather than losing it the moment she ticks the box.
            */}
            <label className="flex items-center gap-2 border-t border-line pt-4 text-sm">
              <input
                type="checkbox"
                checked={manualOn}
                onChange={(event) => setManualOn(event.target.checked)}
              />
              <span>Set the time myself</span>
            </label>

            {manualOn && (
              <div className="flex flex-col gap-3 border border-line bg-surface-sunk p-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-ink-muted">Time</span>
                    <input
                      type="time"
                      value={manualTime}
                      onChange={(event) => setManualTime(event.target.value)}
                      className="border border-line bg-surface px-3 py-2 tabular-nums"
                    />
                  </label>

                  <p className="flex-1 text-xs text-ink-muted">
                    {employeeId ? (
                      <>
                        {`${employeeName(employeeId)} on ${date} at ${manualTime || "—"}. `}
                        The rota, the opening hours and the lead time are all
                        skipped. A clash with another appointment is still
                        refused, and so is a braid nobody is free to finish.
                      </>
                    ) : (
                      <span className="text-brand">
                        Choose who is doing it above — a time you set yourself
                        has no stylist attached to it.
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}

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
                      onClick={() => setChosenFor({ key: slotsKey, slot })}
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
                /* A known customer's name shows as a placeholder rather than
                   being typed into the box. Filling it in would overwrite
                   whatever the receptionist was midway through typing, and
                   leaving it empty books them under the name the salon
                   already holds. */
                placeholder={known?.full_name ?? ""}
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
                {manualOn
                  ? manualTime || "—"
                  : chosen
                    ? salonTime(chosen.startsAt, timezone)
                    : "—"}
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
              disabled={saving || (manualOn ? !manualTime || !employeeId : !chosen)}
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
