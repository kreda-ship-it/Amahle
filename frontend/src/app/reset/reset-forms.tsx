"use client";

import { useActionState } from "react";

import {
  requestPasswordReset,
  setNewPassword,
  type NewPasswordState,
  type ResetState,
} from "@/lib/auth/actions";

/**
 * The two halves of forgetting a password.
 *
 * Both live here rather than in a file each, because they are one flow and
 * the page decides which of them you are looking at. Styled to match the sign
 * in form beside them — that form does not use the app's design tokens and
 * this is not the change that should fix it.
 */

const FIELD =
  "rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900";

const BUTTON =
  "rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900";

/** Step one: say who you are, and get a link. */
export function RequestForm({ expired }: { expired: boolean }) {
  const [state, formAction, pending] = useActionState<ResetState, FormData>(
    requestPasswordReset,
    { error: null, sent: false },
  );

  if (state.sent) {
    return (
      <div className="flex w-full max-w-sm flex-col gap-3">
        <p className="text-sm">
          If that address has an account, a link is on its way. It is good for
          one hour.
        </p>
        <p className="text-sm text-zinc-500">
          Nothing arrived? Check the junk folder, then ask the salon owner —
          they can see who has an account.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      {expired && (
        <p role="alert" className="text-sm text-red-600">
          That link has expired or been used already. Ask for a new one.
        </p>
      )}

      <label className="flex flex-col gap-1 text-left">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          className={FIELD}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Sending…" : "Send me a link"}
      </button>
    </form>
  );
}

/** Step two: you clicked the link, so choose a new one. */
export function SetPasswordForm() {
  const [state, formAction, pending] = useActionState<
    NewPasswordState,
    FormData
  >(setNewPassword, { error: null });

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1 text-left">
        <span className="text-sm font-medium">New password</span>
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={FIELD}
        />
        <span className="text-xs text-zinc-500">At least eight characters.</span>
      </label>

      <label className="flex flex-col gap-1 text-left">
        <span className="text-sm font-medium">Again</span>
        <input
          type="password"
          name="again"
          autoComplete="new-password"
          required
          minLength={8}
          className={FIELD}
        />
      </label>

      {state.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? "Saving…" : "Save it and sign in"}
      </button>
    </form>
  );
}
