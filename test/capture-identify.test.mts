import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleVoiced } from "../src/lib/capture/assemble.ts";
import {
  int16ToFloat32,
  cosineSimilarity,
  averageEmbeddings,
  groupBySpeaker,
  bestMatch,
  extractSpeakerPcm,
} from "../src/lib/capture/identify.ts";

test("int16ToFloat32 normalizes to [-1, 1)", () => {
  const out = int16ToFloat32(new Int16Array([0, 32767, -32768]));
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[1] - 32767 / 32768) < 1e-9);
  assert.equal(out[2], -1);
});

test("cosineSimilarity is 1 for identical vectors, 0 for orthogonal", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity throws on mismatched lengths", () => {
  assert.throws(() => cosineSimilarity([1, 2], [1]));
});

test("cosineSimilarity is 0 for a zero vector rather than NaN", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("averageEmbeddings starts fresh with no prior embedding", () => {
  assert.deepEqual(averageEmbeddings(undefined, 0, [1, 2, 3]), { embedding: [1, 2, 3], count: 1 });
});

test("averageEmbeddings weights by prior sample count", () => {
  assert.deepEqual(averageEmbeddings([2, 4], 1, [4, 8]), { embedding: [3, 6], count: 2 });
});

test("averageEmbeddings restarts if embedding length changed", () => {
  assert.deepEqual(averageEmbeddings([1, 2], 3, [1, 2, 3]), { embedding: [1, 2, 3], count: 1 });
});

test("groupBySpeaker groups in first-appearance order and totals duration", () => {
  const segs = [
    { text: "a", speaker_id: 1, start: 0, end: 1 },
    { text: "b", speaker_id: 0, start: 1, end: 1.5 },
    { text: "c", speaker_id: 1, start: 1.5, end: 3 },
  ];
  const groups = groupBySpeaker(segs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].speakerId, 1);
  assert.equal(groups[0].segments.length, 2);
  assert.ok(Math.abs(groups[0].totalMs - 2500) < 1e-6);
  assert.equal(groups[1].speakerId, 0);
  assert.ok(Math.abs(groups[1].totalMs - 500) < 1e-6);
});

test("bestMatch picks the highest score at or above threshold", () => {
  const gallery = [
    { personId: "a", embedding: [1, 0] },
    { personId: "b", embedding: [0.9, 0.1] },
  ];
  assert.deepEqual(bestMatch([1, 0], gallery, 0.5), { personId: "a", score: 1 });
});

test("bestMatch returns null below threshold or with an empty gallery", () => {
  assert.equal(bestMatch([1, 0], [{ personId: "a", embedding: [0, 1] }], 0.5), null);
  assert.equal(bestMatch([1, 0], [], 0.5), null);
});

test("extractSpeakerPcm slices a speaker's segments back out of the assembled buffer", () => {
  const s = (ms: number) => Math.round((ms / 1000) * 16000);
  const piece = (absStartMs: number, ms: number, fill: number) => ({
    span: { chunkId: "c", startMs: absStartMs, endMs: absStartMs + ms },
    pcm: new Int16Array(s(ms)).fill(fill),
  });
  const conversationStartMs = 5_000; // matches the first piece's absStartMs
  const assembled = assembleVoiced([piece(5_000, 1000, 7), piece(10_000, 1000, 9)], 400);
  const cluster = { speakerId: 0, segments: [{ start: 0, end: 1 }], totalMs: 1000 };
  const pcm = extractSpeakerPcm(assembled, conversationStartMs, cluster);
  assert.equal(pcm.length, s(1000));
  assert.ok(pcm.every((v) => v === 7));
});
