import { cookies } from "next/headers";

/**
 * The booking session — which browser is part-way through a booking.
 *
 * A random token in a cookie. It identifies an *attempt*, not a person: it is
 * created when someone first holds a slot, it carries no name, phone number or
 * anything else about them, and it lapses within the hour.
 *
 * It exists so a customer keeps seeing the time they just chose. Availability
 * treats a live hold as busy for everyone except the session that made it, and
 * this is how the database knows which session that is.
 *
 * httpOnly, so page scripts cannot read it. Nothing in the browser needs to.
 */

const COOKIE = "booking_session";

/** Slightly longer than a hold, so a lapsed hold and a lost session differ. */
const LIFETIME_SECONDS = 60 * 60;

/** The current token, or null. Safe to call while rendering. */
export async function readBookingSession(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/**
 * The current token, creating one if there is none.
 *
 * Only callable from a server action or route handler — Next.js forbids
 * setting a cookie while rendering a page, which is correct: a page load
 * should not start reserving the salon's time.
 */
export async function ensureBookingSession(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;

  if (existing) return existing;

  const token = crypto.randomUUID();

  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: LIFETIME_SECONDS,
  });

  return token;
}
