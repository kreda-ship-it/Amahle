import type { Metadata } from "next";
import Link from "next/link";

import {
  getAvailableSlots,
  getBookableService,
  getBookableServices,
  getEmployeesForService,
} from "@/lib/appointments/availability";
import {
  salonDateKey,
  salonDayLabel,
  salonDayLabelLong,
  salonDaysFrom,
  salonTime,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { formatDuration, formatPrice } from "@/lib/site/pricing";

/**
 * The booking page — choosing what, with whom, and when.
 *
 * Every choice lives in the URL rather than in the browser's memory. That is
 * the one design decision here worth defending, and it has three reasons:
 *
 *   1. The back button works. Someone half-way through booking is exactly the
 *      person who hits back, and a page holding its state in React would lose
 *      everything.
 *   2. Times are fetched fresh on every step. A slot list sitting in a browser
 *      goes stale while someone deliberates, and the longer they take the more
 *      likely they choose something already gone.
 *   3. Nothing is calculated here. The server asks the database and renders
 *      the answer, which is what the whole architecture requires — `anon` has
 *      no privilege on the rota or the appointments it is derived from.
 */

export const metadata: Metadata = {
  title: "Book an appointment",
  description:
    "Choose a service, pick a time that suits you, and book online in under a minute.",
};

/*
 * Never cached, and this is not caution. A cached availability page shows one
 * customer the times another customer took ten minutes ago, and the first they
 * would learn of it is a booking that fails.
 */
export const dynamic = "force-dynamic";

/** How far ahead the day chooser looks. */
const DAYS_SHOWN = 14;

type SearchParams = {
  service?: string;
  employee?: string;
  date?: string;
  at?: string;
};

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const org = await getOrganization();
  const params = await searchParams;

  if (!params.service) {
    return <ChooseService orgId={org.id} currency={org.currency} />;
  }

  const service = await getBookableService(org.id, params.service);

  if (!service) {
    return (
      <Shell>
        <h1 className="font-display text-3xl font-semibold">
          That service isn&rsquo;t available to book online
        </h1>

        <p className="mt-4 text-ink-muted text-pretty">
          It may have changed since you last looked. Choose another below, or
          call us and we will sort it out.
        </p>

        <Link
          href="/book"
          className="mt-8 inline-block rounded-full bg-brand px-6 py-3 font-medium text-white transition-colors hover:bg-brand-strong"
        >
          See what can be booked
        </Link>
      </Shell>
    );
  }

  const employees = await getEmployeesForService(org.id, service.id);
  const days = salonDaysFrom(org.timezone, DAYS_SHOWN);

  // One call for the whole fortnight. The day chooser has to know which days
  // have anything before you pick one, and fourteen separate questions would
  // give fourteen slightly different moments of truth.
  const slots = await getAvailableSlots({
    orgId: org.id,
    serviceId: service.id,
    fromDate: days[0],
    toDate: days[days.length - 1],
    employeeId: params.employee ?? null,
  });

  const byDay = new Map<string, typeof slots>();

  for (const slot of slots) {
    const key = salonDateKey(slot.startsAt, org.timezone);
    const existing = byDay.get(key);

    if (existing) existing.push(slot);
    else byDay.set(key, [slot]);
  }

  // The requested day if it has anything, otherwise the first that does. A
  // customer who lands on a fully-booked Tuesday should see the next real
  // option rather than an empty page.
  const selectedDay =
    params.date && byDay.has(params.date)
      ? params.date
      : (days.find((day) => byDay.has(day)) ?? null);

  const times = selectedDay ? (byDay.get(selectedDay) ?? []) : [];
  const nameFor = (id: string) =>
    employees.find((employee) => employee.id === id)?.full_name ?? "our team";

  const chosen = params.at
    ? (slots.find((slot) => slot.startsAt === params.at) ?? null)
    : null;

  const href = (next: Partial<SearchParams>) => {
    const query = new URLSearchParams();
    const merged = { ...params, ...next };

    for (const key of ["service", "employee", "date", "at"] as const) {
      const value = merged[key];
      if (value) query.set(key, value);
    }

    return `/book?${query.toString()}`;
  };

  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Book an appointment
      </h1>

      {/* What they picked, and how to change it. */}
      <section className="mt-8 rounded-2xl bg-surface-sunk px-6 py-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 className="font-medium">{service.name}</h2>

          <Link href="/book" className="text-sm text-brand hover:underline">
            Change service
          </Link>
        </div>

        <p className="mt-1 text-sm text-ink-muted">
          {[
            formatPrice(service.price, service.price_display, org.currency),
            formatDuration(service.duration_minutes),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </section>

      {/* Who. "Anyone" is first because it is the answer most people want. */}
      {employees.length > 1 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">
            Who would you like?
          </h2>

          <div className="mt-4 flex flex-wrap gap-2">
            <Chip
              href={href({ employee: undefined, at: undefined })}
              active={!params.employee}
            >
              Anyone
            </Chip>

            {employees.map((employee) => (
              <Chip
                key={employee.id}
                href={href({ employee: employee.id, at: undefined })}
                active={params.employee === employee.id}
              >
                {employee.full_name}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {/* When. */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">Pick a day</h2>

        <div className="mt-4 flex flex-wrap gap-2">
          {days.map((day) => {
            const available = byDay.has(day);

            return available ? (
              <Chip
                key={day}
                href={href({ date: day, at: undefined })}
                active={day === selectedDay}
              >
                {salonDayLabel(day)}
              </Chip>
            ) : (
              <span
                key={day}
                className="rounded-full border border-line px-4 py-2 text-sm text-ink-muted opacity-50"
                title="Fully booked"
              >
                {salonDayLabel(day)}
              </span>
            );
          })}
        </div>
      </section>

      {/* Times. */}
      <section className="mt-10">
        <h2 className="font-display text-xl font-semibold">
          {selectedDay ? salonDayLabelLong(selectedDay) : "Available times"}
        </h2>

        {times.length === 0 ? (
          <p className="mt-4 text-ink-muted text-pretty">
            Nothing free in the next two weeks for this service. Call us and we
            will find you something.
          </p>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {times.map((slot) => (
              <Chip
                key={`${slot.startsAt}-${slot.employeeId}`}
                href={href({ at: slot.startsAt })}
                active={params.at === slot.startsAt}
              >
                <span className="font-medium">
                  {salonTime(slot.startsAt, org.timezone)}
                </span>

                {/* Only worth saying when they did not choose a person. */}
                {!params.employee && (
                  <span className="ml-2 text-ink-muted">
                    {nameFor(slot.employeeId)}
                  </span>
                )}
              </Chip>
            ))}
          </div>
        )}

        {/*
          Not a fallback — the salon genuinely can fit people in. Staff booking
          deliberately ignores these times, because the receptionist may
          overrule the opening hours and squeeze someone between two bookings.
          Without this line a customer sees five options, assumes the day is
          full, and books elsewhere.
        */}
        {org.phone && (
          <p className="mt-6 text-sm text-ink-muted text-pretty">
            Don&rsquo;t see a time that works?{" "}
            <a
              href={`tel:${org.phone.replace(/[^\d+]/g, "")}`}
              className="font-medium text-brand hover:underline"
            >
              Call {org.phone}
            </a>{" "}
            — we can often fit you in.
          </p>
        )}
      </section>

      {chosen && selectedDay && (
        <section className="mt-10 rounded-2xl border border-line px-6 py-5">
          <h2 className="font-display text-xl font-semibold">Your booking</h2>

          <p className="mt-3 text-pretty">
            <span className="font-medium">{service.name}</span> with{" "}
            {nameFor(chosen.employeeId)} on{" "}
            {salonDayLabelLong(salonDateKey(chosen.startsAt, org.timezone))} at{" "}
            {salonTime(chosen.startsAt, org.timezone)}.
          </p>

          <p className="mt-4 text-sm text-ink-muted">
            Nothing is booked yet — the form that takes your name and number is
            the next thing being built.
          </p>
        </section>
      )}
    </Shell>
  );
}

/** The first step: what are we booking? */
async function ChooseService({
  orgId,
  currency,
}: {
  orgId: string;
  currency: string;
}) {
  const services = await getBookableServices(orgId);

  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Book an appointment
      </h1>

      <p className="mt-4 text-lg text-ink-muted text-pretty">
        Choose a service to see when we are free.
      </p>

      {services.length === 0 ? (
        <p className="mt-10 text-ink-muted">
          Online booking is briefly unavailable. Please call us.
        </p>
      ) : (
        <ul className="mt-10 divide-y divide-line border-t border-line">
          {services.map((service) => {
            const price = formatPrice(
              service.price,
              service.price_display,
              currency,
            );

            return (
              <li key={service.id}>
                <Link
                  href={`/book?service=${service.id}`}
                  className="flex flex-wrap justify-between gap-x-6 gap-y-2 py-5 transition-colors hover:text-brand"
                >
                  <div className="min-w-56 flex-1">
                    <h2 className="font-medium">{service.name}</h2>

                    {service.description && (
                      <p className="mt-1 text-sm text-ink-muted text-pretty">
                        {service.description}
                      </p>
                    )}
                  </div>

                  <div className="text-right">
                    <p className="font-medium whitespace-nowrap">
                      {price ?? "Call for a price"}
                    </p>

                    <p className="mt-1 text-sm text-ink-muted whitespace-nowrap">
                      {formatDuration(service.duration_minutes)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {/* DECISIONS #23 — the price list is longer than this list, on purpose. */}
      <p className="mt-12 rounded-2xl bg-surface-sunk px-6 py-5 text-sm text-ink-muted text-pretty">
        Our longer braiding appointments are booked by phone rather than online,
        so we can plan the day with you first. They are all on the{" "}
        <Link href="/services" className="font-medium text-brand hover:underline">
          services and pricing page
        </Link>
        .
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-3xl px-5 py-16">{children}</div>;
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full border border-brand bg-brand px-4 py-2 text-sm text-white"
          : "rounded-full border border-line px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
      }
    >
      {children}
    </Link>
  );
}
