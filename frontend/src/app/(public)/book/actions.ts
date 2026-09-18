"use server";

import { redirect } from "next/navigation";

import {
  getAvailableSlots,
  getEmployeesForServices,
} from "@/lib/appointments/availability";
import { createAppointment } from "@/lib/appointments/create";
import { getHolds, holdSlot } from "@/lib/appointments/holds";
import {
  ensureBookingSession,
  readBookingSession,
} from "@/lib/appointments/session";
import { salonDateKey, salonTime } from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";

/**
 * Submitting a booking.
 *
 * A server action: it runs on the server even though a browser form triggers
 * it, so the customer's browser never talks to the database and never holds a
 * key of any kind.
 *
 * Almost nothing is validated here. The database refuses a service that is not
 * bookable online, a stylist who does not perform it, a time in the past, a
 * time nobody is rostered to work, and a slot already taken — and it refuses
 * them whatever calls it, which a check in this file could never claim. What is checked here is only what a *form*
 * knows about: that someone filled the boxes in.
 */

/**
 * An alternative offered when the chosen slot has gone.
 *
 * `fields` are hidden inputs for `chooseTime`, built here rather than in
 * the browser: choosing one of these reserves it, and the form component
 * holds no booking logic of its own.
 */
export type Alternative = {
  fields: { name: string; value: string }[];
  time: string;
  employee: string;
  sameTime: boolean;
};

export type BookingState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      /** Set only when the slot was taken, and possibly empty. */
      alternatives?: Alternative[];
    };

/**
 * Choosing a time — which reserves it.
 *
 * A button rather than a link, deliberately. Holding a slot is a write, and a
 * write must not happen because a page was loaded: a crawler or a browser
 * prefetch would quietly start reserving the salon's afternoon.
 *
 * Failures come back as a query parameter rather than as state, because the
 * time list is rendered by a server component and a redirect is the honest way
 * to say "that one has gone, here is the list again".
 */
export async function chooseTime(formData: FormData): Promise<void> {
  const org = await getOrganization();

  const serviceIds = text(formData, "serviceIds");
  const employeeId = text(formData, "employeeId");
  const startsAt = text(formData, "startsAt");
  const date = text(formData, "date");

  // Everything the picker needs to rebuild itself, carried through the
  // redirect untouched. The action knows nothing about the shape of the
  // party; it just puts back what it was handed.
  const query = new URLSearchParams();

  for (const [key, value] of formData.entries()) {
    if (key.startsWith("q:") && typeof value === "string" && value) {
      query.set(key.slice(2), value);
    }
  }

  const partyIndex = Number(text(formData, "partyIndex") || "0");

  if (!serviceIds || !employeeId || !startsAt) {
    redirect(`/book?${query.toString()}`);
  }

  const sessionToken = await ensureBookingSession();

  const held = await holdSlot({
    orgId: org.id,
    serviceIds: serviceIds.split(",").filter(Boolean),
    employeeId,
    startsAt,
    sessionToken,
    partyIndex,
  });

  if (!held.ok) {
    query.set("problem", held.message);
    redirect(`/book?${query.toString()}`);
  }

  if (date) query.set("date", date);
  redirect(`/book?${query.toString()}`);
}

