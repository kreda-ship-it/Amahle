import { cache } from "react";
import { redirect } from "next/navigation";

import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The only place in this codebase that asks who someone is or what they may
 * do. Nothing outside this folder calls `supabase.auth`, ever.
 *
 * Every function here is wrapped in React's `cache()`, which remembers the
 * answer for the rest of a single request. Three components can each ask
 * "who is logged in?" and only one question reaches the network.
 */

/** A person who can log in, as this application understands them. */
export type Profile = {
  id: string;
  org_id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  role: {
    id: string;
    name: string;
    display_name: string;
  };
};

/**
 * The logged-in account, or null.
 *
 * Deliberately `getUser()` and never `getSession()`. `getSession()` trusts
 * the browser's cookie, and a cookie can be forged. `getUser()` checks with
 * Supabase that the session is genuine. On the server, that difference is
 * the whole point.
 */
export const getUser = cache(async () => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();

  // Logged out is reported as an error here, which is normal, not a fault.
  if (error) return null;

  return data.user ?? null;
});

/**
 * Who the logged-in person is *within their organization* — their name,
 * their org, and their role.
 *
 * Returns null when logged out, and also when logged in without a profile.
 * That second case is a real state: an auth account can exist before anyone
 * has been given a place in a salon. Treat it exactly like logged out.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, org_id, user_id, full_name, email, phone, is_active, role:roles(id, name, display_name)",
    )
    .eq("user_id", user.id)
    .eq("is_active", true)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) return null;

  return data;
});

/**
 * May the logged-in person do this one thing?
 *
 * This function decides nothing. It asks `has_permission()` in the database —
 * the same function the row-level security policies call. So the page and
 * the database can never disagree about who may do what.
 *
 * Hiding a button based on this is a courtesy to the user. The database is
 * what actually refuses.
 *
 * Any failure returns false. When the answer is unclear, the answer is no.
 */
export const can = cache(async (permissionKey: string): Promise<boolean> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("has_permission", {
    p_key: permissionKey,
  });

  if (error) return false;

  return data === true;
});

/**
 * For pages only a logged-in member of a salon may see.
 *
 * Returns the profile, or sends the visitor to the login page and stops
 * rendering. `redirect()` throws internally, so nothing after this line runs
 * when there is no profile — which is why the return type has no null in it.
 */
export const requireProfile = cache(async (): Promise<Profile> => {
  const profile = await getProfile();

  if (!profile) redirect("/login");

  return profile;
});

/**
 * For pages that need a specific permission, not merely a login.
 *
 * Someone logged in but lacking the permission is sent to the dashboard
 * rather than the login page — they are not anonymous, they are simply not
 * allowed here, and bouncing them to a login form would be confusing.
 */
export const requirePermission = cache(
  async (permissionKey: string): Promise<Profile> => {
    const profile = await requireProfile();

    if (!(await can(permissionKey))) redirect("/");

    return profile;
  },
);

/**
 * The logged-in person's employee record, if they have one.
 *
 * A profile can log in; an employee performs services. They usually point at
 * each other and the cases where they do not are the ones that matter — an
 * owner who never touches hair has a profile and no employee row, and a
 * stylist who does not use the system has an employee row and no profile.
 *
 * Screens need this to answer "is any of what I am looking at MINE", which
 * since migration 042 is a real question: a stylist holds no appointment
 * permission and may still mark her own customer as arrived.
 *
 * Asks the database rather than trusting anything from the browser, and goes
 * through `current_employee_id()` — the same function the row-level security
 * policies call — so a screen and a policy can never disagree about who
 * somebody is.
 */
export const currentEmployeeId = cache(async (): Promise<string | null> => {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("current_employee_id");

  if (error) return null;

  return data ?? null;
});
