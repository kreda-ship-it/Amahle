/**
 * Reads the two Supabase environment variables.
 *
 * This exists only so that a missing variable fails with a sentence you can
 * act on, instead of a confusing "undefined is not a string" further down.
 *
 * Note that each variable is written out in full below rather than looked up
 * by name. That is not stylistic. Next.js substitutes the real value into
 * browser and middleware code by finding the literal text
 * `process.env.NEXT_PUBLIC_...` at build time. A dynamic lookup like
 * `process.env[name]` is invisible to it, and the value would arrive empty.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. ` +
        `Copy .env.local.example to .env.local and fill it in, then restart the dev server.`,
    );
  }

  return value;
}

export const SUPABASE_URL = () =>
  required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);

export const SUPABASE_ANON_KEY = () =>
  required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
