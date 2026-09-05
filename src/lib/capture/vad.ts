import type { Span } from "./types";

/**
 * Energy-based voice activity detection. Deliberately simple: a pendant mic
 * close to the wearer gives a large level gap between speech and room noise,
 * and every knob here is an env-tunable server setting (spec §3) rather than
 * anything shipped to the phone.
 */

export interface VadOptions {
  sampleRate: number;
  windowMs: number;
  thresholdDbfs: number;
  /** Consecutive windows over threshold before speech is declared. */
  startWindows: number;
  /** Silence required (ms) before speech is declared over. */
  hangoverMs: number;
  /** Padding added to both ends of every span (ms). */
  padMs: number;
  /** Spans shorter than this after padding are dropped (ms). */
  minSpanMs: number;
}

export const VAD_DEFAULTS: VadOptions = {
  sampleRate: 16000,
  windowMs: 20,
  thresholdDbfs: -45,
  startWindows: 3,
  hangoverMs: 800,
  padMs: 300,
  minSpanMs: 500,
};

/** RMS level of pcm[from, to) in dBFS; -Infinity for digital silence. */
export function windowDbfs(pcm: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
  const n = to - from;
  if (n === 0 || sum === 0) return -Infinity;
  return 20 * Math.log10(Math.sqrt(sum / n) / 32768);
}

export function detectSpeech(pcm: Int16Array, overrides: Partial<VadOptions> = {}): Span[] {
  const o = { ...VAD_DEFAULTS, ...overrides };
  const win = Math.round((o.sampleRate * o.windowMs) / 1000);
  const totalMs = (pcm.length / o.sampleRate) * 1000;
  const raw: Span[] = [];
  let over = 0;
  let inSpeech = false;
  let spanStart = 0;
  let silentSince = -1;

  for (let i = 0; i + win <= pcm.length; i += win) {
    const ms = (i / o.sampleRate) * 1000;
    const loud = windowDbfs(pcm, i, i + win) >= o.thresholdDbfs;
    if (!inSpeech) {
      over = loud ? over + 1 : 0;
      if (over >= o.startWindows) {
        inSpeech = true;
        spanStart = ms - (o.startWindows - 1) * o.windowMs;
        silentSince = -1;
      }
    } else if (loud) {
      silentSince = -1;
    } else {
      if (silentSince < 0) silentSince = ms;
      if (ms - silentSince >= o.hangoverMs) {
        raw.push({ startMs: spanStart, endMs: silentSince + o.hangoverMs });
        inSpeech = false;
        over = 0;
      }
    }
  }
  if (inSpeech) raw.push({ startMs: spanStart, endMs: silentSince >= 0 ? silentSince + o.hangoverMs : totalMs });

  // Pad, clamp, merge overlaps, drop the too-short.
  const out: Span[] = [];
  for (const r of raw) {
    const s = Math.max(0, r.startMs - o.padMs);
    const e = Math.min(totalMs, r.endMs + o.padMs);
    const last = out[out.length - 1];
    if (last && s <= last.endMs) last.endMs = Math.max(last.endMs, e);
    else out.push({ startMs: s, endMs: e });
  }
  return out.filter((sp) => sp.endMs - sp.startMs >= o.minSpanMs);
}

export interface LevelStats {
  /** dBFS of the quietest tenth of windows — the noise floor. */
  p10: number;
  p50: number;
  /** dBFS of the loudest tenth — where speech peaks sit. */
  p90: number;
}

/** Window-level loudness percentiles, for tuning `thresholdDbfs` against a
 *  real device without pulling audio out of the archive. -Infinity windows
 *  (digital silence) are clamped to -100 so percentiles stay numeric. */
export function levelStats(pcm: Int16Array, sampleRate = VAD_DEFAULTS.sampleRate, windowMs = VAD_DEFAULTS.windowMs): LevelStats {
  const win = Math.round((sampleRate * windowMs) / 1000);
  const levels: number[] = [];
  for (let i = 0; i + win <= pcm.length; i += win) levels.push(Math.max(-100, windowDbfs(pcm, i, i + win)));
  if (levels.length === 0) return { p10: -100, p50: -100, p90: -100 };
  levels.sort((a, b) => a - b);
  const at = (q: number) => Math.round(levels[Math.min(levels.length - 1, Math.floor(q * levels.length))] * 10) / 10;
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}
