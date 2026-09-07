import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleVoiced,
  outToAbsMs,
  absToOutMs,
  encodeWav,
  spansOverlappingRanges,
  stitchWantedAudio,
  type DecodedChunkPcm,
} from "../src/lib/capture/assemble.ts";
import type { AbsSpan } from "../src/lib/capture/types.ts";

const s = (ms: number) => Math.round((ms / 1000) * 16000);
const piece = (absStartMs: number, ms: number, fill: number) => ({
  span: { chunkId: "c", startMs: absStartMs, endMs: absStartMs + ms },
  pcm: new Int16Array(s(ms)).fill(fill),
});

test("pieces are concatenated in time order with a gap between them", () => {
  const a = assembleVoiced([piece(10_000, 1000, 2), piece(5_000, 500, 1)], 400);
  assert.equal(a.pcm.length, s(500) + s(400) + s(1000));
  assert.equal(a.pcm[0], 1);
  assert.equal(a.pcm[s(500) + s(200)], 0, "gap is silence");
  assert.equal(a.pcm[s(500) + s(400)], 2);
  assert.deepEqual(a.map, [
    { outStartMs: 0, outEndMs: 500, absStartMs: 5_000 },
    { outStartMs: 900, outEndMs: 1900, absStartMs: 10_000 },
  ]);
});

test("outToAbsMs maps inside pieces and snaps inside gaps", () => {
  const { map } = assembleVoiced([piece(5_000, 500, 1), piece(10_000, 1000, 2)], 400);
  assert.equal(outToAbsMs(map, 0), 5_000);
  assert.equal(outToAbsMs(map, 250), 5_250);
  assert.equal(outToAbsMs(map, 700), 5_500); // in the gap → end of piece 1
  assert.equal(outToAbsMs(map, 1_000), 10_100);
  assert.equal(outToAbsMs(map, 5_000), 11_000); // past the end → end of last piece
});

test("encodeWav writes a valid 44-byte header for 16 kHz mono PCM16", () => {
  const wav = encodeWav(new Int16Array([0, 1, -1]));
  assert.equal(wav.length, 44 + 6);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), "WAVE");
  const v = new DataView(wav.buffer);
  assert.equal(v.getUint32(24, true), 16000); // sample rate
  assert.equal(v.getUint16(22, true), 1); // channels
  assert.equal(v.getUint16(34, true), 16); // bits
  assert.equal(v.getUint32(40, true), 6); // data bytes
  assert.equal(v.getInt16(46, true), 1);
  assert.equal(v.getInt16(48, true), -1);
});

test("absToOutMs is the inverse of outToAbsMs", () => {
  const { map } = assembleVoiced([piece(5_000, 500, 1), piece(10_000, 1000, 2)], 400);
  assert.equal(absToOutMs(map, 5_000), 0);
  assert.equal(absToOutMs(map, 5_250), 250);
  assert.equal(absToOutMs(map, 5_500), 500); // end of piece 1
  assert.equal(absToOutMs(map, 7_000), 500); // in the real-time gap → snaps to end of piece 1
  assert.equal(absToOutMs(map, 10_100), 1_000);
  assert.equal(absToOutMs(map, 20_000), 1_900); // past the end → end of last piece
});

// ── targeted assembly (spansOverlappingRanges / stitchWantedAudio) ──
//
// Pure logic behind the targeted-assembly path (assembleTargetedAudio /
// decodeChunksForRanges in pipeline.ts), used by speaker-audio, enroll-voice
// and cluster-voices to decode only the chunks a wanted speaker actually
// touches instead of a whole session. Everything here works in absolute
// wall-clock ms, deliberately never OffsetMapEntry coordinates — see the
// "Targeted assembly" comment above stitchWantedAudio's definition for why
// reusing those against a decoded subset would silently misalign.

const chunk = (startedAtMs: number, durationMs: number, fill: number): DecodedChunkPcm => ({
  startedAtMs,
  pcm: new Int16Array(s(durationMs)).fill(fill),
});

test("spansOverlappingRanges keeps only spans that overlap a wanted range", () => {
  const spans: AbsSpan[] = [
    { chunkId: "c1", startMs: 1_000, endMs: 2_000 },
    { chunkId: "c2", startMs: 5_000, endMs: 6_000 },
    { chunkId: "c3", startMs: 9_000, endMs: 9_500 }, // touches no range below
  ];
  const ranges = [
    { startMs: 1_500, endMs: 1_800 },
    { startMs: 5_900, endMs: 6_200 },
  ];
  assert.deepEqual(spansOverlappingRanges(spans, ranges), [spans[0], spans[1]]);
});

test("spansOverlappingRanges returns nothing for a range with no overlapping span", () => {
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 1_000, endMs: 2_000 }];
  assert.deepEqual(spansOverlappingRanges(spans, [{ startMs: 100_000, endMs: 100_100 }]), []);
});

test("spansOverlappingRanges returns nothing for an empty range list", () => {
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 1_000, endMs: 2_000 }];
  assert.deepEqual(spansOverlappingRanges(spans, []), []);
});

test("stitchWantedAudio: a range fully inside one chunk", () => {
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 0, endMs: 2_000 }];
  const decoded = new Map([["c1", chunk(0, 2_000, 3)]]);
  const out = stitchWantedAudio(decoded, spans, [{ startMs: 500, endMs: 1_000 }]);
  assert.equal(out.length, s(500));
  assert.ok(out.every((v) => v === 3));
});

