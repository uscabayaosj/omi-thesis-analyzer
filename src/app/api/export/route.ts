import { NextResponse } from "next/server";
import { getStore, getNamespaceData, ensureSchema, toCanonicalShape, SYNCED_NAMESPACES } from "@/lib/kv";

// GET /api/export → every synced namespace, bundled for a one-shot backup
// download. Read-only — this route never writes anything.
export async function GET() {
  const sql = getStore();
  if (!sql) {
    // Deliberately no `error` field here: fetchJson (src/lib/fetch-json.ts)
    // throws whenever a response body carries a truthy `error` key, so
    // adding one would turn every legitimate local-fallback into a red
    // error with no download. (Contrast /api/store GET's degrade path,
    // which DOES include `error: "read failed"` — don't copy that here.)
    return NextResponse.json({ configured: false });
  }

  try {
    await ensureSchema(sql);
    const entries = await Promise.all(
      SYNCED_NAMESPACES.map(
        async (ns) => [ns, toCanonicalShape(ns, await getNamespaceData(sql, ns))] as const
      )
    );
    const namespaces = Object.fromEntries(entries);

    return NextResponse.json({
      configured: true,
      exportedAt: new Date().toISOString(),
      namespaces,
    });
  } catch (err) {
    console.error("export failed:", err);
    // Degrade rather than error — a broken store should cost the server-side
    // backup source, not surface a 500 for what's ultimately an optional
    // convenience (the client falls back to localStorage on configured:false).
    // No `error` field here either, for the same fetchJson reason as above.
    return NextResponse.json({ configured: false });
  }
}
