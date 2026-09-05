import type { OffsetMapEntry } from "./assemble";
import type { TranscriptSegment } from "./types";

/**
 * Deepgram heard the assembled buffer; the UI wants seconds from the real
 * start. Pure and dependency-free (the offset lookup is re-declared here
 * rather than imported so node:test can load this file directly).
 */

export interface DeepgramUtterance {
  start: number;
  end: number;
  transcript: string;
  speaker?: number;
}

/** Same rule as assemble.ts's outToAbsMs: inside a piece → linear; in a gap → end of the piece before. */
function outToAbsMs(map: OffsetMapEntry[], outMs: number): number {
  let prev: OffsetMapEntry | null = null;
  for (const e of map) {
    if (outMs < e.outStartMs) break;
    if (outMs <= e.outEndMs) return e.absStartMs + (outMs - e.outStartMs);
    prev = e;
  }
  if (prev) return prev.absStartMs + (prev.outEndMs - prev.outStartMs);
  return map[0]?.absStartMs ?? 0;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function utterancesToSegments(
  utts: DeepgramUtterance[],
  map: OffsetMapEntry[],
  conversationStartMs: number,
): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const u of utts) {
    const text = u.transcript.trim();
    if (!text) continue;
    out.push({
      text,
      speaker_id: u.speaker ?? 0,
      start: round3((outToAbsMs(map, u.start * 1000) - conversationStartMs) / 1000),
      end: round3((outToAbsMs(map, u.end * 1000) - conversationStartMs) / 1000),
    });
  }
  return out;
}
