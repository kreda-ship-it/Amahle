import type { Metadata } from "next";
import Link from "next/link";

import {
  getAvailableSlots,
  getBookableServices,
  getBookableServices_byIds,
  getEmployeesForServices,
  type BookableService,
} from "@/lib/appointments/availability";
import { getHolds, type Hold } from "@/lib/appointments/holds";
import { readBookingSession } from "@/lib/appointments/session";
import {
  salonDateKey,
  salonDayLabel,
  salonDayLabelLong,
  salonDaysFrom,
  salonTime,
} from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";
import { formatDuration, formatPrice } from "@/lib/site/pricing";

import { chooseTime } from "./actions";
import { BookingForm, type PersonSummary } from "./booking-form";

/**
 * The booking page.
 *
 * Two kinds of state, kept deliberately apart:
 *
 *   The URL holds the CHOICES — how many people, which services each of them
 *   wants, whether they asked for a particular stylist. The back button works,
 *   nothing goes stale in a browser, and a page load never writes anything.
 *
 *   The database holds the HOLDS — the times themselves. A chosen time is a
 *   reservation, and a reservation belongs where it can be enforced rather
 *   than in a URL somebody could edit.
 *
 * A party is booked one person at a time, which is the salon's own
 * description: "like two different people booking". Each person's slot is held
 * while the next one chooses, so the mother's 10:45 with Hanna survives — and
 * blocks Hanna for the daughter, who is offered somebody else at the same
 * time.
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
const MAX_PARTY = 4;

type SearchParams = Record<string, string | undefined>;

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const org = await getOrganization();
  const params = await searchParams;

  const party = clampParty(params.party);

  if (!party) return <ChooseParty />;

  const person = Math.min(Math.max(Number(params.p ?? "0") || 0, 0), party - 1);
  const requested = splitIds(params[`s${person}`]);

  const chosenServices = await getBookableServices_byIds(org.id, requested);

  if (chosenServices.length === 0 || params.add) {
    return (
      <ChooseService
        orgId={org.id}
        currency={org.currency}
        already={chosenServices}
        party={party}
        person={person}
        params={params}
      />
    );
  }

  const serviceIds = chosenServices.map((service) => service.id);
  const employees = await getEmployeesForServices(org.id, serviceIds);
  const days = salonDaysFrom(org.timezone, DAYS_SHOWN);
  const sessionToken = await readBookingSession();

  const holds = sessionToken ? await getHolds(sessionToken) : [];
  const heldBy = new Map(holds.map((hold) => [hold.partyIndex, hold]));
  const mine = heldBy.get(person) ?? null;

  const slots = await getAvailableSlots({
    orgId: org.id,
    serviceIds,
    fromDate: days[0],
    toDate: days[days.length - 1],
    employeeId: params[`e${person}`] ?? null,
    sessionToken,
    partyIndex: person,
  });

  const byDay = new Map<string, typeof slots>();

  for (const slot of slots) {
    const key = salonDateKey(slot.startsAt, org.timezone);
    const existing = byDay.get(key);
    if (existing) existing.push(slot);
    else byDay.set(key, [slot]);
  }

  // The rest of the party's chosen moments. Person two is shown times that
  // match one of these first, so a family can be seen together.
  const partyTimes = new Set(
    holds.filter((hold) => hold.partyIndex !== person).map((h) => h.startsAt),
  );

  const selectedDay =
    params.date && byDay.has(params.date)
      ? params.date
      : (mine
          ? salonDateKey(mine.startsAt, org.timezone)
          : (days.find((day) => byDay.has(day)) ?? null));

  const times = [...(selectedDay ? (byDay.get(selectedDay) ?? []) : [])].sort(
    (a, b) => {
      const aMatch = partyTimes.has(a.startsAt) ? 0 : 1;
      const bMatch = partyTimes.has(b.startsAt) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      return a.startsAt.localeCompare(b.startsAt);
    },
  );

  const nameFor = (id: string) =>
    employees.find((employee) => employee.id === id)?.full_name ?? "our team";

  const everyoneHeld = Array.from({ length: party }, (_, i) => i).every((i) =>
    heldBy.has(i),
  );

  const href = (next: SearchParams) => {
    const query = new URLSearchParams();
    const merged = { ...params, ...next };

    for (const [key, value] of Object.entries(merged)) {
      if (value && key !== "problem" && key !== "add") query.set(key, value);
    }

    if (next.add) query.set("add", next.add);

    return `/book?${query.toString()}`;
  };

  /** Every current parameter, as hidden fields the action puts straight back. */
  const carry = Object.entries(params)
    .filter(([key, value]) => value && key !== "problem" && key !== "add")
    .map(([key, value]) => ({ name: `q:${key}`, value: value as string }));

  const totalMinutes = chosenServices.reduce(
    (sum, service) => sum + service.duration_minutes,
    0,
  );

  const who = party === 1 ? "" : person === 0 ? " — you" : ` — person ${person + 1}`;

  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Book an appointment
      </h1>

      {party > 1 && (
        <p className="mt-3 text-ink-muted">
          Booking for {party} people, one at a time. Person {person + 1} of{" "}
          {party}.
        </p>
      )}

      {params.problem && (
        <p
          role="alert"
          className="mt-6 rounded-xl border border-brand/40 bg-brand/5 px-5 py-4 text-pretty"
        >
          {params.problem}
        </p>
      )}

      <section className="mt-8 rounded-2xl bg-surface-sunk px-6 py-5">
        <h2 className="font-display text-lg font-semibold">
          This visit{who}
        </h2>

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

                <Link
                  href={href({
                    [`s${person}`]:
                      serviceIds.filter((_, i) => i !== index).join(",") ||
                      undefined,
                    [`e${person}`]: undefined,
                  })}
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

      {employees.length > 1 && (
        <section className="mt-10">
          <h2 className="font-display text-xl font-semibold">
            Who would you like?
          </h2>

          <div className="mt-4 flex flex-wrap gap-2">
            <Chip
              href={href({ [`e${person}`]: undefined })}
              active={!params[`e${person}`]}
            >
              Anyone
            </Chip>

            {employees.map((employee) => (
              <Chip
                key={employee.id}
                href={href({ [`e${person}`]: employee.id })}
                active={params[`e${person}`] === employee.id}
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

      {employees.length > 0 && (
        <>
          <section className="mt-10">
            <h2 className="font-display text-xl font-semibold">Pick a day</h2>

            <div className="mt-4 flex flex-wrap gap-2">
              {days.map((day) =>
                byDay.has(day) ? (
                  <Chip
                    key={day}
                    href={href({ date: day })}
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
                ),
              )}
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
                {/*
                  A form, not a link. Choosing a time RESERVES it, and a write
                  must not happen because a page was loaded — a crawler or a
                  browser prefetch would start holding the salon's afternoon.
                */}
                {times.map((slot) => {
                  const chosen = mine?.startsAt === slot.startsAt;
                  const together = partyTimes.has(slot.startsAt);

                  return (
                    <form
                      key={`${slot.startsAt}-${slot.employeeId}`}
                      action={chooseTime}
                    >
                      {carry.map((field) => (
                        <input
                          key={field.name}
                          type="hidden"
                          name={field.name}
                          value={field.value}
                        />
                      ))}
                      <input
                        type="hidden"
                        name="serviceIds"
                        value={serviceIds.join(",")}
                      />
                      <input
                        type="hidden"
                        name="employeeId"
                        value={slot.employeeId}
                      />
                      <input
                        type="hidden"
                        name="startsAt"
                        value={slot.startsAt}
                      />
                      <input
                        type="hidden"
                        name="partyIndex"
                        value={String(person)}
                      />
                      <input
                        type="hidden"
                        name="date"
                        value={selectedDay ?? ""}
                      />

                      <button
                        type="submit"
                        className={
                          chosen
                            ? "rounded-full border border-brand bg-brand px-4 py-2 text-sm text-white"
                            : "rounded-full border border-line px-4 py-2 text-sm transition-colors hover:border-brand hover:text-brand"
                        }
                      >
                        <span className="font-medium">
                          {salonTime(slot.startsAt, org.timezone)}
                        </span>

                        {!params[`e${person}`] && (
                          <span className="ml-2 text-ink-muted">
                            {nameFor(slot.employeeId)}
                          </span>
                        )}

                        {/* The whole point of booking a family together. */}
                        {together && !chosen && (
                          <span className="ml-2 text-brand">same time</span>
                        )}
                      </button>
                    </form>
                  );
                })}
              </div>
            )}

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

      {/* Held, and there is somebody else still to choose. */}
      {mine && !everyoneHeld && (
        <section className="mt-10 rounded-2xl border border-line px-6 py-5">
          <p className="text-pretty">
            Held until {salonTime(mine.expiresAt, org.timezone)}. Now choose for
            the next person.
          </p>

          <Link
            href={href({ p: String(nextUnheld(party, heldBy)), date: undefined })}
            className="mt-4 inline-block rounded-full bg-brand px-6 py-3 font-medium text-white transition-colors hover:bg-brand-strong"
          >
            Next person
          </Link>
        </section>
      )}

      {everyoneHeld && (
        <PartyDetails
          org={org}
          party={party}
          params={params}
          holds={holds}
          heldBy={heldBy}
        />
      )}
    </Shell>
  );
}

/** The contact form, once every person in the party has a time. */
async function PartyDetails({
  org,
  party,
  params,
  holds,
  heldBy,
}: {
  org: Awaited<ReturnType<typeof getOrganization>>;
  party: number;
  params: SearchParams;
  holds: Hold[];
  heldBy: Map<number, Hold>;
}) {
  const people: PersonSummary[] = [];

  for (let index = 0; index < party; index++) {
    const hold = heldBy.get(index)!;
    const services = await getBookableServices_byIds(
      org.id,
      splitIds(params[`s${index}`]),
    );

    const employees = await getEmployeesForServices(
      org.id,
      services.map((service) => service.id),
    );

    const stylist =
      employees.find((employee) => employee.id === hold.employeeId)
        ?.full_name ?? "our team";

    people.push({
      serviceIds: services.map((service) => service.id).join(","),
      summary: `${services.map((service) => service.name).join(" and ")} with ${stylist} on ${salonDayLabelLong(
        salonDateKey(hold.startsAt, org.timezone),
      )} at ${salonTime(hold.startsAt, org.timezone)}.`,
    });
  }

  // The earliest lapse governs — once one hold goes the booking is incomplete.
  const soonest = holds.reduce(
    (earliest, hold) => (hold.expiresAt < earliest ? hold.expiresAt : earliest),
    holds[0].expiresAt,
  );

  return (
    <section className="mt-10 rounded-2xl border border-line px-6 py-5">
      <h2 className="font-display text-xl font-semibold">Your details</h2>

      <BookingForm
        people={people}
        heldUntil={salonTime(soonest, org.timezone)}
      />
    </section>
  );
}

function ChooseParty() {
  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        Book an appointment
      </h1>

      <p className="mt-4 text-lg text-ink-muted text-pretty">
        How many people are coming?
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        {Array.from({ length: MAX_PARTY }, (_, index) => index + 1).map(
          (size) => (
            <Link
              key={size}
              href={`/book?party=${size}`}
              className="rounded-full border border-line px-6 py-3 font-medium transition-colors hover:border-brand hover:text-brand"
            >
              {size === 1 ? "Just me" : `${size} people`}
            </Link>
          ),
        )}
      </div>

      <p className="mt-10 rounded-2xl bg-surface-sunk px-6 py-5 text-sm text-ink-muted text-pretty">
        More than four, or something complicated? Give us a ring and we will
        plan it with you.
      </p>
    </Shell>
  );
}

async function ChooseService({
  orgId,
  currency,
  already,
  party,
  person,
  params,
}: {
  orgId: string;
  currency: string;
  already: BookableService[];
  party: number;
  person: number;
  params: SearchParams;
}) {
  const services = await getBookableServices(orgId);
  const adding = already.length > 0;
  const chosenIds = already.map((service) => service.id);

  const to = (ids: string[]) => {
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "add" && key !== "problem") query.set(key, value);
    }

    query.set("party", String(party));
    query.set("p", String(person));
    query.set(`s${person}`, ids.join(","));

    return `/book?${query.toString()}`;
  };

  return (
    <Shell>
      <h1 className="font-display text-3xl font-semibold sm:text-4xl">
        {adding ? "Add another service" : "What would you like?"}
      </h1>

      <p className="mt-4 text-lg text-ink-muted text-pretty">
        {adding
          ? "Anything added is done at the same visit, by the same stylist, one after the other."
          : party > 1
            ? `Choosing for person ${person + 1} of ${party}.`
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
                  href={to([...chosenIds, service.id])}
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
          href={to(chosenIds)}
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

function clampParty(value: string | undefined): number | null {
  const party = Number(value);
  if (!Number.isInteger(party) || party < 1 || party > MAX_PARTY) return null;
  return party;
}

function splitIds(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

function nextUnheld(party: number, heldBy: Map<number, unknown>): number {
  for (let index = 0; index < party; index++) {
    if (!heldBy.has(index)) return index;
  }
  return party - 1;
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
