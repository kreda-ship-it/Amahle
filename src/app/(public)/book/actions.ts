"use server";

import { redirect } from "next/navigation";

import {
  getAvailableSlots,
  getEmployeesForServices,
} from "@/lib/appointments/availability";
import { createAppointment } from "@/lib/appointments/create";
import { holdSlot } from "@/lib/appointments/holds";
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
 * bookable online, a stylist who does not perform it, a time in the past and a
 * slot already taken — and it refuses them whatever calls it, which a check in
 * this file could never claim. What is checked here is only what a *form*
 * knows about: that someone filled the boxes in.
 */

/** An alternative offered when the chosen slot has gone. */
export type Alternative = {
  href: string;
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
  const employee = text(formData, "employee");
  const date = text(formData, "date");

  const query = new URLSearchParams();
  if (serviceIds) query.set("services", serviceIds);
  if (employee) query.set("employee", employee);
  if (date) query.set("date", date);

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
  });

  if (!held.ok) {
    query.set("problem", held.message);
    redirect(`/book?${query.toString()}`);
  }

  query.set("at", startsAt);
  redirect(`/book?${query.toString()}`);
}

export async function submitBooking(
  _previous: BookingState,
  formData: FormData,
): Promise<BookingState> {
  const org = await getOrganization();

  const serviceIds = text(formData, "serviceIds")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const employeeId = text(formData, "employeeId");
  const startsAt = text(formData, "startsAt");
  const name = text(formData, "customerName");
  const phone = text(formData, "customerPhone");
  const email = text(formData, "customerEmail");
  const notes = text(formData, "notes");

  if (serviceIds.length === 0 || !employeeId || !startsAt) {
    return {
      status: "error",
      message:
        "Something went wrong with your chosen time. Please pick it again.",
    };
  }

  if (!name) {
    return { status: "error", message: "Please tell us your name." };
  }

  // Deliberately loose. Phone numbers are written a dozen ways and
  // normalize_phone() in the database sorts the rest out; this only catches
  // an empty box or an obvious slip.
  if (countDigits(phone) < 7) {
    return {
      status: "error",
      message: "Please give us a phone number we can reach you on.",
    };
  }

  const result = await createAppointment({
    organizationId: org.id,
    sessionToken: await readBookingSession(),
    serviceIds,
    employeeId,
    startsAt,
    customerName: name,
    customerPhone: phone,
    customerEmail: email || null,
    notes: notes || null,
  });

  if (result.ok) {
    // Outside any try/catch on purpose: redirect() works by throwing, and a
    // catch here would swallow it and leave the customer staring at the form
    // after their appointment had been made.
    redirect(`/book/confirmed/${result.visitId}`);
  }

  if (result.reason === "slot_taken") {
    return {
      status: "error",
      message: result.message,
      alternatives: await findAlternatives({
        orgId: org.id,
        timezone: org.timezone,
        serviceIds,
        startsAt,
      }),
    };
  }

  return { status: "error", message: result.message };
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

  return scored.map(({ slot, sameTime }) => {
    const query = new URLSearchParams({
      services: input.serviceIds.join(","),
      date: day,
      at: slot.startsAt,
    });

    return {
      href: `/book?${query.toString()}`,
      time: salonTime(slot.startsAt, input.timezone),
      employee:
        employees.find((employee) => employee.id === slot.employeeId)
          ?.full_name ?? "our team",
      sameTime,
    };
  });
}

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function countDigits(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}
