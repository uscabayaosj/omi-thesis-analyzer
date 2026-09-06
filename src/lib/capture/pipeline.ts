import { randomUUID } from "node:crypto";
import { put, get } from "@vercel/blob";
import { getStore, getNamespaceData, type Sql } from "../kv";
import { parseChunk } from "./container";
import { decodeChunk, decodeFrames } from "./decode";
import { detectSpeech, levelStats, VAD_DEFAULTS } from "./vad";
import { placeSpan, isStale, disposition, SESSION_GAP_MS } from "./sessions";
import { assembleVoiced, encodeWav, type VoicedPiece } from "./assemble";
import { transcribeWav, utterancesToSegments } from "./transcribe";
import { groupBySpeaker, bestMatch, extractSpeakerPcm, int16ToFloat32 } from "./identify";
import { embedAudio } from "./embed";
import { countWords, type ConversationRow } from "./rows";
import type { AbsSpan, SessionState, TranscriptSegment } from "./types";
import * as store from "./store";

/**
 * The capture pipeline end to end. Pure modules do the thinking; this file
 * sequences them and owns every side effect (Blob, Neon, Deepgram).
 */

const SR = 16000;

/** A tunable read from the environment, falling back to `fallback` when the
 *  variable is unset, blank, non-numeric, or fails `valid`. Blank matters:
 *  `Number("")` is 0, and a dashboard-created variable left empty is a
 *  common state — for the match threshold that 0 would silently label every
 *  speaker as whoever is first in the gallery. */
function envNumber(name: string, fallback: number, valid: (v: number) => boolean = Number.isFinite): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && valid(v) ? v : fallback;
}

const vadThreshold = () => envNumber("CAPTURE_VAD_DBFS", VAD_DEFAULTS.thresholdDbfs);
// Cosine similarity: only (0, 1] is a meaningful "same speaker" cutoff.
const voiceMatchThreshold = () => envNumber("CAPTURE_VOICE_MATCH_THRESHOLD", 0.8, (v) => v > 0 && v <= 1);
const minSpeakerMs = () => envNumber("CAPTURE_MIN_SPEAKER_MS", 3000, (v) => v >= 0);

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
    levels: levelStats(pcm),
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

export async function assembleSessionAudio(
  sql: Sql,
  s: SessionState
): Promise<{ assembled: ReturnType<typeof assembleVoiced>; chunkIds: string[]; paths: Map<string, string> }> {
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
  return { assembled: assembleVoiced(pieces), chunkIds, paths };
}

function extractPeopleWithVoicePrints(raw: unknown): { id: string; name: string; voicePrint?: number[] }[] {
  if (!raw || typeof raw !== "object") return [];
  const out: { id: string; name: string; voicePrint?: number[] }[] = [];
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (id.startsWith("__") || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if ("deleted" in r || typeof r.name !== "string") continue; // skip tombstones + malformed
    const voicePrint =
      Array.isArray(r.voicePrint) && r.voicePrint.every((n) => typeof n === "number")
        ? (r.voicePrint as number[])
        : undefined;
    out.push({ id, name: r.name, voicePrint });
  }
  return out;
}

/** Matches each speaker cluster against the People Directory's enrolled
 *  voiceprints. An embedding failure (model unavailable, the native
 *  onnxruntime binding failing to load) is caught per cluster: it logs and
 *  leaves that cluster numeric, exactly like a cluster that legitimately has
 *  no match. Only the gallery read itself can throw, and that propagates to
 *  closeSession, which marks the session failed and retryable — better than
 *  writing a permanently unlabeled transcript over a transient store error. */
async function identifySpeakers(
  sql: Sql,
  segments: TranscriptSegment[],
  assembled: ReturnType<typeof assembleVoiced>,
  conversationStartMs: number
): Promise<{ segments: TranscriptSegment[]; unmatchedSpeakers: number[] }> {
  const clusters = groupBySpeaker(segments).filter((c) => c.totalMs >= minSpeakerMs());
  if (clusters.length === 0) return { segments, unmatchedSpeakers: [] };

  const people = extractPeopleWithVoicePrints(await getNamespaceData(sql, "omi-people"));
  const gallery = people
    .filter((p): p is { id: string; name: string; voicePrint: number[] } => !!p.voicePrint)
    .map((p) => ({ personId: p.id, embedding: p.voicePrint }));
  const threshold = voiceMatchThreshold();

  // Nobody is enrolled yet, so every cluster is unmatched by definition. Bail
  // before the model load and one inference per cluster — compute that cannot
  // change the answer.
  if (gallery.length === 0) {
    return { segments, unmatchedSpeakers: clusters.map((c) => c.speakerId) };
  }

  const matchBySpeakerId = new Map<number, { personId: string; name: string }>();
  const unmatchedSpeakers: number[] = [];

  for (const cluster of clusters) {
    try {
      const pcm = extractSpeakerPcm(assembled, conversationStartMs, cluster);
      const embedding = await embedAudio(int16ToFloat32(pcm));
      const match = bestMatch(embedding, gallery, threshold);
      if (match) {
        const person = people.find((p) => p.id === match.personId)!;
        matchBySpeakerId.set(cluster.speakerId, { personId: person.id, name: person.name });
      } else {
        unmatchedSpeakers.push(cluster.speakerId);
      }
    } catch (e) {
      console.error(`speaker identification failed for cluster ${cluster.speakerId}:`, e);
    }
  }

  const out = segments.map((seg) => {
    const m = matchBySpeakerId.get(seg.speaker_id);
    return m ? { ...seg, speaker_name: m.name, speaker_person_id: m.personId } : seg;
  });
  return { segments: out, unmatchedSpeakers };
}

async function transcribeSession(sql: Sql, s: SessionState): Promise<ConversationRow> {
  const { assembled, chunkIds, paths } = await assembleSessionAudio(sql, s);
  const utterances = await transcribeWav(encodeWav(assembled.pcm));
  const segments = utterancesToSegments(utterances, assembled.map, s.startedAtMs);
  const { segments: identified, unmatchedSpeakers } = await identifySpeakers(sql, segments, assembled, s.startedAtMs);
  return {
    id: randomUUID(),
    source: "trace",
    created_at: new Date(s.startedAtMs).toISOString(),
    started_at: new Date(s.startedAtMs).toISOString(),
    finished_at: new Date(s.lastSpeechAtMs).toISOString(),
    transcript_segments: identified,
    structured: null,
    geolocation: null,
    session_id: s.id,
    word_count: countWords(identified),
    audio_refs: chunkIds.map((id) => paths.get(id)).filter((p): p is string => !!p),
    unmatched_speakers: unmatchedSpeakers.length ? unmatchedSpeakers : null,
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

/** Close every open session now, regardless of the silence gap — the user's
 *  "I'm done, transcribe it" button. Awaited (not deferred) so the caller can
 *  refresh the list the moment the conversation exists. */
export async function closeAllOpen(): Promise<{ closed: string[] }> {
  const sql = getStore();
  if (!sql) return { closed: [] };
  await store.ensureCaptureSchemaOnce(sql);
  const open = await store.listStaleOpen(sql, Date.now() + 60_000);
  for (const s of open) await closeSession(s.id);
  return { closed: open.map((s) => s.id) };
}
