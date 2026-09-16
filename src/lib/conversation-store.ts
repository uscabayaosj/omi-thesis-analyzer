import { withTimeout, type Sql } from "./kv";

export interface ConversationRow {
  id: string;
  source: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  transcript_segments: unknown;
  structured: unknown;
  geolocation: unknown;
  session_id: string | null;
  word_count: number;
  audio_refs: unknown;
  unmatched_speakers: unknown;
}

async function ensureConversationsSchema(sql: Sql): Promise<void> {
  await withTimeout(
    sql`CREATE TABLE IF NOT EXISTS conversations (
      id                  TEXT PRIMARY KEY,
      source              TEXT NOT NULL,
      created_at          TIMESTAMPTZ NOT NULL,
      started_at          TIMESTAMPTZ,
      finished_at         TIMESTAMPTZ,
      transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
      structured          JSONB,
      geolocation         JSONB,
      session_id          UUID,
      word_count          INT NOT NULL DEFAULT 0,
      audio_refs          JSONB,
      inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
      unmatched_speakers  JSONB
    )`,
    20_000
  );
}

let ready: Promise<void> | null = null;
export async function ensureConversationsSchemaOnce(sql: Sql): Promise<void> {
  if (!ready) ready = ensureConversationsSchema(sql);
  try {
    await ready;
  } catch (e) {
    ready = null;
    throw e;
  }
}

export type ConversationLite = Omit<ConversationRow, "transcript_segments">;

export async function listConversationsLite(sql: Sql, limit = 200): Promise<ConversationLite[]> {
  return (await withTimeout(sql`
    SELECT id, source, created_at, started_at, finished_at, structured, geolocation, session_id, word_count, audio_refs, unmatched_speakers
    FROM conversations ORDER BY created_at DESC LIMIT ${limit}`)) as ConversationLite[];
}

export async function listConversationsLiteBetween(
  sql: Sql,
  fromIso: string,
  toIso: string,
  limit = 2000
): Promise<ConversationLite[]> {
  return (await withTimeout(sql`
    SELECT id, source, created_at, started_at, finished_at, structured, geolocation, session_id, word_count, audio_refs, unmatched_speakers
    FROM conversations WHERE created_at >= ${fromIso} AND created_at < ${toIso}
    ORDER BY created_at DESC LIMIT ${limit}`)) as ConversationLite[];
}

export async function getConversationRow(sql: Sql, id: string): Promise<ConversationRow | null> {
  const rows = (await withTimeout(sql`SELECT * FROM conversations WHERE id = ${id}`)) as ConversationRow[];
  return rows[0] ?? null;
}

export async function deleteConversations(sql: Sql, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = (await withTimeout(
    sql`DELETE FROM conversations WHERE id = ANY(${ids}) RETURNING id`
  )) as { id: string }[];
  return rows.length;
}
