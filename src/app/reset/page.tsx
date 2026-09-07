import type { Metadata } from "next";

import { getUser } from "@/lib/auth";

import { RequestForm, SetPasswordForm } from "./reset-forms";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

/* Never cached. Which form belongs here depends on whether a session exists
   this second, and a cached answer would show a stranger the "choose a new
   password" form. */
export const dynamic = "force-dynamic";

/**
 * One route, two steps, and the session decides which.
 *
 * Arriving with no session means you are asking for a link. Arriving WITH one
 * means you clicked the link and /auth/confirm has already turned it into a
 * session — so the next thing to do is choose a password.
 *
 * One route rather than two because the second step is not reachable by
 * choice: you get there by clicking an email, and a route that exists to be
 * arrived at rather than navigated to does not need its own address. It also
 * means somebody already signed in can use this to change their password,
 * which is a real need and would otherwise want a screen of its own.
 */
export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const user = await getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold">
        {user ? "Choose a new password" : "Reset your password"}
      </h1>

      {user ? (
        <SetPasswordForm />
      ) : (
        <RequestForm expired={params.expired === "1"} />
      )}
    </div>
  );
}
