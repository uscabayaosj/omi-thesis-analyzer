import { randomUUID } from "node:crypto";
import { put, get } from "@vercel/blob";
import { getStore, getNamespaceData, type Sql } from "../kv";
import { parseChunk } from "./container";
import { decodeChunk, decodeFrames } from "./decode";
import { detectSpeech, levelStats, VAD_DEFAULTS } from "./vad";
import { placeSpan, isStale, disposition, SESSION_GAP_MS } from "./sessions";
import {
  assembleVoiced,
  encodeWav,
  spansOverlappingRanges,
  stitchWantedAudio,
  type VoicedPiece,
  type WantedRange,
  type DecodedChunkPcm,
} from "./assemble";
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
export const voiceMatchThreshold = () => envNumber("CAPTURE_VOICE_MATCH_THRESHOLD", 0.8, (v) => v > 0 && v <= 1);
// Grouping is deliberately stricter than matching: a false match mislabels one
// conversation, a false group makes the user answer for two people at once.
export const voiceGroupThreshold = () =>
  envNumber("CAPTURE_VOICE_GROUP_THRESHOLD", 0.85, (v) => v > 0 && v <= 1);
const minSpeakerMs = () => envNumber("CAPTURE_MIN_SPEAKER_MS", 3000, (v) => v >= 0);

function blobPathFor(startedAtMs: number, chunkId: string): string {
  return `capture/${new Date(startedAtMs).toISOString().slice(0, 10)}/${chunkId}.trch`;
}

export async function readBlob(path: string): Promise<Uint8Array> {
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

/**
 * Targeted counterpart to assembleSessionAudio, for callers that want only a
 * few seconds of ONE speaker — speaker-audio's preview clip, enroll-voice,
 * and cluster-voices' backfill — rather than the whole session Deepgram
 * needs. assembleSessionAudio decodes every chunk the session ever touched;
 * measured in production that was ~110s per conversation and enough peak
 * memory to SIGKILL (exit 137) a batch of two, to extract at most 30s of one
 * voice. This decodes only the chunks whose spans overlap `ranges`.
 *
 * IO split into two steps, both exported: decodeChunksForRanges pays for the
 * Blob reads + Opus decode once for a whole SET of ranges (so a caller that
 * needs several speakers out of the SAME conversation — cluster-voices — can
 * decode the union once and reuse it, exactly like the old per-conversation
 * assembleSessionAudio reuse, just scoped to what's wanted instead of the
 * whole session); stitchWantedAudio (assemble.ts, pure) then slices each
 * caller's own ranges back out of that shared decode. assembleTargetedAudio
 * below composes both for the common single-caller case.
 *
 * Works entirely in absolute wall-clock ms — see the WantedRange /
 * spansOverlappingRanges / stitchWantedAudio doc comments in assemble.ts for
 * why: reusing assembleVoiced's accumulated OffsetMapEntry coordinates
 * against a decoded SUBSET of a session's pieces would silently misalign,
 * since every offset in that map depends on which other pieces were
 * assembled alongside it. transcribeSession and identifySpeakers must keep
 * calling assembleSessionAudio and its OffsetMapEntry map unchanged — this
 * function is additive, not a replacement, and nothing here should ever be
 * wired into that path.
 */
export async function decodeChunksForRanges(
  sql: Sql,
  spans: AbsSpan[],
  ranges: WantedRange[]
): Promise<{ decoded: Map<string, DecodedChunkPcm>; chunkIds: string[] }> {
  const chunkIds = Array.from(new Set(spansOverlappingRanges(spans, ranges).map((sp) => sp.chunkId)));
  const paths = await store.getChunkBlobPaths(sql, chunkIds);
  const decoded = new Map<string, DecodedChunkPcm>();
  for (const id of chunkIds) {
    const path = paths.get(id);
    if (!path) continue;
    const chunk = parseChunk(await readBlob(path));
    decoded.set(id, { startedAtMs: chunk.startedAtMs, pcm: decodeFrames(chunk.frames, chunk.codec) });
  }
  return { decoded, chunkIds };
}

export interface TargetedAudioResult {
  pcm: Int16Array;
  chunkIds: string[];
}

/** decodeChunksForRanges + stitchWantedAudio pre-composed, for a caller that
 *  only needs one set of ranges out of one session (speaker-audio,
 *  enroll-voice). See decodeChunksForRanges's doc comment for the full
 *  design and the constraint that this must never replace
 *  assembleSessionAudio on the transcription path. */
export async function assembleTargetedAudio(
  sql: Sql,
  session: SessionState,
  ranges: WantedRange[]
): Promise<TargetedAudioResult> {
  const { decoded, chunkIds } = await decodeChunksForRanges(sql, session.spans, ranges);
  return { pcm: stitchWantedAudio(decoded, session.spans, ranges), chunkIds };
}

export function extractPeopleWithVoicePrints(raw: unknown): { id: string; name: string; voicePrint?: number[] }[] {
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
): Promise<{ segments: TranscriptSegment[]; unmatchedSpeakers: number[]; unmatchedEmbeddings: Map<number, number[]> }> {
  const clusters = groupBySpeaker(segments).filter((c) => c.totalMs >= minSpeakerMs());
  if (clusters.length === 0) return { segments, unmatchedSpeakers: [], unmatchedEmbeddings: new Map() };

  const people = extractPeopleWithVoicePrints(await getNamespaceData(sql, "omi-people"));
  const gallery = people
    .filter((p): p is { id: string; name: string; voicePrint: number[] } => !!p.voicePrint)
    .map((p) => ({ personId: p.id, embedding: p.voicePrint }));
  const threshold = voiceMatchThreshold();

  // Nobody is enrolled yet, so every cluster is unmatched by definition. Bail
  // before the model load and one inference per cluster — compute that cannot
  // change the answer. Deliberately kept even though it means these clusters
  // reach voice_clusters only via the backfill: it fires only until the first
  // voice is named, so the gap it leaves is a bounded, one-time backlog rather
  // than a standing cost on every session (see the spec's Decisions table).
  if (gallery.length === 0) {
    return { segments, unmatchedSpeakers: clusters.map((c) => c.speakerId), unmatchedEmbeddings: new Map() };
  }

  const matchBySpeakerId = new Map<number, { personId: string; name: string }>();
  const unmatchedSpeakers: number[] = [];
  const unmatchedEmbeddings = new Map<number, number[]>();

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
        unmatchedEmbeddings.set(cluster.speakerId, embedding);
      }
    } catch (e) {
      console.error(`speaker identification failed for cluster ${cluster.speakerId}:`, e);
    }
  }

  const out = segments.map((seg) => {
    const m = matchBySpeakerId.get(seg.speaker_id);
    return m ? { ...seg, speaker_name: m.name, speaker_person_id: m.personId } : seg;
  });
  return { segments: out, unmatchedSpeakers, unmatchedEmbeddings };
}

