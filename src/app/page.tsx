import { getProfile } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * The public homepage. Deliberately unstyled for now — this stage exists to
 * prove the app can reach the database, not to look like anything.
 *
 * Note what is NOT happening here: nobody is logged in. This page reads the
 * organization as an anonymous visitor, which works only because the
 * `organizations_select_anon` policy allows it and the column grants expose
 * exactly these fields. If either were missing, this would return nothing.
 */
export default async function Home() {
  const supabase = await createSupabaseServerClient();

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("name, phone, address")
    .limit(1)
    .maybeSingle();

  // TEMPORARY — proves /lib/auth runs. Remove once the staff area exists.
  const profile = await getProfile();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      {error ? (
        <p className="text-red-600">Database error: {error.message}</p>
      ) : organization ? (
        <>
          <h1 className="text-3xl font-semibold">{organization.name}</h1>
          {organization.phone && <p>{organization.phone}</p>}
          {organization.address && <p>{organization.address}</p>}
        </>
      ) : (
        <p className="text-red-600">
          Connected, but no organization was returned. Check the row exists and
          is not soft-deleted.
        </p>
      )}

      {/* TEMPORARY — remove once the staff area exists. */}
      <p className="mt-8 text-sm text-zinc-500">
        {profile
          ? `Signed in as ${profile.full_name} — ${profile.role.display_name}`
          : "Not signed in"}
      </p>
    </div>
  );
}
