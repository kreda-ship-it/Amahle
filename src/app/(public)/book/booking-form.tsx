"use client";

import Link from "next/link";
import { useActionState } from "react";

import { submitBooking, type BookingState } from "./actions";

/**
 * Name, phone, and the button that makes it real.
 *
 * One of the few client components in this project, and only because it needs
 * to show what came back from the submit — an error, or the alternatives when
 * somebody else took the slot first. Everything it knows arrives from the
 * server; it holds no booking logic of its own.
 *
 * The chosen slot travels in hidden fields rather than being re-derived here.
 * If it has gone stale, the database says so, and the answer to that is the
 * recovery below rather than a check the browser could get wrong.
 */

const initial: BookingState = { status: "idle" };

export function BookingForm({
  serviceIds,
  employeeId,
  startsAt,
  summary,
}: {
  /** Comma-separated, in the order they will be performed. */
  serviceIds: string;
  employeeId: string;
  startsAt: string;
  summary: string;
}) {
  const [state, action, pending] = useActionState(submitBooking, initial);

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="serviceIds" value={serviceIds} />
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="startsAt" value={startsAt} />

      <p className="text-pretty">{summary}</p>

      <div className="mt-6 space-y-4">
        <Field
          label="Your name"
          name="customerName"
          autoComplete="name"
          required
        />

        <Field
          label="Phone number"
          name="customerPhone"
          type="tel"
          autoComplete="tel"
          required
          hint="So we can reach you if anything changes."
        />

        <Field
          label="Email"
          name="customerEmail"
          type="email"
          autoComplete="email"
          hint="Optional."
        />

        <div>
          <label
            htmlFor="notes"
            className="block text-sm font-medium"
          >
            Anything we should know?
          </label>

          <textarea
            id="notes"
            name="notes"
            rows={3}
            className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 outline-none focus:border-brand"
          />
        </div>
      </div>

      {state.status === "error" && (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-brand/40 bg-brand/5 px-5 py-4"
        >
          <p className="font-medium text-pretty">{state.message}</p>

          {state.alternatives && state.alternatives.length > 0 && (
            <>
              <p className="mt-3 text-sm text-ink-muted">
                These are still free:
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {state.alternatives.map((alternative) => (
                  <Link
                    key={alternative.href}
                    href={alternative.href}
                    className="rounded-full border border-line bg-surface px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
                  >
                    <span className="font-medium">{alternative.time}</span>
                    <span className="ml-2 text-ink-muted">
                      {alternative.employee}
                    </span>
                    {alternative.sameTime && (
                      <span className="ml-2 text-brand">same time</span>
                    )}
                  </Link>
                ))}
              </div>
            </>
          )}

          {state.alternatives && state.alternatives.length === 0 && (
            <p className="mt-2 text-sm text-ink-muted text-pretty">
              Nothing else is free that day. Try another day, or give us a call.
            </p>
          )}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-8 w-full rounded-full bg-brand px-6 py-3.5 font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Booking…" : "Confirm booking"}
      </button>

      <p className="mt-4 text-sm text-ink-muted text-pretty">
        No account needed. We only use your number to contact you about this
        appointment.
      </p>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="block text-sm font-medium">
        {label}
        {!required && <span className="text-ink-muted"> (optional)</span>}
      </label>

      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        className="mt-1.5 w-full rounded-xl border border-line bg-surface px-4 py-2.5 outline-none focus:border-brand"
      />

      {hint && <p className="mt-1 text-sm text-ink-muted">{hint}</p>}
    </div>
  );
}
