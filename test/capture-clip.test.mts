import { test } from "node:test";
import assert from "node:assert/strict";
import {
  capSpeakerSegments,
  CLIP_MAX_MS,
  capPcmForEmbedding,
  EMBED_MAX_SAMPLES,
  EMBED_MAX_MS,
} from "../src/lib/capture/clip.ts";

test("CLIP_MAX_MS is 15 seconds", () => {
  assert.equal(CLIP_MAX_MS, 15_000);
});

test("takes leading segments until the cap is reached", () => {
  const segs = [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
    { start: 10, end: 20 },
    { start: 21, end: 25 },
  ];
  assert.deepEqual(capSpeakerSegments(segs, 10_000), segs.slice(0, 3));
});

test("stops exactly at the boundary without taking one more", () => {
  const segs = [
    { start: 0, end: 5 },
    { start: 5, end: 10 },
    { start: 10, end: 15 },
  ];
  assert.deepEqual(capSpeakerSegments(segs, 10_000), segs.slice(0, 2));
});

test("always returns at least one segment, even if it exceeds the cap", () => {
  const segs = [{ start: 0, end: 90 }];
  assert.deepEqual(capSpeakerSegments(segs, 15_000), segs);
});

test("an empty cluster caps to nothing", () => {
  assert.deepEqual(capSpeakerSegments([], 15_000), []);
});

test("ignores segments with no positive duration", () => {
  const segs = [
    { start: 0, end: 0 },
    { start: 1, end: 20 },
  ];
  assert.deepEqual(capSpeakerSegments(segs, 15_000), segs);
});

// ── embedding input cap ──
//
// Regression: enroll-voice and cluster-voices were SIGKILLed (exit 137) in
// production. Every embedAudio call site fed WavLM a speaker's ENTIRE cluster.
// The feature extractor downsamples 16kHz by 320x and self-attention is
// quadratic in the resulting frames, so a 20-minute speaker (19.2M samples ->
// 60k frames) needs a ~14GB attention matrix. Bounding the input is the fix;
// no instance size survives an unbounded one.

test("EMBED_MAX_SAMPLES is 30s at 16kHz", () => {
  assert.equal(EMBED_MAX_SAMPLES, 30 * 16_000);
});

// ── segment budget derived from the embedding sample cap ──
//
// enroll-voice and cluster-voices now cap a speaker's SEGMENTS to this many
// ms before decoding any audio (targeted assembly), instead of decoding the
// whole cluster and relying on capPcmForEmbedding to truncate it afterward.
// This must be derived from EMBED_MAX_SAMPLES, not a second hand-picked
// constant, or the two can silently drift apart.

test("EMBED_MAX_MS is EMBED_MAX_SAMPLES expressed in milliseconds", () => {
  assert.equal(EMBED_MAX_MS, 30_000);
  assert.equal(EMBED_MAX_MS, (EMBED_MAX_SAMPLES / 16_000) * 1000);
});

test("capPcmForEmbedding leaves a short clip untouched", () => {
  const pcm = new Float32Array(16_000); // 1s
  assert.equal(capPcmForEmbedding(pcm), pcm, "must not copy when already short");
});

test("capPcmForEmbedding truncates a long clip to the cap", () => {
  const pcm = new Float32Array(20 * 60 * 16_000); // 20 minutes — the OOM case
  assert.equal(capPcmForEmbedding(pcm).length, EMBED_MAX_SAMPLES);
});

test("capPcmForEmbedding keeps the leading samples, not a copy of the tail", () => {
  const pcm = new Float32Array(EMBED_MAX_SAMPLES + 10);
  pcm[0] = 0.5;
  pcm[EMBED_MAX_SAMPLES + 5] = 0.25;
  const out = capPcmForEmbedding(pcm);
  assert.equal(out[0], 0.5);
  assert.equal(out.length, EMBED_MAX_SAMPLES);
});

test("capPcmForEmbedding is exact at the boundary", () => {
  const pcm = new Float32Array(EMBED_MAX_SAMPLES);
  assert.equal(capPcmForEmbedding(pcm).length, EMBED_MAX_SAMPLES);
});

test("capPcmForEmbedding handles an empty buffer", () => {
  assert.equal(capPcmForEmbedding(new Float32Array(0)).length, 0);
});

test("capPcmForEmbedding does not hand back a view onto the uncapped buffer", () => {
  // A subarray would share `buffer` with the 20-minute original, so a consumer
  // reading pcm.buffer would still see every sample and the cap would be a
  // no-op. The truncated result must own exactly its own bytes.
  const pcm = new Float32Array(20 * 60 * 16_000);
  const out = capPcmForEmbedding(pcm);
  assert.equal(out.byteOffset, 0);
  assert.equal(out.buffer.byteLength, EMBED_MAX_SAMPLES * 4);
  assert.notEqual(out.buffer, pcm.buffer);
});
