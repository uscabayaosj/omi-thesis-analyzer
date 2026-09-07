import { test } from "node:test";
import assert from "node:assert/strict";
import { capSpeakerSegments, CLIP_MAX_MS } from "../src/lib/capture/clip.ts";

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
