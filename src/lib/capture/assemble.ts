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
