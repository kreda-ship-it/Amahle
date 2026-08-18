"use client";

import Link from "next/link";
import { useActionState } from "react";

import { submitBooking, type BookingState } from "./actions";

/**
 * The last step: who to contact, and the button that makes it real.
 *
 * One of the few client components in this project, and only because it has to
 * show what came back — an error, or the alternatives when somebody took a
 * slot first. It holds no booking logic; everything it knows arrives from the
 * server.
 *
 * Contact details are asked for ONCE, however many people are in the party.
 * The person booking is the person the salon can reach; the others are names
 * on appointments, because a child has no phone number of her own and
 * `customers.phone` is the identity. See migration 024.
 */

const initial: BookingState = { status: "idle" };

export type PersonSummary = {
  /** Comma-separated service ids, in order. */
  serviceIds: string;
  /** "Blow dry and Trim with Hanna, Thursday 20 August at 10:45." */
  summary: string;
};

export function BookingForm({
  people,
  heldUntil,
}: {
  people: PersonSummary[];
  heldUntil: string;
}) {
  const [state, action, pending] = useActionState(submitBooking, initial);
  const party = people.length;

  return (
    <form action={action} className="mt-6">
      <input type="hidden" name="party" value={party} />

      {people.map((person, index) => (
        <input
          key={index}
          type="hidden"
          name={`services${index}`}
          value={person.serviceIds}
        />
      ))}

      <ol className="space-y-2">
        {people.map((person, index) => (
          <li key={index} className="text-pretty">
            {party > 1 && (
              <span className="font-medium">
                {index === 0 ? "You" : `Person ${index + 1}`}:{" "}
              </span>
            )}
            {person.summary}
          </li>
        ))}
      </ol>

      <p className="mt-3 text-sm text-ink-muted">
        Held for you until {heldUntil}.
      </p>

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

        {/* One name box per extra person, so the salon knows who is in each
            chair. Optional — "Person 2" is better than a blocked booking. */}
        {people.slice(1).map((_, index) => (
          <Field
            key={index}
            label={`Name of person ${index + 2}`}
            name={`forName${index + 1}`}
            hint="Optional — so we know who to expect."
          />
        ))}

        <div>
          <label htmlFor="notes" className="block text-sm font-medium">
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
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="mt-8 w-full rounded-full bg-brand px-6 py-3.5 font-medium text-white transition-colors hover:bg-brand-strong disabled:opacity-60 sm:w-auto"
      >
        {pending ? "Booking…" : party > 1 ? "Book all appointments" : "Confirm booking"}
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
