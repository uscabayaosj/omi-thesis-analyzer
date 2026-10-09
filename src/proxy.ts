import { NextResponse, type NextRequest } from "next/server";

/** Dedicated iPhone backends must not expose the shared PWA's browser APIs.
 * Native route handlers retain their own device/cron authorization checks.
 */
export function proxy(request: NextRequest) {
  if (process.env.TRACE_NATIVE_API_ONLY === "1" &&
      !request.nextUrl.pathname.startsWith("/api/native/v1/")) {
    return NextResponse.json({ error: "Not found." }, {
      status: 404, headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
