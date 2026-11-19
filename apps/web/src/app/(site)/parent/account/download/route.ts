import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { apiClientFor } from "@/lib/api";

/** A parent's own data as a JSON file, built on request and never stored (ADR-0034). */
export async function GET() {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || user.role !== "parent") {
    return new NextResponse("Sign in first.", { status: 401 });
  }
  const api = await apiClientFor({ subject: user.id, role: "parent" });
  const { data } = await api.GET("/v1/parent/export");
  if (!data) {
    return new NextResponse("Your data could not be prepared. Try again.", { status: 503 });
  }
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="eddy-my-data.json"',
      "Cache-Control": "no-store",
    },
  });
}
