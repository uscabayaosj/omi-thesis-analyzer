import type { AbsSpan } from "./types";

/**
 * Turns a session's voiced pieces into the single buffer Deepgram hears, and
 * keeps the map that turns Deepgram's timestamps back into wall-clock time.
 * Silence between pieces is short and synthetic: Deepgram is paid for what it
 * hears, and the hours of quiet the pendant streamed are not in here.
 */

export const SAMPLE_RATE = 16000 as const;

export interface VoicedPiece {
  span: AbsSpan;
  pcm: Int16Array;
}

export interface OffsetMapEntry {
  outStartMs: number;
  outEndMs: number;
  absStartMs: number;
}

export interface Assembled {
  pcm: Int16Array;
  map: OffsetMapEntry[];
  sampleRate: typeof SAMPLE_RATE;
}

const samples = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
const ms = (n: number) => (n / SAMPLE_RATE) * 1000;

export function assembleVoiced(pieces: VoicedPiece[], gapMs = 400): Assembled {
  const ordered = [...pieces].sort((a, b) => a.span.startMs - b.span.startMs);
  const gap = samples(gapMs);
  const total = ordered.reduce((n, p) => n + p.pcm.length, 0) + Math.max(0, ordered.length - 1) * gap;
  const pcm = new Int16Array(total);
  const map: OffsetMapEntry[] = [];
  let at = 0;
  ordered.forEach((p, i) => {
    if (i > 0) at += gap;
    pcm.set(p.pcm, at);
    map.push({ outStartMs: ms(at), outEndMs: ms(at + p.pcm.length), absStartMs: p.span.startMs });
    at += p.pcm.length;
  });
  return { pcm, map, sampleRate: SAMPLE_RATE };
}

export function outToAbsMs(map: OffsetMapEntry[], outMs: number): number {
  let prev: OffsetMapEntry | null = null;
  for (const e of map) {
    if (outMs < e.outStartMs) break;
    if (outMs <= e.outEndMs) return e.absStartMs + (outMs - e.outStartMs);
    prev = e;
  }
  if (prev) return prev.absStartMs + (prev.outEndMs - prev.outStartMs);
  return map[0]?.absStartMs ?? 0;
}

/** Inverse of outToAbsMs: given a wall-clock ms, find its offset in the
 *  assembled buffer. Falls back to the start of the buffer if `absMs` is
 *  before every piece, and to the end of the last piece if it's after. Used
 *  to slice one speaker's audio back out of an already-assembled buffer
 *  (see identify.ts / the enroll-voice route). */
export function absToOutMs(map: OffsetMapEntry[], absMs: number): number {
  let prev: OffsetMapEntry | null = null;
  for (const e of map) {
    const pieceDurMs = e.outEndMs - e.outStartMs;
    if (absMs < e.absStartMs) break;
    if (absMs <= e.absStartMs + pieceDurMs) return e.outStartMs + (absMs - e.absStartMs);
    prev = e;
  }
  if (prev) return prev.outEndMs;
  return map[0]?.outStartMs ?? 0;
}

/**
 * ── Targeted assembly ──
 *
 * The functions below are the pure half of a SECOND path through this data,
 * used when a caller wants only a few seconds of one speaker (a preview
 * clip, one voiceprint) rather than the whole session assembleVoiced/
 * assembleSessionAudio (pipeline.ts) build for Deepgram. That full path
 * decodes every chunk the session touches — correct and necessary for
 * transcription, wasteful when 15-30s of audio is all that's wanted.
 *
 * Deliberately its own coordinate system: everything here is absolute
 * wall-clock ms, never an OffsetMapEntry.outStartMs. Those offsets accumulate
 * across ALL pieces assembled together, so decoding and assembling a SUBSET
 * of a session's pieces would silently shift every offset if this reused
 * that map — a wrong voiceprint with no error to surface it. Absolute ms
 * has no such coupling: a span's or a segment's wall-clock time means the
 * same thing whether one chunk is decoded or all of them are.
 */

export interface WantedRange {
  startMs: number;
  endMs: number;
}

/** Which of a session's spans overlap ANY of `ranges` — and therefore which
 *  chunk ids actually need decoding. Pure selection step of the targeted
 *  path (assembleTargetedAudio / decodeChunksForRanges in pipeline.ts): the
 *  IO wrapper decodes only the chunks these spans point into, instead of
 *  every chunk the session ever touched. */
