import { getConversation as getOmiConversation, type Conversation } from "./omi-api";
import { getStore } from "./kv";
import { ensureCaptureSchemaOnce, getConversationRow } from "./capture/store";

/**
 * The one way to load a conversation by id. TRACE's own store is checked
 * first (captured and imported conversations); the Omi API is only consulted
 * while OMI_API_KEY remains, for history not yet imported. Every analysis
 * route goes through here so a TRACE-captured id is never looked up on Omi.
 */

const iso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

export async function loadConversation(id: string): Promise<Conversation> {
  const sql = getStore();
  if (sql) {
    await ensureCaptureSchemaOnce(sql);
    const r = await getConversationRow(sql, id);
    if (r) {
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
  }
  if (!process.env.OMI_API_KEY) throw new Error("conversation not found in TRACE");
  return getOmiConversation(id);
}
