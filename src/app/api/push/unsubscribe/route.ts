import { NextRequest, NextResponse } from "next/server";
import { removeSubscription } from "@/lib/push-store";

// POST /api/push/unsubscribe → drop a stored subscription. Always ok:true
// (idempotent) even if no row matched, so the client doesn't need to
// distinguish "already unsubscribed" from "just unsubscribed".
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }

  const b = body as { endpoint?: unknown };
  if (typeof b.endpoint !== "string" || !b.endpoint) {
    return NextResponse.json({ error: "Expected { endpoint }." }, { status: 400 });
  }

  try {
    await removeSubscription(b.endpoint);
  } catch (err) {
    console.error("push unsubscribe failed:", err);
    // Still report ok:true — client-side unsubscribe already happened;
    // a stuck server-side row just means one stale future push attempt,
    // which self-heals on its next 404/410.
  }
  return NextResponse.json({ ok: true });
}