export function spansOverlappingRanges(spans: AbsSpan[], ranges: WantedRange[]): AbsSpan[] {
  return spans.filter((sp) => ranges.some((r) => sp.startMs < r.endMs && sp.endMs > r.startMs));
}

export interface DecodedChunkPcm {
  startedAtMs: number;
  pcm: Int16Array;
}

/**
 * Stitches only the wanted audio out of already-decoded chunks, entirely in
 * absolute wall-clock ms — see the file-level note above for why this does
 * NOT build or consume an OffsetMapEntry map the way assembleVoiced does.
 *
 * For each wanted range (defensively sorted by start time, same as
 * assembleVoiced does for pieces), every span overlapping it is sliced by
 * absolute offset within its decoded chunk
 * (`Math.round(((lo - d.startedAtMs) / 1000) * SAMPLE_RATE)`, clamped to the
 * decoded length — the same arithmetic assembleSessionAudio uses) and
 * concatenated with NO gap between those slices: they are genuinely
 * contiguous real audio, merely split across more than one decoded
 * chunk/span. `gapMs` of silence is inserted only BETWEEN separate wanted
 * ranges, mirroring extractSpeakerPcm's existing per-segment gap.
 *
 * DOCUMENTED BEHAVIOURAL DIFFERENCE from the old path: when a single wanted
 * range straddles two spans, slicing it out of assembleVoiced's assembled
 * buffer (the old way extractSpeakerPcm did this) would include that pair's
 * synthetic `gapMs` of silence, because that's literally what sits in the
 * buffer at that offset. This function has no synthetic silence to include —
 * it splices the real audio on either side of the boundary directly. That is
 * MORE correct for a preview clip or a voice embedding (fabricated silence
 * only dilutes either one), but it means the output is NOT byte-identical to
 * the old assembled-buffer slice for a range that crosses a span boundary.
 */
export function stitchWantedAudio(
  decoded: Map<string, DecodedChunkPcm>,
  spans: AbsSpan[],
  ranges: WantedRange[],
  gapMs = 200
): Int16Array {
  const gap = samples(gapMs);
  const orderedRanges = [...ranges].sort((a, b) => a.startMs - b.startMs);
  const rangeChunks: Int16Array[] = [];

  for (const range of orderedRanges) {
    const overlapping = spans
      .filter((sp) => sp.startMs < range.endMs && sp.endMs > range.startMs)
      .sort((a, b) => a.startMs - b.startMs);

    const slices: Int16Array[] = [];
    for (const sp of overlapping) {
      const d = decoded.get(sp.chunkId);
      if (!d) continue;
      const lo = Math.max(sp.startMs, range.startMs);
      const hi = Math.min(sp.endMs, range.endMs);
      const from = Math.round(((lo - d.startedAtMs) / 1000) * SAMPLE_RATE);
      const to = Math.round(((hi - d.startedAtMs) / 1000) * SAMPLE_RATE);
      const slice = d.pcm.subarray(Math.max(0, from), Math.min(d.pcm.length, to));
      if (slice.length > 0) slices.push(slice);
    }
    if (slices.length === 0) continue;

    const merged = new Int16Array(slices.reduce((n, s) => n + s.length, 0));
    let at = 0;
    for (const s of slices) {
      merged.set(s, at);
      at += s.length;
    }
    rangeChunks.push(merged);
  }

  if (rangeChunks.length === 0) return new Int16Array(0);
  const total = rangeChunks.reduce((n, c) => n + c.length, 0) + Math.max(0, rangeChunks.length - 1) * gap;
  const out = new Int16Array(total);
  let at = 0;
  rangeChunks.forEach((c, i) => {
    if (i > 0) at += gap;
    out.set(c, at);
    at += c.length;
  });
  return out;
}

export function encodeWav(pcm: Int16Array, sampleRate: number = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = pcm.length * 2;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i);
  };
  ascii(0, "RIFF"); v.setUint32(4, 36 + dataBytes, true); ascii(8, "WAVE");
  ascii(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, "data"); v.setUint32(40, dataBytes, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, pcm[i], true);
  return out;
}
