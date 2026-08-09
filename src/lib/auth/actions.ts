"use server";

import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Server actions for signing in and out.
 *
 * "use server" at the top means every function here runs on the server, even
 * when a form in the browser calls it. That matters: the password is sent
 * once, over the wire, and is never held by browser JavaScript.
 *
 * These are the only `supabase.auth` write calls in the codebase, and they
 * are inside /lib/auth, where they belong.
 */

export type SignInState = { error: string | null };

/**
 * Signs in with email and password.
 *
 * The shape (previous state, form data) is what React's `useActionState`
 * expects, which is how the form shows an error without reloading the page.
 */
export async function signIn(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately vague. Saying "no account with that email" would let a
    // stranger discover who works here, one guess at a time.
    return { error: "Those details didn't work. Check them and try again." };
  }

  // Outside the try/catch of a return value: redirect() works by throwing,
  // so it must be the last thing that happens.
  redirect("/");
}

/** Signs out and returns to the homepage. */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  redirect("/");
}
