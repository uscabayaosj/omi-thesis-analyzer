import type { Conversation } from "./conversation-types";
import { getStore } from "./kv";
import { ensureCaptureSchemaOnce, getConversationRow } from "./capture/store";

/**
 * The one way to load a conversation by id: TRACE's own store, which holds
 * both captured conversations and the Omi history imported on 2026-09-05.
 */

const iso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

export async function loadConversation(id: string): Promise<Conversation> {
  const sql = getStore();
  if (!sql) throw new Error("store not configured");
  await ensureCaptureSchemaOnce(sql);
  const r = await getConversationRow(sql, id);
  if (!r) throw new Error("conversation not found in TRACE");
  return {
    id: r.id,
    created_at: iso(r.created_at) ?? "",
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    source: r.source,
    structured: (r.structured as Conversation["structured"]) ?? undefined,
    transcript_segments: r.transcript_segments as Conversation["transcript_segments"],
    geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
  };
}
