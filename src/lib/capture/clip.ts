import { SAMPLE_RATE } from "./assemble.ts";

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

/**
 * How much of a speaker's audio the embedding model is allowed to see.
 *
 * WavLM's feature extractor downsamples 16kHz audio by 320x and its
 * self-attention is quadratic in the resulting frames, so the cost of one
 * embedding grows with the SQUARE of how long that speaker talked. Feeding it
 * a whole cluster is what SIGKILLed enroll-voice and cluster-voices in
 * production (exit 137): twenty minutes of speech is ~19.2M samples, ~60k
 * frames, and an attention matrix wanting ~14GB on its own. No instance size
 * survives an unbounded input — it has to be bounded here.
 *
 * 30s is generous for the job. Speaker-verification embeddings saturate after
 * a few seconds of voiced audio, and this input is already voiced-only
 * (assembleVoiced strips the silence between segments), so 30s is 30s of
 * actual speech. At that length the attention matrix is ~9MB.
 */
export const EMBED_MAX_SAMPLES = 30 * SAMPLE_RATE;

/**
 * Copies on truncation rather than returning a `subarray` view. A view shares
 * the original `buffer`, so any consumer that reaches for `pcm.buffer` instead
 * of honouring length/byteOffset would see the whole uncapped recording and
 * the bound would silently do nothing — the exact failure this exists to
 * prevent, in a form no test of this function would catch. 30s is 1.9MB; the
 * copy is not worth reasoning about the alternative.
 */
export function capPcmForEmbedding(
  pcm: Float32Array,
  maxSamples: number = EMBED_MAX_SAMPLES
): Float32Array {
  return pcm.length <= maxSamples ? pcm : pcm.slice(0, maxSamples);
}
