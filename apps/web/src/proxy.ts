import { NextResponse, type NextRequest } from "next/server";

import { isAdminPreviewEnabled } from "@/lib/admin-preview";
import { isLocalMode, isLoopbackHost, isPathOff } from "@/lib/local-mode";

/**
 * Pages that are switched off answer here, before any layout, page, action or metadata runs,
 * for HTML and RSC requests alike.
 *
 * - Admin pages have no sign-in, so outside the preview they are a 404.
 * - The desktop app (ADR-0036) answers only requests addressed to this computer by name: a
 *   profile opens without a password, so a web page must not be able to pose as Eddy's own
 *   origin by pointing a domain name at 127.0.0.1.
 * - In the desktop app the online-only pages (email sign-in, invites, a parent's account) send
 *   a visitor to the start, and anything else sent to them is a 404. Everywhere else the
 *   profile pages are a 404.
 */
export function proxy(request: NextRequest): NextResponse {
  const local = isLocalMode();
  if (local && !isLoopbackHost(request.headers.get("host"))) {
    return new NextResponse(null, { status: 400 });
  }
  const path = request.nextUrl.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) {
    if (!isAdminPreviewEnabled()) return new NextResponse(null, { status: 404 });
    return NextResponse.next();
  }
  if (isPathOff(path, local)) {
    if (local && request.method === "GET" && !path.startsWith("/api/")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.next();
}

// Every page, action and route handler, so the desktop app's host check covers them all. Only
// the built static files are left out: they hold nothing about anyone.
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
