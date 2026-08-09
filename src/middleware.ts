import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/auth/middleware";

/**
 * Next.js runs this file before every matching request.
 *
 * It guards nothing. Deciding who may see a page is the job of the page
 * itself and of row-level security in the database. All this does is keep a
 * valid session valid.
 */
export async function middleware(request: NextRequest) {
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
