import { NextResponse } from "next/server";
import { getStore } from "@/lib/kv";
import { importOmiHistory } from "@/lib/capture/omi-import";
import { ensureCaptureSchemaOnce, upsertConversations } from "@/lib/capture/store";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

/**
 * One-time, idempotent backfill of Omi history into TRACE's own store.
 * Unauthenticated like the app's other mutating routes (single-user posture,
 * see api/store/route.ts): it only reads the user's Omi data and upserts.
 */
export async function POST() {
  const sql = getStore();
  if (!sql) return NextResponse.json({ error: "Store not configured" }, { status: 503 });
  try {
    await ensureCaptureSchemaOnce(sql);
    const r = await importOmiHistory((rows) => upsertConversations(sql, rows));
    return NextResponse.json(r);
  } catch (err) {
    console.error("omi import failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
