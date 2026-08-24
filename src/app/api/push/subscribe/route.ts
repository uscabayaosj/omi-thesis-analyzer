import { NextRequest, NextResponse } from "next/server";
import { addSubscription } from "@/lib/push-store";
import { isStoreConfigured } from "@/lib/kv";

// POST /api/push/subscribe → store a browser's push subscription.
export async function POST(req: NextRequest) {
  if (!isStoreConfigured()) {
    return NextResponse.json({ configured: false });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "The request could not be read." }, { status: 400 });
  }

  const b = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (
    typeof b.endpoint !== "string" ||
    !b.endpoint ||
    !b.keys ||
    typeof b.keys.p256dh !== "string" ||
    !b.keys.p256dh ||
    typeof b.keys.auth !== "string" ||
    !b.keys.auth
  ) {
    return NextResponse.json(
      { error: "Expected { endpoint, keys: { p256dh, auth } }." },
      { status: 400 }
    );
  }

  try {
    await addSubscription({ endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("push subscribe failed:", err);
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }
}
