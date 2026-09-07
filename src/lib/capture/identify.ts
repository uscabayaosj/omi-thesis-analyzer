import type { TranscriptSegment } from "./types.ts";
import {
  assembleVoiced,
  absToOutMs,
  SAMPLE_RATE,
  type Assembled,
  type VoicedPiece,
  type WantedRange,
} from "./assemble.ts";

/**
 * Pure speaker-matching logic: no PCM decoding, no ML model, no network —
 * just the math and grouping around it, so node:test can load this file
 * directly (same reasoning as transcribe-map.ts). The ML embedding itself
 * lives in embed.ts.
 */

export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`embedding length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Weighted running average of two embeddings, weighted by prior sample
 *  count. Restarts from `next` alone if the vector length changed (e.g. the
 *  embedding model was swapped) rather than averaging incompatible shapes. */
export function averageEmbeddings(
  existing: number[] | undefined,
  existingCount: number,
  next: number[]
): { embedding: number[]; count: number } {
  if (!existing || existingCount <= 0 || existing.length !== next.length) {
    return { embedding: next, count: 1 };
  }
  const count = existingCount + 1;
  const embedding = existing.map((v, i) => (v * existingCount + next[i]) / count);
  return { embedding, count };
}

export interface SpeakerCluster {
  speakerId: number;
  segments: { start: number; end: number }[];
  totalMs: number;
}

/** Group a session's segments by speaker_id and total their duration, in the
 *  order speakers first appear. */
export function groupBySpeaker(segments: TranscriptSegment[]): SpeakerCluster[] {
  const order: number[] = [];
  const byId = new Map<number, SpeakerCluster>();
  for (const seg of segments) {
    const id = seg.speaker_id;
    let c = byId.get(id);
    if (!c) {
      c = { speakerId: id, segments: [], totalMs: 0 };
      byId.set(id, c);
      order.push(id);
    }
    c.segments.push({ start: seg.start, end: seg.end });
    c.totalMs += Math.max(0, (seg.end - seg.start) * 1000);
  }
  return order.map((id) => byId.get(id)!);
}

export interface GalleryEntry {
  personId: string;
  embedding: number[];
}

export interface MatchResult {
  personId: string;
  score: number;
}

/** Best gallery match for one embedding, or null if nothing clears the
 *  threshold (or the gallery is empty). */
export function bestMatch(embedding: number[], gallery: GalleryEntry[], threshold: number): MatchResult | null {
  let best: MatchResult | null = null;
  for (const g of gallery) {
    const score = cosineSimilarity(embedding, g.embedding);
    if (!best || score > best.score) best = { personId: g.personId, score };
  }
  return best && best.score >= threshold ? best : null;
}

/** Slice one speaker's audio back out of an already-assembled conversation
 *  buffer, using the segment timestamps (seconds, relative to the
 *  conversation start) transcribe-map.ts produced. Re-stitched with a small
 *  gap between segments, same technique assemble.ts uses for the whole
 *  conversation. */
export function extractSpeakerPcm(
  assembled: Assembled,
  conversationStartMs: number,
  cluster: SpeakerCluster
): Int16Array {
  const toSample = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
  const pieces: VoicedPiece[] = cluster.segments.map((seg) => {
    const fromOut = toSample(absToOutMs(assembled.map, conversationStartMs + seg.start * 1000));
    const toOut = toSample(absToOutMs(assembled.map, conversationStartMs + seg.end * 1000));
    return {
      span: { chunkId: "", startMs: seg.start * 1000, endMs: seg.end * 1000 },
      pcm: assembled.pcm.subarray(Math.max(0, fromOut), Math.min(assembled.pcm.length, toOut)),
    };
  });
  return assembleVoiced(pieces, 200).pcm;
}

/** Turns a speaker cluster's segment timestamps (seconds, relative to the
 *  conversation start) into absolute wall-clock ranges — the shape the
 *  targeted-assembly path wants (see WantedRange / stitchWantedAudio in
 *  assemble.ts, and assembleTargetedAudio in pipeline.ts). Same arithmetic
 *  extractSpeakerPcm above uses to locate a segment in real time; split out
 *  because the targeted path has no assembled buffer to slice — it decodes
 *  only the chunks these ranges point into. */
export function segmentsToAbsRanges(
  conversationStartMs: number,
  segments: { start: number; end: number }[]
): WantedRange[] {
  return segments.map((seg) => ({
    startMs: conversationStartMs + seg.start * 1000,
    endMs: conversationStartMs + seg.end * 1000,
  }));
}
