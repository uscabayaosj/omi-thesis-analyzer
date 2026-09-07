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
 * WavLM downsamples 16kHz by 320x (50 frames/s) and its self-attention is
 * quadratic in the resulting frames, so one embedding's cost grows with the
 * SQUARE of how long that speaker talked. The scores tensor is
 * (1, heads=12, T, T) float32 = 48*T^2 bytes, and WavLM's gated relative
 * position bias is itself (12, T, T), computed at layer 0 and carried
 * resident through all 12 layers — so two T-by-T tensors are live at once.
 *
 *     30s  ->  T=1,500   ~108 MB      <- this cap
 *     60s  ->  T=3,000   ~432 MB
 *     2min ->  T=6,000   ~1.73 GB     <- past the 2 GB instance
 *    20min ->  T=60,000  ~173 GB
 *
 * Feeding it a whole cluster is what SIGKILLed enroll-voice and
 * cluster-voices in production (exit 137). Against a 2 GB instance, after the
 * ~400 MB fp32 model, ~150 MB of Node/ORT baseline and the assembled audio,
 * the kill boundary lands around T=3,200-4,000 — roughly 65-80 SECONDS of one
 * speaker. That is an ordinary speaker in an ordinary conversation, not an
 * outlier, which is why this failed every time rather than occasionally.
 *
 * DO NOT RAISE THIS ABOVE ~60s WITHOUT RAISING THE INSTANCE MEMORY FIRST.
 * The numbers above are the whole tensor; reasoning per-head understates them
 * by 12x, which is exactly the mistake that shipped this incident.
 *
 * 30s is generous for the job regardless: verification embeddings are near
 * asymptotic by 30s and degrade mainly below ~5s, and this input is
 * voiced-only, so the window is close to 30s of real speech (assembleVoiced
 * does splice 200ms between segments, so a backchannel-heavy speaker loses a
 * little of it).
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
