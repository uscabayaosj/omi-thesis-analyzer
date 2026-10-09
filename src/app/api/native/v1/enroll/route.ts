import { NextRequest, NextResponse } from "next/server";
import {
  enrollNativeDevice,
  NativeWorkspaceEnrollmentLimitError,
  hashNativeToken,
  isNativeEnrollmentAuthorized,
  isNativeTokenFormatValid,
} from "@/lib/native-auth";

const noStore = { "Cache-Control": "no-store" };
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const enrollmentSecret = process.env.TRACE_NATIVE_ENROLLMENT_SECRET;
  if (!enrollmentSecret || Buffer.byteLength(enrollmentSecret, "utf8") < 32) {
    return NextResponse.json({ error: "Native enrollment is not configured." }, { status: 503, headers: noStore });
  }
  if (!isNativeEnrollmentAuthorized(request, enrollmentSecret)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: noStore });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > 8_192) {
    return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: noStore });
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 8_192) {
      return NextResponse.json({ error: "Request is too large." }, { status: 413, headers: noStore });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400, headers: noStore });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Expected an enrollment object." }, { status: 400, headers: noStore });
  }
  const value = body as { installationId?: unknown; token?: unknown; label?: unknown };
  const installationId = typeof value.installationId === "string" ? value.installationId.toLowerCase() : "";
  const token = typeof value.token === "string" ? value.token : "";
  const label = typeof value.label === "string" ? value.label.trim().slice(0, 64) : "";
  if (!uuidPattern.test(installationId) || !isNativeTokenFormatValid(token) || !label) {
    return NextResponse.json(
      { error: "Expected installationId, a 32-byte base64url token, and a short label." },
      { status: 400, headers: noStore }
    );
  }

  try {
    const device = await enrollNativeDevice({ installationId, label, tokenHash: hashNativeToken(token) });
    return NextResponse.json(
      { ok: true, device: { installationId: device.installation_id, label: device.label, createdAt: device.created_at } },
      { headers: noStore }
    );
  } catch (error) {
    if (error instanceof NativeWorkspaceEnrollmentLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: noStore });
    }
    console.error("native enrollment failed:", error);
    return NextResponse.json(
      { error: "Native enrollment could not be completed." },
      { status: 503, headers: noStore }
    );
  }
}
