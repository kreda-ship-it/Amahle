import type { Metadata } from "next";
import Link from "next/link";

import {
  getAvailableSlots,
  getBookableServices,
  getBookableServices_byIds,
  getEmployeesForServices,
  type BookableService,
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

import { BookingForm } from "./booking-form";

/**
 * The booking page — what, with whom, and when.
 *
 * Every choice lives in the URL rather than in the browser's memory:
 *
 *   1. The back button works. Someone half-way through booking is exactly the
 *      person who hits back, and a page holding state in React would lose it.
 *   2. Times are fetched fresh on every step. A slot list sitting in a browser
 *      goes stale while someone deliberates.
 *   3. Nothing is calculated here. `anon` has no privilege on the rota or on
 *      appointments, so this page could not work out availability even if we
 *      wanted it to.
 *
 * Services are a LIST — `?services=a,b` — because a visit can be a blow dry
 * and a trim. One service is simply a list of one, so there is no second code
 * path for the common case.
 */

export const metadata: Metadata = {
  title: "Book an appointment",
  description:
    "Choose your services, pick a time that suits you, and book online in under a minute.",
};

/*
 * Never cached. A cached availability page shows one customer the times
 * another took ten minutes ago, and the first they would learn of it is a
 * booking that fails.
 */
export const dynamic = "force-dynamic";

const DAYS_SHOWN = 14;

type SearchParams = {
  services?: string;
  employee?: string;
  date?: string;
  at?: string;
  add?: string;
};

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const org = await getOrganization();
  const params = await searchParams;

  const requested = (params.services ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const chosenServices = await getBookableServices_byIds(org.id, requested);

  // No services yet, or they asked to add another.
  if (chosenServices.length === 0 || params.add) {
    return (
      <ChooseService
        orgId={org.id}
        currency={org.currency}
        already={chosenServices}
      />
    );
  }

  const serviceIds = chosenServices.map((service) => service.id);
  const employees = await getEmployeesForServices(org.id, serviceIds);
  const days = salonDaysFrom(org.timezone, DAYS_SHOWN);

  // One call for the whole fortnight. The day chooser has to know which days
  // have anything before you pick one, and fourteen separate questions would
  // give fourteen slightly different moments of truth.
  const slots = await getAvailableSlots({
    orgId: org.id,
    serviceIds,
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

  const totalMinutes = chosenServices.reduce(
    (sum, service) => sum + service.duration_minutes,
    0,
  );

  const href = (next: Partial<SearchParams>) => {
    const query = new URLSearchParams();
    const merged = { ...params, ...next };

    for (const key of ["services", "employee", "date", "at", "add"] as const) {
      const value = merged[key];
      if (value) query.set(key, value);
    }

    return `/book?${query.toString()}`;
  };

  /** The same list with one entry removed, by position — duplicates are legal. */
  const withoutIndex = (index: number) =>
    serviceIds.filter((_, i) => i !== index).join(",");

  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Book an appointment
      </h1>

      {/* What they are having. */}
      <section className="mt-8 rounded-2xl bg-surface-sunk px-6 py-5">
        <h2 className="font-display text-lg font-semibold">Your visit</h2>

        <ul className="mt-3 divide-y divide-line">
          {chosenServices.map((service, index) => (
            <li
              key={`${service.id}-${index}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5"
            >
              <span className="font-medium">{service.name}</span>

              <span className="flex items-baseline gap-4 text-sm text-ink-muted">
                <span>{formatDuration(service.duration_minutes)}</span>
                <span>
                  {formatPrice(
                    service.price,
                    service.price_display,
                    org.currency,
                  ) ?? "Call for a price"}
                </span>

                {/* Removing the only service returns you to the chooser. */}
                <Link
                  href={
                    chosenServices.length === 1
                      ? "/book"
                      : href({
                          services: withoutIndex(index),
                          at: undefined,
                          employee: undefined,
                        })
                  }
                  className="text-brand hover:underline"
                >
                  Remove
                </Link>
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <Link
            href={href({ add: "1" })}
            className="text-sm font-medium text-brand hover:underline"
          >
            + Add another service
          </Link>

          <p className="text-sm text-ink-muted">
            About {formatDuration(totalMinutes)} in total
          </p>
        </div>
      </section>

      {/*
        Only the stylists who can do EVERY service, which is why adding a
        second service can shorten this list. A visit is one person from start
        to finish.
      */}
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

      {employees.length === 0 && (
        <p className="mt-10 rounded-2xl bg-surface-sunk px-6 py-5 text-pretty">
          Nobody on the team does all of those together. Try removing one, or
          call us and we will arrange it between two of us.
        </p>
      )}

      {/* When. */}
      {employees.length > 0 && (
        <>
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
                    title="Nothing free"
                  >
                    {salonDayLabel(day)}
                  </span>
                );
              })}
            </div>
          </section>

          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold">
              {selectedDay ? salonDayLabelLong(selectedDay) : "Available times"}
            </h2>

            {times.length === 0 ? (
              <p className="mt-4 text-ink-muted text-pretty">
                Nothing free in the next two weeks for that combination. Try
                removing a service, or call us.
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
              Not a fallback. Staff booking deliberately ignores these times,
              because the receptionist may overrule the opening hours and
              squeeze someone in. Without this line a customer sees five
              options, assumes the day is full, and books elsewhere.
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
        </>
      )}

      {chosen && (
        <section className="mt-10 rounded-2xl border border-line px-6 py-5">
          <h2 className="font-display text-xl font-semibold">Your details</h2>

          <BookingForm
            serviceIds={serviceIds.join(",")}
            employeeId={chosen.employeeId}
            startsAt={chosen.startsAt}
            summary={`${chosenServices
              .map((service) => service.name)
              .join(" and ")} with ${nameFor(
              chosen.employeeId,
            )} on ${salonDayLabelLong(
              salonDateKey(chosen.startsAt, org.timezone),
            )} at ${salonTime(chosen.startsAt, org.timezone)}.`}
          />
        </section>
      )}
    </Shell>
  );
}

/** Choosing a service — the first step, and the "add another" step. */
async function ChooseService({
  orgId,
  currency,
  already,
}: {
  orgId: string;
  currency: string;
  already: BookableService[];
}) {
  const services = await getBookableServices(orgId);
  const adding = already.length > 0;
  const chosenIds = already.map((service) => service.id);

  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        {adding ? "Add another service" : "Book an appointment"}
      </h1>

      <p className="mt-4 text-lg text-ink-muted text-pretty">
        {adding
          ? `Adding to ${already.map((service) => service.name).join(" and ")}. Anything else done at the same visit is with the same stylist, one after the other.`
          : "Choose a service to see when we are free."}
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
                  href={`/book?services=${[...chosenIds, service.id].join(",")}`}
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

      {adding && (
        <Link
          href={`/book?services=${chosenIds.join(",")}`}
          className="mt-8 inline-block text-sm font-medium text-brand hover:underline"
        >
          ← Back without adding
        </Link>
      )}

      {/* DECISIONS #23 — the price list is longer than this list, on purpose. */}
      <p className="mt-12 rounded-2xl bg-surface-sunk px-6 py-5 text-sm text-ink-muted text-pretty">
        Our longer braiding appointments are booked by phone rather than online,
        so we can plan the day with you first. They are all on the{" "}
        <Link
          href="/services"
          className="font-medium text-brand hover:underline"
        >
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
