import { randomUUID } from "node:crypto";
import { put, get } from "@vercel/blob";
import { getStore, type Sql } from "../kv";
import { parseChunk } from "./container";
import { decodeChunk, decodeFrames } from "./decode";
import { detectSpeech, VAD_DEFAULTS } from "./vad";
import { placeSpan, isStale, disposition, SESSION_GAP_MS } from "./sessions";
import { assembleVoiced, encodeWav, type VoicedPiece } from "./assemble";
import { transcribeWav, utterancesToSegments } from "./transcribe";
import { countWords, type ConversationRow } from "./omi-import-map";
import type { AbsSpan, SessionState } from "./types";
import * as store from "./store";

/**
 * The capture pipeline end to end. Pure modules do the thinking; this file
 * sequences them and owns every side effect (Blob, Neon, Deepgram).
 */

const SR = 16000;

const vadThreshold = () => {
  const v = Number(process.env.CAPTURE_VAD_DBFS);
  return Number.isFinite(v) ? v : VAD_DEFAULTS.thresholdDbfs;
};

function blobPathFor(startedAtMs: number, chunkId: string): string {
  return `capture/${new Date(startedAtMs).toISOString().slice(0, 10)}/${chunkId}.trch`;
}

async function readBlob(path: string): Promise<Uint8Array> {
  const res = await get(path, { access: "private" });
  if (!res || res.statusCode !== 200) throw new Error(`blob read failed: ${path}`);
  return new Uint8Array(await new Response(res.stream).arrayBuffer());
}

export interface IngestResult {
  duplicate: boolean;
  durationMs: number;
  voicedMs: number;
  sessionId: string | null;
  /** Sessions this chunk (or the passage of time) has closed; the caller transcribes them after responding. */
  toClose: string[];
}

export async function ingestChunk(input: { chunkId: string; deviceId: string; bytes: Uint8Array }): Promise<IngestResult> {
  const sql = getStore();
  if (!sql) throw new Error("store not configured");
  await store.ensureCaptureSchemaOnce(sql);

  if (await store.chunkExists(sql, input.chunkId)) {
    return { duplicate: true, durationMs: 0, voicedMs: 0, sessionId: null, toClose: [] };
  }

  const chunk = parseChunk(input.bytes); // throws "bad chunk: …"
  const blobPath = blobPathFor(chunk.startedAtMs, input.chunkId);
  await put(blobPath, Buffer.from(input.bytes), { access: "private", addRandomSuffix: false, contentType: "application/octet-stream" });

  const pcm = decodeChunk(chunk);
  const spans = detectSpeech(pcm, { thresholdDbfs: vadThreshold() });
  const voicedMs = spans.reduce((n, s) => n + (s.endMs - s.startMs), 0);

  await store.insertChunk(sql, {
    id: input.chunkId,
    deviceId: input.deviceId,
    codec: chunk.codec,
    startedAtMs: chunk.startedAtMs,
    durationMs: chunk.durationMs,
    packets: chunk.frames.length,
    voicedMs,
    blobPath,
    bytes: input.bytes.length,
  });

  // Hand each voiced span to the session rules; persist whatever they decide.
  let open = await store.getOpenSession(sql, input.deviceId);
  const toClose: string[] = [];
  for (const s of spans) {
    const abs: AbsSpan = { chunkId: input.chunkId, startMs: chunk.startedAtMs + s.startMs, endMs: chunk.startedAtMs + s.endMs };
    const r = placeSpan(open, abs, randomUUID, input.deviceId);
    if (r.close) toClose.push(r.close.id);
    open = r.open;
  }
  if (spans.length > 0 && open) {
    await store.saveOpenSession(sql, open);
    await store.setChunkSession(sql, [input.chunkId], open.id);
  }
  // Any other stale session (e.g. the pendant went quiet) closes on this ingest too.
  const stale = await store.listStaleOpen(sql, Date.now() - SESSION_GAP_MS);
  for (const s of stale) if (!toClose.includes(s.id) && s.id !== open?.id) toClose.push(s.id);

  return { duplicate: false, durationMs: chunk.durationMs, voicedMs, sessionId: open?.id ?? null, toClose };
}

async function transcribeSession(sql: Sql, s: SessionState): Promise<ConversationRow> {
  // Re-fetch and decode only the chunks the session's spans point at.
  const chunkIds = Array.from(new Set(s.spans.map((sp) => sp.chunkId)));
  const paths = await store.getChunkBlobPaths(sql, chunkIds);
  const decoded = new Map<string, { startedAtMs: number; pcm: Int16Array }>();
  for (const id of chunkIds) {
    const path = paths.get(id);
    if (!path) continue;
    const chunk = parseChunk(await readBlob(path));
    decoded.set(id, { startedAtMs: chunk.startedAtMs, pcm: decodeFrames(chunk.frames, chunk.codec) });
  }
  const pieces: VoicedPiece[] = [];
  for (const sp of s.spans) {
    const d = decoded.get(sp.chunkId);
    if (!d) continue;
    const from = Math.round(((sp.startMs - d.startedAtMs) / 1000) * SR);
    const to = Math.round(((sp.endMs - d.startedAtMs) / 1000) * SR);
    pieces.push({ span: sp, pcm: d.pcm.subarray(Math.max(0, from), Math.min(d.pcm.length, to)) });
  }
  const assembled = assembleVoiced(pieces);
  const utterances = await transcribeWav(encodeWav(assembled.pcm));
  const segments = utterancesToSegments(utterances, assembled.map, s.startedAtMs);
  return {
    id: randomUUID(),
    source: "trace",
    created_at: new Date(s.startedAtMs).toISOString(),
    started_at: new Date(s.startedAtMs).toISOString(),
    finished_at: new Date(s.lastSpeechAtMs).toISOString(),
    transcript_segments: segments,
    structured: null,
    geolocation: null,
    session_id: s.id,
    word_count: countWords(segments),
    audio_refs: chunkIds.map((id) => paths.get(id)).filter((p): p is string => !!p),
  };
}

/** Never throws — a failure is recorded on the session for the sweep to retry. */
export async function closeSession(sessionId: string): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  try {
    const s = await store.getSession(sql, sessionId);
    if (!s || (s.status !== "open" && s.status !== "failed")) return;
    if (disposition(s) === "discard") {
      await store.setSessionStatus(sql, s.id, "discarded", { endedAtMs: s.lastSpeechAtMs });
      return;
    }
    await store.setSessionStatus(sql, s.id, "transcribing", { bumpAttempts: true });
    const row = await transcribeSession(sql, s);
    await store.upsertConversations(sql, [row]);
    await store.setSessionStatus(sql, s.id, "done", { conversationId: row.id, endedAtMs: s.lastSpeechAtMs });
  } catch (err) {
    console.error(`closeSession ${sessionId} failed:`, err);
    await store.setSessionStatus(sql, sessionId, "failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function sweep(nowMs = Date.now()): Promise<{ closed: string[]; retried: string[] }> {
  const sql = getStore();
  if (!sql) return { closed: [], retried: [] };
  await store.ensureCaptureSchemaOnce(sql);
  const stale = (await store.listStaleOpen(sql, nowMs - SESSION_GAP_MS)).filter((s) => isStale(s, nowMs));
  const retried = await store.listRetryable(sql);
  for (const s of stale) await closeSession(s.id);
  for (const id of retried) await closeSession(id);
  return { closed: stale.map((s) => s.id), retried };
}
