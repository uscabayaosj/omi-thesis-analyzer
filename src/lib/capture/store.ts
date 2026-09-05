import { withTimeout, type Sql } from "../kv";
import type { AbsSpan, SessionState } from "./types";
import type { ConversationRow } from "./rows";

/**
 * Neon persistence for the capture pipeline. Modelled tables (unlike the
 * key-value trace_store) because sessions are queried by state and time.
 * Same lazy-schema posture as usage.ts.
 */

export type SessionStatus = "open" | "transcribing" | "done" | "discarded" | "failed";

export interface ChunkRow {
  id: string;
  deviceId: string;
  codec: number;
  startedAtMs: number;
  durationMs: number;
  packets: number;
  voicedMs: number;
  blobPath: string;
  bytes: number;
  levels?: { p10: number; p50: number; p90: number };
}

async function ensureCaptureSchema(sql: Sql): Promise<void> {
  await withTimeout(sql`
    CREATE TABLE IF NOT EXISTS capture_chunks (
      id           UUID PRIMARY KEY,
      device_id    TEXT NOT NULL,
      codec        SMALLINT NOT NULL,
      started_at   TIMESTAMPTZ NOT NULL,
      duration_ms  INT NOT NULL,
      packets      INT NOT NULL,
      voiced_ms    INT NOT NULL DEFAULT 0,
      blob_path    TEXT NOT NULL,
      bytes        INT NOT NULL,
      session_id   UUID,
      received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await withTimeout(sql`CREATE INDEX IF NOT EXISTS capture_chunks_started_idx ON capture_chunks (started_at)`);
  // Level percentiles per chunk (dBFS): the VAD tuning signal. Added after
  // first deploy, hence ALTER rather than a column in the CREATE.
  await withTimeout(sql`ALTER TABLE capture_chunks ADD COLUMN IF NOT EXISTS level_p10 REAL`);
  await withTimeout(sql`ALTER TABLE capture_chunks ADD COLUMN IF NOT EXISTS level_p50 REAL`);
  await withTimeout(sql`ALTER TABLE capture_chunks ADD COLUMN IF NOT EXISTS level_p90 REAL`);
  await withTimeout(sql`
    CREATE TABLE IF NOT EXISTS capture_sessions (
      id              UUID PRIMARY KEY,
      device_id       TEXT NOT NULL,
      started_at      TIMESTAMPTZ NOT NULL,
      last_speech_at  TIMESTAMPTZ NOT NULL,
      ended_at        TIMESTAMPTZ,
      status          TEXT NOT NULL,
      attempts        INT NOT NULL DEFAULT 0,
      conversation_id TEXT,
      voiced_ms       INT NOT NULL DEFAULT 0,
      spans           JSONB NOT NULL DEFAULT '[]'::jsonb,
      error           TEXT
    )`);
  await withTimeout(sql`CREATE INDEX IF NOT EXISTS capture_sessions_status_idx ON capture_sessions (status, last_speech_at)`);
  await withTimeout(sql`
    CREATE TABLE IF NOT EXISTS conversations (
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
      inserted_at         TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await withTimeout(sql`CREATE INDEX IF NOT EXISTS conversations_created_idx ON conversations (created_at DESC)`);
}

let ready: Promise<void> | null = null;
export async function ensureCaptureSchemaOnce(sql: Sql): Promise<void> {
  if (!ready) ready = ensureCaptureSchema(sql);
  try {
    await ready;
  } catch (e) {
    ready = null;
    throw e;
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const toMs = (v: unknown) => new Date(v as string).getTime();

// ── chunks ──

export async function chunkExists(sql: Sql, id: string): Promise<boolean> {
  const rows = (await withTimeout(sql`SELECT 1 FROM capture_chunks WHERE id = ${id}`)) as unknown[];
  return rows.length > 0;
}

export async function insertChunk(sql: Sql, r: ChunkRow): Promise<void> {
  await withTimeout(sql`
    INSERT INTO capture_chunks (id, device_id, codec, started_at, duration_ms, packets, voiced_ms, blob_path, bytes, level_p10, level_p50, level_p90)
    VALUES (${r.id}, ${r.deviceId}, ${r.codec}, ${iso(r.startedAtMs)}, ${r.durationMs}, ${r.packets}, ${r.voicedMs}, ${r.blobPath}, ${r.bytes},
            ${r.levels?.p10 ?? null}, ${r.levels?.p50 ?? null}, ${r.levels?.p90 ?? null})
    ON CONFLICT (id) DO NOTHING`);
}

export async function setChunkSession(sql: Sql, chunkIds: string[], sessionId: string): Promise<void> {
  if (chunkIds.length === 0) return;
  await withTimeout(sql`UPDATE capture_chunks SET session_id = ${sessionId} WHERE id = ANY(${chunkIds}::uuid[])`);
}

export async function getChunkBlobPaths(sql: Sql, chunkIds: string[]): Promise<Map<string, string>> {
  if (chunkIds.length === 0) return new Map();
  const rows = (await withTimeout(
    sql`SELECT id, blob_path FROM capture_chunks WHERE id = ANY(${chunkIds}::uuid[])`
  )) as { id: string; blob_path: string }[];
  return new Map(rows.map((r) => [r.id, r.blob_path]));
}

// ── sessions ──

type SessionRow = {
  id: string;
  device_id: string;
  started_at: string;
  last_speech_at: string;
  status: SessionStatus;
  attempts: number;
  voiced_ms: number;
  spans: AbsSpan[];
  conversation_id: string | null;
  error: string | null;
};

export type StoredSession = SessionState & { status: SessionStatus; attempts: number };

const toState = (r: SessionRow): StoredSession => ({
  id: r.id,
  deviceId: r.device_id,
  startedAtMs: toMs(r.started_at),
  lastSpeechAtMs: toMs(r.last_speech_at),
  voicedMs: r.voiced_ms,
  spans: r.spans ?? [],
  status: r.status,
  attempts: r.attempts,
});

export async function getOpenSession(sql: Sql, deviceId: string): Promise<SessionState | null> {
  const rows = (await withTimeout(sql`
    SELECT * FROM capture_sessions WHERE device_id = ${deviceId} AND status = 'open'
    ORDER BY started_at DESC LIMIT 1`)) as SessionRow[];
  return rows[0] ? toState(rows[0]) : null;
}

export async function getSession(sql: Sql, id: string): Promise<StoredSession | null> {
  const rows = (await withTimeout(sql`SELECT * FROM capture_sessions WHERE id = ${id}`)) as SessionRow[];
  return rows[0] ? toState(rows[0]) : null;
}

export async function saveOpenSession(sql: Sql, s: SessionState): Promise<void> {
  await withTimeout(sql`
    INSERT INTO capture_sessions (id, device_id, started_at, last_speech_at, status, voiced_ms, spans)
    VALUES (${s.id}, ${s.deviceId}, ${iso(s.startedAtMs)}, ${iso(s.lastSpeechAtMs)}, 'open', ${s.voicedMs}, ${JSON.stringify(s.spans)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET
      last_speech_at = EXCLUDED.last_speech_at, voiced_ms = EXCLUDED.voiced_ms, spans = EXCLUDED.spans`);
}

export async function setSessionStatus(
  sql: Sql,
  id: string,
  status: SessionStatus,
  patch: { conversationId?: string; error?: string; endedAtMs?: number; bumpAttempts?: boolean } = {},
): Promise<void> {
  await withTimeout(sql`
    UPDATE capture_sessions SET
      status = ${status},
      conversation_id = COALESCE(${patch.conversationId ?? null}, conversation_id),
      error = ${patch.error ?? null},
      ended_at = COALESCE(${patch.endedAtMs ? iso(patch.endedAtMs) : null}::timestamptz, ended_at),
      attempts = attempts + ${patch.bumpAttempts ? 1 : 0}
    WHERE id = ${id}`);
}

export async function listStaleOpen(sql: Sql, cutoffMs: number): Promise<SessionState[]> {
  const rows = (await withTimeout(sql`
    SELECT * FROM capture_sessions WHERE status = 'open' AND last_speech_at < ${iso(cutoffMs)}`)) as SessionRow[];
  return rows.map(toState);
}

export async function listRetryable(sql: Sql): Promise<string[]> {
  const rows = (await withTimeout(
    sql`SELECT id FROM capture_sessions WHERE status = 'failed' AND attempts < 3`
  )) as { id: string }[];
  return rows.map((r) => r.id);
}

// ── conversations ──

export async function upsertConversations(sql: Sql, rows: ConversationRow[]): Promise<void> {
  for (const r of rows) {
    await withTimeout(sql`
      INSERT INTO conversations (id, source, created_at, started_at, finished_at, transcript_segments, structured, geolocation, session_id, word_count, audio_refs)
      VALUES (${r.id}, ${r.source}, ${r.created_at}, ${r.started_at}, ${r.finished_at},
              ${JSON.stringify(r.transcript_segments)}::jsonb,
              ${r.structured === null ? null : JSON.stringify(r.structured)}::jsonb,
              ${r.geolocation === null ? null : JSON.stringify(r.geolocation)}::jsonb,
              ${r.session_id}, ${r.word_count},
              ${r.audio_refs === null ? null : JSON.stringify(r.audio_refs)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        transcript_segments = EXCLUDED.transcript_segments, structured = EXCLUDED.structured,
        geolocation = EXCLUDED.geolocation, finished_at = EXCLUDED.finished_at,
        word_count = EXCLUDED.word_count, audio_refs = EXCLUDED.audio_refs`);
  }
}

export type ConversationLite = Omit<ConversationRow, "transcript_segments">;

export async function listConversationsLite(sql: Sql, limit = 200): Promise<ConversationLite[]> {
  return (await withTimeout(sql`
    SELECT id, source, created_at, started_at, finished_at, structured, geolocation, session_id, word_count, audio_refs
    FROM conversations ORDER BY created_at DESC LIMIT ${limit}`)) as ConversationLite[];
}

export async function getConversationRow(sql: Sql, id: string): Promise<ConversationRow | null> {
  const rows = (await withTimeout(sql`SELECT * FROM conversations WHERE id = ${id}`)) as ConversationRow[];
  return rows[0] ?? null;
}

// ── status page ──

export interface CaptureStatus {
  lastChunkAt: string | null;
  open: { id: string; deviceId: string; startedAt: string; lastSpeechAt: string; voicedMs: number }[];
  byStatus7d: Record<string, number>;
  failed: { id: string; startedAt: string; error: string; attempts: number }[];
  /** Newest chunks with their level percentiles — the VAD tuning readout. */
  recentChunks: { startedAt: string; durationMs: number; voicedMs: number; p10: number | null; p50: number | null; p90: number | null }[];
}

export async function captureStatus(sql: Sql): Promise<CaptureStatus> {
  const [last, open, counts, failed, recent] = await Promise.all([
    withTimeout(sql`SELECT MAX(received_at) AS at FROM capture_chunks`) as Promise<{ at: string | null }[]>,
    withTimeout(
      sql`SELECT id, device_id, started_at, last_speech_at, voiced_ms FROM capture_sessions WHERE status = 'open'`
    ) as Promise<{ id: string; device_id: string; started_at: string; last_speech_at: string; voiced_ms: number }[]>,
    withTimeout(
      sql`SELECT status, COUNT(*)::int AS n FROM capture_sessions WHERE started_at >= now() - interval '7 days' GROUP BY status`
    ) as Promise<{ status: string; n: number }[]>,
    withTimeout(
      sql`SELECT id, started_at, error, attempts FROM capture_sessions WHERE status = 'failed' ORDER BY started_at DESC LIMIT 20`
    ) as Promise<{ id: string; started_at: string; error: string | null; attempts: number }[]>,
    withTimeout(
      sql`SELECT started_at, duration_ms, voiced_ms, level_p10, level_p50, level_p90 FROM capture_chunks ORDER BY received_at DESC LIMIT 6`
    ) as Promise<{ started_at: string; duration_ms: number; voiced_ms: number; level_p10: number | null; level_p50: number | null; level_p90: number | null }[]>,
  ]);
  return {
    lastChunkAt: last[0]?.at ?? null,
    open: open.map((o) => ({ id: o.id, deviceId: o.device_id, startedAt: o.started_at, lastSpeechAt: o.last_speech_at, voicedMs: o.voiced_ms })),
    byStatus7d: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    failed: failed.map((f) => ({ id: f.id, startedAt: f.started_at, error: f.error ?? "", attempts: f.attempts })),
    recentChunks: recent.map((c) => ({ startedAt: c.started_at, durationMs: c.duration_ms, voicedMs: c.voiced_ms, p10: c.level_p10, p50: c.level_p50, p90: c.level_p90 })),
  };
}
