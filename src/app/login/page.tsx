import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getProfile } from "@/lib/auth";

import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Staff sign in",
  // Staff sign-in should never appear in Google results.
  robots: { index: false, follow: false },
};

/**
 * The staff sign-in page.
 *
 * There is no sign-up link and there never will be. Staff accounts are
 * created by an owner, not self-served.
 */
export default async function LoginPage() {
  // Already signed in? Nothing to do here.
  if (await getProfile()) redirect("/");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-2xl font-semibold">Staff sign in</h1>
      <LoginForm />
    </div>
  );
}
