import { NextRequest, NextResponse } from "next/server";
import { getStore, ensureSchema, SYNCED_NAMESPACES, isSyncedNamespace } from "@/lib/kv";

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
  const sql = getStore();
  if (!sql) {
    // Not provisioned. A 200 with configured:false lets the client stay on
    // localStorage silently rather than surfacing an error for a feature the
    // user may simply not have turned on.
    return NextResponse.json({ configured: false, data: {} });
  }
  try {
    await ensureSchema(sql);
    const rows = (await sql`
      SELECT namespace, data FROM trace_store
      WHERE namespace = ANY(${SYNCED_NAMESPACES as unknown as string[]})
    `) as { namespace: string; data: unknown }[];

    const data: Record<string, unknown> = {};
    for (const row of rows) data[row.namespace] = row.data;
    return NextResponse.json({ configured: true, data });
  } catch (err) {
    console.error("store GET failed:", err);
    // Degrade to "not configured" rather than erroring: a store that is down
    // should cost the user cross-device sync, not the ability to use the app.
    return NextResponse.json({ configured: false, data: {}, error: "read failed" });
  }
}

// PUT /api/store → replace one namespace with the client's merged map.
export async function PUT(req: NextRequest) {
  const sql = getStore();
  if (!sql) return NextResponse.json({ configured: false });
  try {
    const { namespace, map } = await req.json();
    if (!isSyncedNamespace(namespace)) {
      return NextResponse.json({ error: "Unknown namespace." }, { status: 400 });
    }
    if (!map || typeof map !== "object" || Array.isArray(map)) {
      return NextResponse.json({ error: "Expected an object map." }, { status: 400 });
    }
    await ensureSchema(sql);
    // The client sends an already-merged map, so last writer wins per
    // namespace by design — the per-record reconciliation happens there.
    await sql`
      INSERT INTO trace_store (namespace, data, updated_at)
      VALUES (${namespace}, ${JSON.stringify(map)}::jsonb, now())
      ON CONFLICT (namespace)
      DO UPDATE SET data = EXCLUDED.data, updated_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("store PUT failed:", err);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
