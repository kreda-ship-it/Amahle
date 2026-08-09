import type { Metadata } from "next";

import { can, requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";

export const metadata: Metadata = {
  title: "Staff area",
  robots: { index: false, follow: false },
};

/**
 * The first page the database actually guards.
 *
 * Every permission key the catalogue currently holds. More arrive with the
 * tables they belong to — appointments, customers, services.
 */
const PERMISSION_KEYS = [
  "employee.manage",
  "organization.edit",
  "role.manage",
] as const;

export default async function StaffPage() {
  // Not signed in? This never returns — it redirects to /login.
  const profile = await requireProfile();

  // Asked in parallel rather than one after another. Each is a round trip to
  // the database, and they do not depend on each other.
  const answers = await Promise.all(
    PERMISSION_KEYS.map(async (key) => [key, await can(key)] as const),
  );

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{profile.full_name}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {profile.role.display_name}
        </p>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-zinc-500">
          Permissions
        </h2>
        <ul className="flex flex-col gap-1">
          {answers.map(([key, allowed]) => (
            <li key={key} className="flex justify-between border-b py-1">
              <code className="text-sm">{key}</code>
              <span className={allowed ? "text-green-600" : "text-zinc-400"}>
                {allowed ? "yes" : "no"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          Answered by the database, not by this page.
        </p>
      </div>

      {/*
        A plain form calling a server action. No client component, no
        JavaScript required — sign-out works even if scripts fail to load.
      */}
      <form action={signOut}>
        <button
          type="submit"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
