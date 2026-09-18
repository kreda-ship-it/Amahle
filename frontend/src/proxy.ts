import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/auth/session";

/**
 * Next.js runs this file before every matching request.
 *
 * It guards nothing. Deciding who may see a page is the job of the page
 * itself and of row-level security in the database. All this does is keep a
 * valid session valid.
 *
 * This was `middleware.ts` until Next.js 16, which deprecated that name in
 * favour of `proxy`. Same file, same job, different word: Vercel found that
 * "middleware" kept being read as Express middleware — something you chain
 * several of, in the middle of your application — when in fact it runs at the
 * network edge, in front of the application, and there is only ever one.
 * "Proxy" describes that honestly.
 *
 * One real consequence beyond the name: proxy runs on the Node.js runtime by
 * default, where middleware ran on the Edge runtime. Nothing here needed the
 * change, but it means the usual Edge restrictions no longer apply.
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except files that are not pages. Running a database call
     * before serving an image would be pure waste.
     *
     * Reading it in pieces: `(?! ... )` means "not followed by", so this
     * matches any path that does not begin with one of these.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
