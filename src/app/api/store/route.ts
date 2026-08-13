import { NextRequest, NextResponse } from "next/server";
import { getStore, SYNCED_NAMESPACES, isSyncedNamespace } from "@/lib/kv";

/**
 * Durable mirror of the browser's analysis stores.
 *
 * No auth: this app is single-user by construction and has none. That is only
 * defensible because the writable surface is exactly the four known analysis
 * namespaces (never arbitrary keys) and nothing here is a secret — it is the
 * user's own analyses, already sitting unencrypted in their localStorage. If
 * this app ever gains a second user, this route needs auth before anything
 * else does.
 */

// GET /api/store → every synced namespace, for the client to merge on load.
export async function GET() {
  const store = getStore();
  if (!store) {
    // Not provisioned. A 200 with configured:false lets the client stay on
    // localStorage silently rather than surfacing an error for a feature the
    // user may simply not have turned on.
    return NextResponse.json({ configured: false, data: {} });
  }
  try {
    const values = await store.mget<Record<string, unknown>[]>(...SYNCED_NAMESPACES);
    const data: Record<string, unknown> = {};
    SYNCED_NAMESPACES.forEach((ns, i) => {
      if (values[i]) data[ns] = values[i];
    });
    return NextResponse.json({ configured: true, data });
  } catch (err) {
    console.error("store GET failed:", err);
    return NextResponse.json({ configured: false, data: {}, error: "read failed" });
  }
}

// PUT /api/store → replace one namespace with the client's merged map.
export async function PUT(req: NextRequest) {
  const store = getStore();
  if (!store) return NextResponse.json({ configured: false });
  try {
    const { namespace, map } = await req.json();
    if (!isSyncedNamespace(namespace)) {
      return NextResponse.json({ error: "Unknown namespace." }, { status: 400 });
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      return NextResponse.json({ error: "Expected an object map." }, { status: 400 });
    }
    await store.set(namespace, map);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("store PUT failed:", err);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