async function transcribeSession(
  sql: Sql,
  s: SessionState
): Promise<{ row: ConversationRow; unmatchedEmbeddings: Map<number, number[]> }> {
  const { assembled, chunkIds, paths } = await assembleSessionAudio(sql, s);
  const utterances = await transcribeWav(encodeWav(assembled.pcm));
  const segments = utterancesToSegments(utterances, assembled.map, s.startedAtMs);
  const { segments: identified, unmatchedSpeakers, unmatchedEmbeddings } = await identifySpeakers(
    sql,
    segments,
    assembled,
    s.startedAtMs
  );
  const id = randomUUID();

  const row: ConversationRow = {
    id,
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
  return { row, unmatchedEmbeddings };
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
    const { row, unmatchedEmbeddings } = await transcribeSession(sql, s);
    await store.upsertConversations(sql, [row]);

    // Only now does row.id exist as a conversation. Write the unmatched
    // clusters here, after the insert, not inside transcribeSession: a retry
    // re-runs transcribeSession and mints a fresh id, so any cluster row
    // written against the old id — one that never made it into
    // upsertConversations — would be orphaned forever, with no foreign key
    // and no cleanup path to reclaim it. Best-effort per row: a failed
    // cluster write costs a backfill later, never the session.
    for (const [speakerId, embedding] of unmatchedEmbeddings) {
      try {
        await store.upsertVoiceCluster(sql, { conversationId: row.id, speakerId, embedding, groupId: null });
      } catch (e) {
        console.error(`voice cluster write failed for speaker ${speakerId}:`, e);
      }
    }

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

/** What became of each session a manual action closed or retried. Counted
 *  from the session rows after the fact, because closeSession never throws —
 *  a failure is recorded on the row, so the row is the only honest source. */
export interface CloseOutcome {
  transcribed: number;
  discarded: number;
  failed: number;
}

async function tally(sql: Sql, ids: string[]): Promise<CloseOutcome> {
  const out: CloseOutcome = { transcribed: 0, discarded: 0, failed: 0 };
  for (const id of ids) {
    const s = await store.getSession(sql, id);
    if (s?.status === "done") out.transcribed++;
    else if (s?.status === "discarded") out.discarded++;
    else if (s?.status === "failed") out.failed++;
  }
  return out;
}

/** Close every open session now, regardless of the silence gap — the user's
 *  "I'm done, transcribe it" button. Awaited (not deferred) so the caller can
 *  refresh the list the moment the conversation exists — and so the outcome
 *  can be reported: by the time this returns, transcription has already
 *  succeeded, been skipped as too short, or failed. The banner used to say
 *  "transcribing now" for all three. */
export async function closeAllOpen(): Promise<{ closed: string[] } & CloseOutcome> {
  const sql = getStore();
  if (!sql) return { closed: [], transcribed: 0, discarded: 0, failed: 0 };
  await store.ensureCaptureSchemaOnce(sql);
  const open = await store.listStaleOpen(sql, Date.now() + 60_000);
  for (const s of open) await closeSession(s.id);
  const ids = open.map((s) => s.id);
  return { closed: ids, ...(await tally(sql, ids)) };
}

/** Re-run every failed session on demand. The daily sweep retries at most
 *  three times, then leaves the session failed for good with nothing in the
 *  UI able to touch it — a Deepgram blip on a long conversation was a day's
 *  wait at best and a permanent hole at worst. This is the user's own retry,
 *  so the attempt cap is deliberately not applied. */
export async function retryFailed(): Promise<{ retried: string[] } & CloseOutcome> {
  const sql = getStore();
  if (!sql) return { retried: [], transcribed: 0, discarded: 0, failed: 0 };
  await store.ensureCaptureSchemaOnce(sql);
  const ids = await store.listFailed(sql);
  for (const id of ids) await closeSession(id);
  return { retried: ids, ...(await tally(sql, ids)) };
}
