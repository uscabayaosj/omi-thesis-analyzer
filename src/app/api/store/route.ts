import { NextRequest, NextResponse } from "next/server";
import {
  getStore, ensureSchema, withTimeout, getNamespaceData, putNamespaceData,
  SYNCED_NAMESPACES, isSyncedNamespace, isArrayNamespace,
} from "@/lib/kv";
import { mergeNamespaceValue } from "@/lib/merge";

/**
 * Durable mirror of the browser's client-side stores.
 *
 * No auth: this app is single-user by construction and has none. That is only
 * defensible because the writable surface is exactly the known namespaces in
 * SYNCED_NAMESPACES (never arbitrary keys) and nothing here is a secret — it
 * is the user's own data, already sitting unencrypted in their localStorage.
 *
 * Note that surface is no longer only analyses: the people namespaces carry
 * names, photos, and GPS coordinates of third parties the user has met. That
 * raises the cost of exposure without changing the argument, which rests on
 * there being exactly one user. If this app ever gains a second user, this
 * route needs auth before anything else does.
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
    const rows = (await withTimeout(sql`
      SELECT namespace, data FROM trace_store
      WHERE namespace = ANY(${SYNCED_NAMESPACES as unknown as string[]})
    `)) as { namespace: string; data: unknown }[];

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

// PUT /api/store → merge the client's map into one namespace.
//
// This used to replace the row wholesale, trusting that the client had
// already merged. Every pull does merge per record — but that only protects
// the client's copy. A device whose localStorage was empty or corrupt (a new
// browser, cleared site data) that wrote before its first pull landed pushed a
// one-record map and the server lost everything else. The row is now merged
// with the same rules the client uses (mergeNamespaceValue): a PUT can only
// add or update records, and a removal has to arrive as a tombstone.
//
// The read-then-write is not transactional. Two devices pushing the same
// namespace within the same moment can still lose one push's changes until
// that device's next write; localStorage holds the write either way.
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
    const existing = await getNamespaceData(sql, namespace);
    const merged = mergeNamespaceValue(namespace, isArrayNamespace(namespace), map, existing);
    await putNamespaceData(sql, namespace, merged);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("store PUT failed:", err);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
