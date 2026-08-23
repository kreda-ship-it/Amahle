"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { saveService, type ServiceEdit } from "./actions";

/**
 * One service, editable in place.
 *
 * A row that expands rather than a page per service. The job is nearly always
 * "Selam sent the real prices" — twenty small corrections in one sitting — and
 * a form per service would be twenty page loads and twenty journeys back.
 *
 * The numbers here are the ones the scheduler actually reads, so the labels
 * say what each does rather than naming the column. `lead_minutes` in
 * particular is the number that turned three bookable starts into nine, and
 * "how long the stylist is needed" is what it means to the person typing it.
 */

export type ServiceRowData = {
  id: string;
  name: string;
  category: string | null;
  price: number;
  duration_minutes: number;
  buffer_minutes: number | null;
  lead_minutes: number | null;
  latest_start_time: string | null;
  is_bookable_online: boolean;
  is_active: boolean;
};

/** "" from an input means "not set", which is a real value here, not zero. */
function toNullableInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const n = Number(trimmed);

  return Number.isFinite(n) ? Math.round(n) : null;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;

  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function ServiceRow({
  service,
  currency,
  defaultBuffer,
}: {
  service: ServiceRowData;
  currency: string;
  defaultBuffer: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [form, setForm] = useState({
    price: String(service.price),
    duration_minutes: String(service.duration_minutes),
    buffer_minutes:
      service.buffer_minutes === null ? "" : String(service.buffer_minutes),
    lead_minutes:
      service.lead_minutes === null ? "" : String(service.lead_minutes),
    latest_start_time: service.latest_start_time?.slice(0, 5) ?? "",
    is_bookable_online: service.is_bookable_online,
    is_active: service.is_active,
  });

  function save() {
    const edit: ServiceEdit = {
      id: service.id,
      price: Number(form.price) || 0,
      duration_minutes: Number(form.duration_minutes) || 0,
      buffer_minutes: toNullableInt(form.buffer_minutes),
      lead_minutes: toNullableInt(form.lead_minutes),
      latest_start_time:
        form.latest_start_time.trim() === ""
          ? null
          : `${form.latest_start_time}:00`,
      is_bookable_online: form.is_bookable_online,
      is_active: form.is_active,
    };

    start(async () => {
      const result = await saveService(edit);

      setMessage(result.ok ? "Saved." : result.message);
      if (result.ok) router.refresh();
    });
  }

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  });

  return (
    <li className={service.is_active ? "" : "opacity-55"}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-surface-sunk"
      >
        <span className="min-w-0 flex-1 font-medium">
          {service.name}
          {!service.is_active && (
            <span className="ml-2 text-xs text-ink-muted">retired</span>
          )}
          {!service.is_bookable_online && service.is_active && (
            <span className="ml-2 text-xs text-ink-muted">phone only</span>
          )}
        </span>

        <span className="tabular-nums">{money.format(service.price)}</span>
        <span className="w-20 text-right tabular-nums text-ink-muted">
          {formatMinutes(service.duration_minutes)}
        </span>
        <span aria-hidden className="text-ink-muted">
          {open ? "−" : "+"}
        </span>
      </button>

      {open && (
        <div className="border-t border-line bg-surface-sunk px-4 py-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Price</span>
              <input
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                inputMode="decimal"
                className="border border-line bg-surface px-3 py-2 tabular-nums"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">How long, in minutes</span>
              <input
                value={form.duration_minutes}
                onChange={(e) =>
                  setForm({ ...form, duration_minutes: e.target.value })
                }
                inputMode="numeric"
                className="border border-line bg-surface px-3 py-2 tabular-nums"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">
                How long the stylist is needed
              </span>
              <input
                value={form.lead_minutes}
                onChange={(e) =>
                  setForm({ ...form, lead_minutes: e.target.value })
                }
                inputMode="numeric"
                placeholder="the whole time"
                className="border border-line bg-surface px-3 py-2 tabular-nums"
              />
              {/* The number that turned three bookable starts into nine. */}
              <span className="text-xs text-ink-muted">
                Leave empty when the stylist stays for all of it. Set it when an
                assistant finishes — that is what frees the rest of their day.
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Cleanup gap after</span>
              <input
                value={form.buffer_minutes}
                onChange={(e) =>
                  setForm({ ...form, buffer_minutes: e.target.value })
                }
                inputMode="numeric"
                placeholder={
                  defaultBuffer === null
                    ? "the salon's default"
                    : `${defaultBuffer} (the salon's default)`
                }
                className="border border-line bg-surface px-3 py-2 tabular-nums"
              />
              <span className="text-xs text-ink-muted">
                Empty uses the salon default. Type 0 to say this one genuinely
                needs no gap.
              </span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="text-ink-muted">Last booking taken at</span>
              <input
                type="time"
                value={form.latest_start_time}
                onChange={(e) =>
                  setForm({ ...form, latest_start_time: e.target.value })
                }
                className="border border-line bg-surface px-3 py-2 tabular-nums"
              />
              <span className="text-xs text-ink-muted">
                A trim at 18:45 is a normal day; braids at 18:45 are not. Empty
                means closing time is the only limit.
              </span>
            </label>

            <div className="flex flex-col gap-2 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_bookable_online}
                  onChange={(e) =>
                    setForm({ ...form, is_bookable_online: e.target.checked })
                  }
                />
                <span>Customers can book this themselves</span>
              </label>

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) =>
                    setForm({ ...form, is_active: e.target.checked })
                  }
                />
                <span>Still offered</span>
              </label>

              {/* DECISIONS #23: the price list shows everything; this flag
                  governs the Book button, not visibility. */}
              <span className="text-xs text-ink-muted">
                Unticking the first keeps it on the price list with a “call us”
                note. Unticking the second takes it off the menu.
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-4">
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="btn bg-brand px-6 py-3 text-ink-inverse hover:bg-brand-strong disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save"}
            </button>

            {message && (
              <span className="text-sm text-ink-muted">{message}</span>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
