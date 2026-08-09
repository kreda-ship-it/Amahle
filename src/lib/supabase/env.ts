/**
 * Reads the two Supabase environment variables.
 *
 * This exists only so that a missing variable fails with a sentence you can
 * act on, instead of a confusing "undefined is not a string" further down.
 */

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Copy .env.local.example to .env.local and fill it in, then restart the dev server.`,
    );
  }

  return value;
}

export const SUPABASE_URL = () => required("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_ANON_KEY = () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
