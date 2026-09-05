import { NextResponse } from "next/server";
import type { Conversation } from "@/lib/conversation-types";
import { getStore } from "@/lib/kv";
import { ensureCaptureSchemaOnce, listConversationsLite } from "@/lib/capture/store";
import { friendlyError } from "@/lib/api-error";

const iso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

/** The newest conversations from TRACE's own store, without transcripts. */
export async function GET() {
  try {
    const sql = getStore();
    if (!sql) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
    await ensureCaptureSchemaOnce(sql);
    const list: Conversation[] = (await listConversationsLite(sql, 200)).map((r) => ({
      id: r.id,
      created_at: iso(r.created_at) ?? "",
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
      source: r.source,
      structured: (r.structured as Conversation["structured"]) ?? undefined,
      geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
    }));
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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
