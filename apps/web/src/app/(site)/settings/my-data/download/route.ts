import { NextResponse } from "next/server";

import { currentStudent, studentApi } from "@/lib/session";

/** Download my data as a JSON file (SPEC.md section 4.5). Built on request, never stored. */
export async function GET() {
  const current = await currentStudent();
  if (!current) return new NextResponse("Sign in first.", { status: 401 });
  const api = await studentApi(current.user);
  const { data, response } = await api.GET("/v1/me/export", {
    params: { query: { download: true } },
  });
  if (response.status === 429)
    return new NextResponse("You have downloaded your data a lot this hour. Try later.", {
      status: 429,
    });
  if (!data)
    return new NextResponse("Your data could not be prepared. Try again.", { status: 503 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="eddy-my-data.json"',
      "Cache-Control": "no-store",
    },
  });
}
