import { NextResponse } from "next/server";
import { getConversations, type Conversation } from "@/lib/omi-api";
import { getStore } from "@/lib/kv";
import { ensureCaptureSchemaOnce, listConversationsLite } from "@/lib/capture/store";
import { friendlyError } from "@/lib/api-error";

/**
 * TRACE's own store is the primary source; the Omi API is consulted only while
 * OMI_API_KEY is still set (the transition period before the Omi app is
 * retired). Neon wins on id collisions — after the one-time import both sides
 * hold the same conversations, and Neon's copy is the one TRACE owns.
 */
export async function GET() {
  try {
    const byId = new Map<string, Conversation>();
    const sql = getStore();
    if (sql) {
      await ensureCaptureSchemaOnce(sql);
      for (const r of await listConversationsLite(sql, 200)) {
        byId.set(r.id, {
          id: r.id,
          created_at: r.created_at,
          started_at: r.started_at ?? undefined,
          finished_at: r.finished_at ?? undefined,
          source: r.source,
          structured: (r.structured as Conversation["structured"]) ?? undefined,
          geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
        });
      }
    }
    if (process.env.OMI_API_KEY) {
      try {
        for (const c of await getConversations(50)) if (!byId.has(c.id)) byId.set(c.id, c);
      } catch (err) {
        // Omi being down must not blank a list TRACE can serve itself.
        if (byId.size === 0) throw err;
        console.error("omi list failed; serving Neon only:", err);
      }
    }
    const list = Array.from(byId.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return NextResponse.json(list, {
      headers: {
        // Per-user data: let the browser reuse a recent list and revalidate
        // in the background rather than re-invoking the function each visit.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("conversations fetch failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
