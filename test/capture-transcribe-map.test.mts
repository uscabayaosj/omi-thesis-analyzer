import { test } from "node:test";
import assert from "node:assert/strict";
import { utterancesToSegments } from "../src/lib/capture/transcribe-map.ts";

const map = [
  { outStartMs: 0, outEndMs: 2000, absStartMs: 100_000 },
  { outStartMs: 2400, outEndMs: 4400, absStartMs: 200_000 },
];

test("utterance times map through the offset map to seconds from conversation start", () => {
  const segs = utterancesToSegments(
    [
      { start: 0.5, end: 1.5, transcript: "hello there", speaker: 0 },
      { start: 2.6, end: 3.1, transcript: "hi", speaker: 1 },
    ],
    map,
    100_000,
  );
  assert.deepEqual(segs, [
    { text: "hello there", speaker_id: 0, start: 0.5, end: 1.5 },
    { text: "hi", speaker_id: 1, start: 100.2, end: 100.7 },
  ]);
});

test("empty transcripts are dropped and a missing speaker becomes 0", () => {
  const segs = utterancesToSegments(
    [{ start: 0, end: 1, transcript: "  " }, { start: 1, end: 2, transcript: "ok" }],
    map,
    100_000,
  );
  assert.deepEqual(segs, [{ text: "ok", speaker_id: 0, start: 1, end: 2 }]);
});
