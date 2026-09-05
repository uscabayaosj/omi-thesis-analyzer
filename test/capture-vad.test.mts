import { test } from "node:test";
import assert from "node:assert/strict";
import { detectSpeech, windowDbfs, levelStats, VAD_DEFAULTS } from "../src/lib/capture/vad.ts";

const SR = 16000;
/** ms → samples */
const s = (ms: number) => Math.round((ms / 1000) * SR);

/** Builds PCM: silence, then a tone at `amp` for `toneMs`, then silence. */
function toneBetween(preMs: number, toneMs: number, postMs: number, amp = 8000): Int16Array {
  const pcm = new Int16Array(s(preMs + toneMs + postMs));
  for (let i = s(preMs); i < s(preMs + toneMs); i++) {
    pcm[i] = Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / SR));
  }
  return pcm;
}

test("windowDbfs: digital silence is -Infinity, full scale is ~0", () => {
  assert.equal(windowDbfs(new Int16Array(320), 0, 320), -Infinity);
  const full = new Int16Array(320).fill(32767);
  assert.ok(Math.abs(windowDbfs(full, 0, 320)) < 0.01);
});

test("a 2 s tone in 6 s of silence yields one padded span", () => {
  const spans = detectSpeech(toneBetween(2000, 2000, 2000));
  assert.equal(spans.length, 1);
  // start: tone at 2000, minus pad 300 → ~1700 (the 3-window start latency sits inside the pad)
  assert.ok(spans[0].startMs >= 1650 && spans[0].startMs <= 1760, `start ${spans[0].startMs}`);
  // end: tone ends 4000, hangover 800 then pad 300 → ≤ 5100
  assert.ok(spans[0].endMs >= 4000 && spans[0].endMs <= 5100, `end ${spans[0].endMs}`);
});

test("silence yields no spans; a blip shorter than minSpanMs is dropped", () => {
  assert.deepEqual(detectSpeech(new Int16Array(s(3000))), []);
  // With hangover and pad zeroed, an 80 ms blip is well under the 500 ms floor.
  const blip = toneBetween(1000, 80, 1000);
  assert.deepEqual(detectSpeech(blip, { hangoverMs: 0, padMs: 0 }), []);
});

test("two utterances separated by more than the hangover are two spans", () => {
  const a = toneBetween(500, 1000, 0);
  const gap = new Int16Array(s(2000));
  const b = toneBetween(0, 1000, 500);
  const pcm = new Int16Array(a.length + gap.length + b.length);
  pcm.set(a, 0); pcm.set(gap, a.length); pcm.set(b, a.length + gap.length);
  const spans = detectSpeech(pcm);
  assert.equal(spans.length, 2);
  assert.ok(spans[0].endMs < spans[1].startMs);
});

test("spans are clamped to the buffer and never overlap after padding", () => {
  const pcm = toneBetween(100, 500, 100); // tone right up against both edges
  const spans = detectSpeech(pcm);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].startMs, 0);
  assert.equal(spans[0].endMs, 700);
  assert.equal(VAD_DEFAULTS.thresholdDbfs, -45);
});

test("levelStats reports the floor and the peaks of a half-silent buffer", () => {
  const stats = levelStats(toneBetween(1000, 1000, 0));
  assert.equal(stats.p10, -100, "silent half clamps to -100");
  assert.ok(stats.p90 > -20 && stats.p90 < 0, `loud half ${stats.p90}`);
  assert.deepEqual(levelStats(new Int16Array(0)), { p10: -100, p50: -100, p90: -100 });
});
