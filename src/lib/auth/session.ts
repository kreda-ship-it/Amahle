import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * Keeps a signed-in session alive.
 *
 * A login token is short-lived by design — roughly an hour — so that a stolen
 * one stops being useful quickly. It comes with a longer-lived refresh token
 * that can mint a new one. Somebody has to actually do that swap, and hand
 * the new token back to the browser as a cookie.
 *
 * That somebody is this function, running before every page load. Without it
 * a receptionist gets silently signed out mid-shift.
 *
 * This lives in /lib/auth rather than /lib/supabase because it calls
 * supabase.auth, and those calls do not leave this folder.
 *
 * The file was `middleware.ts` and is now `session.ts`. It is named for what
 * it does rather than for whichever Next.js convention invokes it — that
 * convention has just been renamed once already, and refreshing a session is
 * the same job regardless of what the framework calls the file above it.
 */
export async function updateSession(request: NextRequest) {
  // The response we will eventually send. It gets rebuilt below if the
  // session was refreshed, because that is when new cookies exist.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Two places, deliberately. The request copy is what the page about
        // to render will read; the response copy is what the browser stores
        // for next time. Miss either and the session appears to drop.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }

        response = NextResponse.next({ request });

        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // This call is the entire point of the function: it validates the session
  // and, if the token has aged out, quietly issues a fresh one.
  //
  // Nothing may go between creating the client above and this line. Code in
  // between can read a stale session and cause users to be logged out at
  // random — a genuinely horrible bug to track down.
  await supabase.auth.getUser();

  return response;
}
