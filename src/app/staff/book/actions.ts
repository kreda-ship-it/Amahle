"use server";

import { requirePermission } from "@/lib/auth";
import { createAppointment } from "@/lib/appointments/create";
import {
  getLeadEmployeesForAll,
  getServiceQuestions,
  type LeadEmployee,
  type ServiceQuestion,
} from "@/lib/appointments/menu";
import {
  getVisitSlots,
  getVisitTotals,
  type VisitSelection,
  type VisitSlot,
} from "@/lib/appointments/visits";
import { findCustomerByPhone, type KnownCustomer } from "@/lib/customers/find";
import { salonInstant } from "@/lib/site/datetime";
import { getOrganization } from "@/lib/site/organization";

/**
 * What the entry form is allowed to ask the server.
 *
 * Every function here starts with `requirePermission("appointment.create")`.
 * That is not the security boundary — row-level security and
 * `create_appointment()` are, and they would refuse a stranger regardless —
 * but a server action is a public HTTP endpoint the moment it is imported by a
 * client component, so each one states its own requirement rather than
 * inheriting a page's.
 *
 * The form holds its state in the component rather than in the URL, which is
 * the opposite of the public booking form and deliberate. That form leads a
 * customer one question at a time and needs the back button to work. This one
 * is a single dense screen for somebody with a customer on the telephone, and
 * navigation between steps would be an obstacle rather than a feature.
 */

/**
 * What one service asks.
 *
 * Fetched per service rather than per visit, and cached by the form against
 * the service id, because a visit is a list and the same style may appear in
 * it twice — "a trim for her and a trim for her sister" is two lines asking
 * one set of questions.
 */
export async function loadQuestions(
  serviceId: string,
): Promise<ServiceQuestion[]> {
  await requirePermission("appointment.create");

  const org = await getOrganization();

  return getServiceQuestions(org.id, serviceId);
}

/** Who can lead every service in the visit — see the note on the query. */
export async function loadLeadEmployees(
  serviceIds: string[],
): Promise<LeadEmployee[]> {
  await requirePermission("appointment.create");

  const org = await getOrganization();

  return getLeadEmployeesForAll(org.id, serviceIds);
}

/** The running total, recomputed by the database on every answer. */
export async function loadTotals(selection: VisitSelection[]) {
  await requirePermission("appointment.create");

  const org = await getOrganization();

  return getVisitTotals(org.id, selection);
}

/** Suggested start times for one day. */
export async function loadSlots(input: {
  serviceIds: string[];
  date: string;
  employeeId: string | null;
  selection: VisitSelection[];
}): Promise<VisitSlot[]> {
  await requirePermission("appointment.create");

  const org = await getOrganization();

  return getVisitSlots({
    orgId: org.id,
    serviceIds: input.serviceIds,
    fromDate: input.date,
    toDate: input.date,
    employeeId: input.employeeId,
    selection: input.selection,
  });
}

/**
 * Is this number already somebody we know?
 *
 * Called as the receptionist types. Returns null for anything too short to be
 * a phone number, so the first three digits do not each cost a query.
 */
export async function lookUpCustomer(
  phone: string,
): Promise<KnownCustomer | null> {
  await requirePermission("appointment.create");

  const org = await getOrganization();

  return findCustomerByPhone(org.id, phone);
}

export type BookResult =
  | { ok: true; visitId: string; date: string }
  | { ok: false; message: string };

/**
 * Take the booking.
 *
 * Calls the same `createAppointment()` the public form calls, which calls the
 * same `create_appointment()` in Postgres. That is PROJECT.md's central
 * requirement made real: one calendar, two entry paths, one code path. A
 * second way to make an appointment is how a calendar starts disagreeing with
 * reality.
 *
 * `source` is not passed and cannot be — the database derives it from whether
 * anybody is logged in, so a booking taken here is recorded as `staff` and one
 * taken on the website as `online`. PROJECT.md calls that column the real
 * measure of whether this project worked, and a parameter is a way for it to
 * be wrong.
 *
 * WHAT STAFF MAY OVERRULE, AND WHAT THEY MAY NOT. `create_appointment()` skips
 * three checks for a staff booking: the time may be in the past, the service
 * need not be bookable online, and the lead need not be free by the rota. It
 * does NOT skip the finishing chain — an assistant has to be genuinely free to
 * work the length of a braid down, and when none is, the booking is refused
 * with "We do not have anyone free to finish that". That refusal is real and
 * not a bug: the receptionist can overrule a rota, not conjure a colleague.
 */
export async function submitBooking(input: {
  serviceIds: string[];
  employeeIds: string[];
  /** From a suggested slot. Empty when the time was typed by hand. */
  startsAt: string;
  /**
   * A time the receptionist set herself, in the salon's own clock — the
   * squeeze-you-in case. Converted to a real instant here rather than in the
   * browser, because which instant "18:45 on the 25th" is depends on the
   * salon's timezone and on which side of a clock change it falls.
   */
  manual: { date: string; time: string } | null;
  selection: VisitSelection[];
  customerName: string;
  customerPhone: string;
  customerEmail: string | null;
  forName: string | null;
  notes: string | null;
  employeeRequested: boolean;
}): Promise<BookResult> {
  await requirePermission("appointment.create");

  const org = await getOrganization();

  /*
   * Only what a FORM can know about — that the boxes are filled in. Every real
   * rule belongs to the database, because the database is what holds whatever
   * calls it. Same division as the public form.
   */
  if (input.serviceIds.length === 0) {
    return { ok: false, message: "Choose a service." };
  }
  if (!input.customerName.trim()) {
    return { ok: false, message: "Enter the customer's name." };
  }
  if (!input.customerPhone.trim()) {
    return { ok: false, message: "Enter the customer's phone number." };
  }
  /*
   * A typed time needs a named person. A suggested slot carries the stylist
   * it belongs to; a time nobody offered belongs to nobody, and
   * create_appointment() has to be told who is doing the work.
   */
  const startsAt = input.manual
    ? salonInstant(input.manual.date, input.manual.time, org.timezone)
    : input.startsAt;

  if (!startsAt) {
    return { ok: false, message: "Choose a time, or set one yourself." };
  }
  if (input.manual && input.employeeIds.some((id) => !id)) {
    return {
      ok: false,
      message: "Choose who is doing it — a time you set yourself needs a name.",
    };
  }

  const result = await createAppointment({
    organizationId: org.id,
    serviceIds: input.serviceIds,
    employeeIds: input.employeeIds,
    startsAt,
    selection: input.selection,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    customerEmail: input.customerEmail?.trim() || null,
    forName: input.forName?.trim() || null,
    notes: input.notes?.trim() || null,
    employeeRequested: input.employeeRequested,
  });

  if (!result.ok) return { ok: false, message: result.message };

  /*
   * The day the booking landed on, so the caller can send the receptionist to
   * it. Computed from the instant in the salon's timezone, not the server's —
   * a late booking on a machine set to UTC would otherwise open tomorrow.
   */
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: org.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(startsAt));

  return { ok: true, visitId: result.visitId, date };
}
