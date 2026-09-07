/** How much of a speaker goes into a preview clip. Recognition of a familiar
 *  voice is near-instant; 15s at 16kHz mono is ~480KB of WAV, small enough to
 *  serve inline and long enough to be sure. */
export const CLIP_MAX_MS = 15_000;

/**
 * The leading segments of one speaker's cluster, up to `maxMs` of speech.
 *
 * Leading, not longest: a clip is listened to, so it has to sound like someone
 * talking rather than three spliced highlights. Always returns at least one
 * segment — a single 90-second answer is still the only sample there is, and
 * returning nothing would render the speaker unplayable.
 */
export function capSpeakerSegments<T extends { start: number; end: number }>(
  segments: T[],
  maxMs: number = CLIP_MAX_MS
): T[] {
  const out: T[] = [];
  let total = 0;
  for (const seg of segments) {
    out.push(seg);
    total += Math.max(0, (seg.end - seg.start) * 1000);
    if (total >= maxMs) break;
  }
  return out;
}
