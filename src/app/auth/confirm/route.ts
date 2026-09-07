import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { confirmRecovery } from "@/lib/auth/actions";

/**
 * Where a link from an email lands.
 *
 * DELIBERATELY THIN. All it does is read the query string, hand it to
 * `/lib/auth`, and send the reader on. Nothing here calls `supabase.auth` —
 * DECISIONS #6 keeps every one of those inside one folder, and a route handler
 * is not an exception to that just because it is not a page.
 *
 * `next` says where to go once the session exists, and is checked before use:
 * an open redirect on an authentication route is how somebody gets sent to a
 * convincing copy of this site with a real session in hand. Only paths inside
 * this site are accepted, and only ones starting with a single slash — `//evil`
 * is a protocol-relative URL and would leave the site.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const requested = params.get("next") ?? "/reset";
  const next =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : "/reset";

  const ok = await confirmRecovery({
    code: params.get("code"),
    tokenHash: params.get("token_hash"),
    type: params.get("type"),
  });

  /* A link that has expired or been used already is the ordinary case, not a
     fault — they sit in inboxes for days. Send them back to ask for another
     rather than showing an error page with nothing to do on it. */
  redirect(ok ? next : "/reset?expired=1");
}
