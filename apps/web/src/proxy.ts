import { NextResponse } from "next/server";
import { isAdminPreviewEnabled } from "@/lib/admin-preview";

/**
 * Admin pages have no sign-in until M8. Outside the preview they answer 404 here, before any
 * layout, page or metadata renders, for HTML and RSC requests alike.
 */
export function proxy(): NextResponse {
  if (!isAdminPreviewEnabled()) return new NextResponse(null, { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: ["/admin", "/admin/:path*"] };