export async function submitBooking(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const org = await getOrganization();

  const party = Math.max(1, Number(text(formData, "party") || "1"));
  const name = text(formData, "customerName");
  const phone = text(formData, "customerPhone");
  const email = text(formData, "customerEmail");
  const notes = text(formData, "notes");

  if (!name) {
    return { status: "error", message: "Please tell us your name." };
  }

  // Deliberately loose. normalize_phone() in the database sorts out the dozen
  // ways people write a number; this only catches an empty box.
  if (countDigits(phone) < 7) {
    return {
      status: "error",
      message: "Please give us a phone number we can reach you on.",
    };
  }

  const sessionToken = await readBookingSession();

  if (!sessionToken) {
    return {
      status: "error",
      message: "Your held times have lapsed. Please choose again.",
    };
  }

  // The chosen times live in the holds, not in the form. A form field could be
  // edited; a hold is a reservation the database is enforcing.
  const holds = await getHolds(sessionToken);
  const byPerson = new Map(holds.map((hold) => [hold.partyIndex, hold]));

  for (let person = 0; person < party; person++) {
    if (!byPerson.has(person)) {
      return {
        status: "error",
        message:
          "One of your held times has lapsed. Please choose it again — the others are still held.",
      };
    }
  }

  /*
   * Booked one person at a time, sharing a visit id so the party gets one
   * confirmation. Not atomic across people, and that is a deliberate
   * acceptance rather than an oversight: each person's slot is held, so a
   * later failure is unlikely, and a mother whose own appointment succeeded
   * has genuinely got that appointment. What matters is telling her plainly
   * which one did not.
   */
  let visitId: string | null = null;

  for (let person = 0; person < party; person++) {
    const hold = byPerson.get(person)!;

    const serviceIds = text(formData, `services${person}`)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (serviceIds.length === 0) {
      return {
        status: "error",
        message: "Something went wrong with the services chosen. Please start again.",
      };
    }

    const result = await createAppointment({
      organizationId: org.id,
      sessionToken,
      partyIndex: person,
      visitId,
      serviceIds,

      /*
       * One employee for the whole visit, which is what the current flow can
       * express: availability still finds one person free for all of it.
       * Migration 028 accepts a list so that a wash by one person and braids
       * by another becomes possible; migration 029 is what will start
       * OFFERING those times, and this line grows a second entry then.
       */
      employeeIds: [hold.employeeId],

      /*
       * Left at its default of false, and deliberately not guessed. The flow
       * does let somebody filter to one stylist before picking a time, but
       * that filter does not reach this action, so setting this true here
       * would mark every booking a request. It is wired when the
       * choose-your-professional step is rebuilt — see DECISIONS #32 for why
       * the receptionist needs the difference.
       */
      startsAt: hold.startsAt,
      customerName: name,
      customerPhone: phone,
      customerEmail: email || null,
      notes: person === 0 ? notes || null : null,
      // Person 0 is whoever is booking, so their appointments need no label.
      forName: person === 0 ? null : text(formData, `forName${person}`) || null,
    });

    if (!result.ok) {
      if (visitId) {
        return {
          status: "error",
          message: `${result.message} The earlier appointments in this booking were made — see them at /book/confirmed/${visitId}.`,
        };
      }

      if (result.reason === "slot_taken") {
        return {
          status: "error",
          message: result.message,
          alternatives: await findAlternatives({
            orgId: org.id,
            timezone: org.timezone,
            serviceIds,
            startsAt: hold.startsAt,
            party,
            person,
          }),
        };
      }

      return { status: "error", message: result.message };
    }

    visitId = result.visitId;
  }

  // redirect() works by throwing, so it stays outside any try/catch — a catch
  // would swallow it and leave the customer staring at the form after their
  // appointments had been made.
  redirect(`/book/confirmed/${visitId}`);
}

/**
 * What to offer when someone else got there first.
 *
 * The same time with a different stylist comes first, because that is what the
 * customer actually wanted — they chose a moment in their day, not a person.
 * Then the nearest other times on the same day.
 *
 * No new query. Every slot already carries the stylist it belongs to, which is
 * what makes "someone else, same time" a filter rather than a feature.
 */
async function findAlternatives(input: {
  orgId: string;
  timezone: string;
  serviceIds: string[];
  startsAt: string;
  /** So the picker can be rebuilt exactly where the customer left it. */
  party: number;
  person: number;
}): Promise<Alternative[]> {
  const day = salonDateKey(input.startsAt, input.timezone);

  const [slots, employees] = await Promise.all([
    getAvailableSlots({
      orgId: input.orgId,
      serviceIds: input.serviceIds,
      fromDate: day,
      toDate: day,
    }),
    getEmployeesForServices(input.orgId, input.serviceIds),
  ]);

  const wanted = new Date(input.startsAt).getTime();

  const scored = slots
    .filter((slot) => slot.startsAt !== input.startsAt)
    .map((slot) => {
      const sameTime = new Date(slot.startsAt).getTime() === wanted;

      return {
        slot,
        sameTime,
        distance: Math.abs(new Date(slot.startsAt).getTime() - wanted),
      };
    })
    .sort((a, b) => {
      if (a.sameTime !== b.sameTime) return a.sameTime ? -1 : 1;
      return a.distance - b.distance;
    })
    .slice(0, 6);

  const serviceIds = input.serviceIds.join(",");

  return scored.map(({ slot, sameTime }) => ({
    /*
     * Everything `chooseTime` needs, plus the `q:` parameters it hands
     * straight back to the picker. These are the names the page actually
     * reads — `party`, `p`, `s{person}`. The previous version sent
     * `services` and `at`, which nothing reads, and no `party` at all,
     * so clampParty() returned null and the customer was dropped back on
     * the "how many people are coming?" screen at the exact moment they
     * were most likely to give up.
     */
    fields: [
      { name: "q:party", value: String(input.party) },
      { name: "q:p", value: String(input.person) },
      { name: `q:s${input.person}`, value: serviceIds },
      { name: "serviceIds", value: serviceIds },
      { name: "employeeId", value: slot.employeeId },
      { name: "startsAt", value: slot.startsAt },
      { name: "partyIndex", value: String(input.person) },
      { name: "date", value: day },
    ],
    time: salonTime(slot.startsAt, input.timezone),
    employee:
      employees.find((employee) => employee.id === slot.employeeId)
        ?.full_name ?? "our team",
    sameTime,
  }));
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function countDigits(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}
