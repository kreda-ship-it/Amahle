"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveMyDetails } from "./actions";

/**
 * The four fields somebody may change about themselves.
 *
 * The list IS the security model, and it is enforced in Postgres rather than
 * here — `update_my_employee_details()` takes these four parameters and can
 * touch nothing else. What this form leaves out is the interesting part:
 * `position` is a job title and belongs to whoever decides job titles;
 * `is_bookable` and `is_active` decide whether somebody appears on the
 * calendar at all, and a stylist quietly taking herself off the roster on a
 * Saturday morning is not a feature.
 */
export function DetailsForm({
  phone,
  email,
  bio,
}: {
  phone: string | null;
  email: string | null;
  bio: string | null;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    phone: phone ?? "",
    email: email ?? "",
    bio: bio ?? "",
  });

  function save() {
    start(async () => {
      const result = await saveMyDetails(form);

      setMessage(result.ok ? "Saved." : result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-4 p-4 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted">Phone</span>
        <input
          value={form.phone}
          onChange={(event) =>
            setForm({ ...form, phone: event.target.value })
          }
          inputMode="tel"
          className="border border-line bg-surface px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted">Email</span>
        <input
          type="email"
          value={form.email}
          onChange={(event) =>
            setForm({ ...form, email: event.target.value })
          }
          className="border border-line bg-surface px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        <span className="text-ink-muted">
          About you — this one is public, on the team page
        </span>
        <textarea
          value={form.bio}
          onChange={(event) => setForm({ ...form, bio: event.target.value })}
          rows={4}
          className="border border-line bg-surface px-3 py-2"
        />
      </label>

      {/* Said out loud, because the difference is not obvious from a form:
          two of these fields are private to the salon and one is on the
          public website. */}
      <p className="text-xs text-ink-muted sm:col-span-2">
        Your phone and email are never shown on the website — they are for the
        salon. Anonymous visitors were never granted those columns.
      </p>

      <div className="flex items-center gap-4 sm:col-span-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="btn bg-brand px-6 py-3 text-ink-inverse hover:bg-brand-strong disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save"}
        </button>

        {message && <span className="text-sm text-ink-muted">{message}</span>}
      </div>
    </div>
  );
}
