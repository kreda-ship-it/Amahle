import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * A Supabase client for code that runs on the server — pages, layouts, and
 * route handlers.
 *
 * It is wired into Next.js's cookie store, because that is where a logged-in
 * session lives. Without that wiring the server would treat every request as
 * a logged-out visitor, and row-level security would correctly show it
 * nothing.
 *
 * Create a new one per request. Never store it in a module-level variable —
 * one request's session would leak into another's.
 *
 * This file creates the connection. It does not call `supabase.auth` and it
 * must not: authentication belongs in /lib/auth and nowhere else.
 *
 * `<Database>` hands the client the real shape of every table, generated from
 * the live schema by `supabase gen types`. Without it, every query returns
 * `any` and a misspelled column is only discovered in the browser. Regenerate
 * that file after any migration, or it starts describing a database that no
 * longer exists.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL(), SUPABASE_ANON_KEY(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Next.js forbids setting cookies while rendering a Server
          // Component. That is fine and expected: the middleware added in a
          // later stage refreshes the session before rendering begins, so
          // there is nothing to write here.
        }
      },
    },
  });
}