test("stitchWantedAudio: a range spanning two chunks joins the real audio with no filler", () => {
  const spans: AbsSpan[] = [
    { chunkId: "c1", startMs: 0, endMs: 1_000 },
    { chunkId: "c2", startMs: 1_000, endMs: 2_000 },
  ];
  const decoded = new Map([
    ["c1", chunk(0, 1_000, 7)],
    ["c2", chunk(1_000, 1_000, 9)],
  ]);
  // Straddles the 1_000ms boundary: 200ms from c1, 300ms from c2.
  const out = stitchWantedAudio(decoded, spans, [{ startMs: 800, endMs: 1_300 }]);
  assert.equal(out.length, s(200) + s(300));
  assert.ok(out.subarray(0, s(200)).every((v) => v === 7), "c1's tail, unpadded");
  assert.ok(out.subarray(s(200)).every((v) => v === 9), "c2's head, joined directly — no synthetic gap");
});

test("stitchWantedAudio: a range with no overlapping span contributes nothing (not silence)", () => {
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 0, endMs: 1_000 }];
  const decoded = new Map([["c1", chunk(0, 1_000, 5)]]);
  const out = stitchWantedAudio(decoded, spans, [
    { startMs: 5_000, endMs: 5_200 }, // no span here
    { startMs: 100, endMs: 300 },
  ]);
  // Only the second range produced audio; no gap is spent on the empty one.
  assert.equal(out.length, s(200));
  assert.ok(out.every((v) => v === 5));
});

test("stitchWantedAudio: ranges out of order are stitched in time order", () => {
  const spans: AbsSpan[] = [
    { chunkId: "later", startMs: 5_000, endMs: 5_200 },
    { chunkId: "earlier", startMs: 0, endMs: 200 },
  ];
  const decoded = new Map([
    ["later", chunk(5_000, 200, 4)],
    ["earlier", chunk(0, 200, 2)],
  ]);
  // Passed later-range-first, on purpose.
  const out = stitchWantedAudio(
    decoded,
    spans,
    [
      { startMs: 5_000, endMs: 5_200 },
      { startMs: 0, endMs: 200 },
    ],
    400
  );
  assert.equal(out.length, s(200) + s(400) + s(200));
  assert.ok(out.subarray(0, s(200)).every((v) => v === 2), "earlier range comes first");
  assert.ok(out.subarray(s(200), s(200) + s(400)).every((v) => v === 0), "gap is silence");
  assert.ok(out.subarray(s(200) + s(400)).every((v) => v === 4), "later range comes last");
});

test("stitchWantedAudio clamps to a chunk whose decoded PCM is shorter than its span", () => {
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 0, endMs: 2_000 }]; // span claims 2s...
  const decoded = new Map([["c1", chunk(0, 1_000, 6)]]); // ...but only 1s actually decoded
  const out = stitchWantedAudio(decoded, spans, [{ startMs: 0, endMs: 2_000 }]);
  assert.equal(out.length, s(1_000), "clamped to what was actually decoded, not the span's claimed end");
  assert.ok(out.every((v) => v === 6));
});

test("stitchWantedAudio returns an empty buffer for an empty range list", () => {
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 0, endMs: 1_000 }];
  const decoded = new Map([["c1", chunk(0, 1_000, 1)]]);
  assert.equal(stitchWantedAudio(decoded, spans, []).length, 0);
});

test("stitchWantedAudio defaults to a 200ms gap between separate ranges", () => {
  const spans: AbsSpan[] = [
    { chunkId: "a", startMs: 0, endMs: 100 },
    { chunkId: "b", startMs: 1_000, endMs: 1_100 },
  ];
  const decoded = new Map([
    ["a", chunk(0, 100, 1)],
    ["b", chunk(1_000, 100, 1)],
  ]);
  const out = stitchWantedAudio(decoded, spans, [
    { startMs: 0, endMs: 100 },
    { startMs: 1_000, endMs: 1_100 },
  ]);
  assert.equal(out.length, s(100) + s(200) + s(100));
});

test("stitchWantedAudio slices from the CHUNK's origin, not the span's", () => {
  // Every other stitchWantedAudio test here uses a constant-filled chunk whose
  // span starts exactly at the chunk start, so `d.startedAtMs` and
  // `sp.startMs` are the same number and the two are indistinguishable.
  // Swapping them is the highest-consequence bug this function can have: it
  // reads real audio from the wrong place in the chunk, throws nothing, and
  // writes a voiceprint from whatever was actually said there.
  //
  // Here the span deliberately starts 137ms into the chunk and the PCM is a
  // ramp, so every sample names its own index. Correct origin reads at 8000
  // (500ms into the chunk); the wrong one reads at 5808 (363ms into the span)
  // — same LENGTH, different audio, which is why this asserts values.
  const pcm = new Int16Array(16_000);
  for (let i = 0; i < pcm.length; i++) pcm[i] = i;
  const spans: AbsSpan[] = [{ chunkId: "c1", startMs: 30_137, endMs: 31_000 }];
  const decoded = new Map([["c1", { startedAtMs: 30_000, pcm }]]);

  const out = stitchWantedAudio(decoded, spans, [{ startMs: 30_500, endMs: 30_600 }]);

  assert.equal(out.length, s(100));
  assert.equal(out[0], 8_000, "500ms into the chunk, not 363ms into the span");
  assert.equal(out[out.length - 1], 8_000 + s(100) - 1);
});
