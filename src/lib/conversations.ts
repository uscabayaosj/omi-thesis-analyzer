import type { Conversation } from "./conversation-types";
import { getConversation as getOmiConversation } from "./omi-api";
import { getStore } from "./kv";
import { ensureConversationsSchemaOnce, getConversationRow } from "./conversation-store";
import { fixturesEnabled, fixtureConversation } from "./dev-fixtures";

const iso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

export async function loadConversation(id: string): Promise<Conversation> {
  const sql = getStore();
  if (sql) {
    await ensureConversationsSchemaOnce(sql);
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
  if (fixturesEnabled()) {
    const fx = fixtureConversation(id);
    if (fx) return fx;
  }
  if (!process.env.OMI_API_KEY) throw new Error("conversation not found");
  return getOmiConversation(id);
}
