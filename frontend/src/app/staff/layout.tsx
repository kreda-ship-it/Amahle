import { requireProfile } from "@/lib/auth";
import { signOut } from "@/lib/auth/actions";
import { getOrganization } from "@/lib/site/organization";

import { navFor } from "./nav";
import { StaffShell } from "./staff-shell";

/**
 * The staff area's frame.
 *
 * Deliberately light, while the public site is dark. The shopfront is trying
 * to look expensive; this is a tool somebody stares at for eight hours, and
 * the palette in globals.css keeps them apart — the dark values live on a
 * class the public layout wears and this one does not.
 *
 * Signing in is checked here rather than on each page, so a new screen cannot
 * be added without it.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const [navigation, org] = await Promise.all([navFor(), getOrganization()]);

  return (
    <StaffShell
      navigation={navigation}
      fullName={profile.full_name}
      roleName={profile.role.display_name}
      salonName={org.name}
      signOutAction={signOut}
    >
      {children}
    </StaffShell>
  );
}
