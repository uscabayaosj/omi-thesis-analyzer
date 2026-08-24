import { NextResponse } from "next/server";
import { getStore, getNamespaceData, SYNCED_NAMESPACES } from "@/lib/kv";

// GET /api/export → every synced namespace, bundled for a one-shot backup
// download. Read-only — this route never writes anything.
export async function GET() {
  const sql = getStore();
  if (!sql) {
    return NextResponse.json({ configured: false });
  }

  try {
    const entries = await Promise.all(
      SYNCED_NAMESPACES.map(async (ns) => [ns, await getNamespaceData(sql, ns)] as const)
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
    return NextResponse.json({ configured: false });
  }
}
