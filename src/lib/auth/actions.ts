"use server";

import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";

import { absoluteUrl } from "@/lib/site/url";
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

  // Straight to the staff area, not the homepage. Somebody signing in has
  // already said where they are going — landing them on the shopfront makes
  // them find the footer link and click it a second time.
  //
  // Outside the try/catch of a return value: redirect() works by throwing,
  // so it must be the last thing that happens.
  redirect("/staff");
}

export type ResetState = { error: string | null; sent: boolean };

/**
 * Ask for a password reset link.
 *
 * THE ANSWER IS ALWAYS THE SAME, whether or not that address has an account.
 * Same reasoning as the vague sign-in error above: a form that says "no
 * account with that email" is a way to find out who works here, one guess at
 * a time. So a typo gets the same reassuring sentence as a real address, and
 * the cost of that is a person waiting for an email that will not come. Worth
 * it — the alternative leaks the staff list to anybody who asks.
 *
 * `redirectTo` is where Supabase sends them after they click. It goes through
 * `absoluteUrl()`, so it is localhost in development and the real domain once
 * NEXT_PUBLIC_SITE_URL is set — no hardcoded address to forget about on the
 * day the site goes live.
 *
 * **This needs one setting in the Supabase dashboard**: the URL below must be
 * on the redirect allow-list, or the emailed link lands on an error page
 * instead. Authentication → URL Configuration → Redirect URLs.
 */
export async function requestPasswordReset(
  _previous: ResetState,
  formData: FormData,
): Promise<ResetState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) return { error: "Enter your email address.", sent: false };

  const supabase = await createSupabaseServerClient();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: absoluteUrl("/auth/confirm?next=/reset"),
  });

  /* The result is deliberately not read. Supabase reports an unknown address
     as an error, and passing that through is the leak this function exists to
     avoid. Rate limiting is Supabase's, in auth.rate_limit. */
  return { error: null, sent: true };
}

export type NewPasswordState = { error: string | null };

/**
 * Set a new password for whoever is signed in.
 *
 * Reached two ways, and both are legitimate: from a recovery link, where the
 * session was minted by the email; or by somebody already signed in who wants
 * to change it. There is deliberately no "current password" field — arriving
 * here already proves possession of either the mailbox or a live session, and
 * asking again would only stop the case where somebody walked away from an
 * unlocked screen, which a password box does not fix.
 *
 * Eight characters is Supabase's own floor. Stating it here means the person
 * reads it in the form rather than as a raised API error.
 */
export async function setNewPassword(
  _previous: NewPasswordState,
  formData: FormData,
): Promise<NewPasswordState> {
  const password = String(formData.get("password") ?? "");
  const again = String(formData.get("again") ?? "");

  if (password.length < 8) {
    return { error: "Use at least eight characters." };
  }

  if (password !== again) {
    return { error: "Those two do not match." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return {
      error:
        "That could not be saved. The link may have expired — ask for a new one.",
    };
  }

  redirect("/staff");
}

/**
 * Turn a link from an email into a signed-in session.
 *
 * Called by the route handler at /auth/confirm, which is deliberately thin:
 * DECISIONS #6 says `supabase.auth` is not touched outside this folder, and a
 * route handler is no exception.
 *
 * TWO SHAPES, because which one arrives depends on a template we do not
 * control. Supabase's default recovery email sends the reader through its own
 * verify endpoint, which lands here with `?code=`. A project whose template
 * has been changed to use `{{ .TokenHash }}` lands here with `?token_hash=`
 * and `?type=` instead. Handling both means the feature does not quietly stop
 * working the day somebody edits an email template.
 */
export async function confirmRecovery(params: {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
}): Promise<boolean> {
  const supabase = await createSupabaseServerClient();

  if (params.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(params.code);

    return !error;
  }

  if (params.tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: (params.type as EmailOtpType) ?? "recovery",
      token_hash: params.tokenHash,
    });

    return !error;
  }

  return false;
}

/** Signs out and returns to the homepage — the right place once you are out. */
export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();

  redirect("/");
}
