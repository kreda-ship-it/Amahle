import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * A Supabase client for code that runs in the browser — only components
 * marked "use client".
 *
 * Almost nothing should need this. Data loading happens on the server by
 * default. The first real use is the login form, where a person types into
 * an input box and the browser has to be the one holding the keystrokes.
 *
 * Safe to call repeatedly: @supabase/ssr returns the same instance.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(SUPABASE_URL(), SUPABASE_ANON_KEY());
}
