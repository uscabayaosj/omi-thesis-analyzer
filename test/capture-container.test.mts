import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChunk, buildChunk, frameMsFor } from "../src/lib/capture/container.ts";

const f = (...b: number[]) => new Uint8Array(b);

test("frame duration follows the codec id from PROTOCOL.md", () => {
  assert.equal(frameMsFor(0x14), 10);
  assert.equal(frameMsFor(0x15), 20);
});

test("build → parse round-trips header and frames", () => {
  const bytes = buildChunk({ codec: 0x15, startedAtMs: 1_757_000_000_123, frames: [f(1, 2, 3), f(9)] });
  const parsed = parseChunk(bytes);
  assert.equal(parsed.codec, 0x15);
  assert.equal(parsed.frameMs, 20);
  assert.equal(parsed.startedAtMs, 1_757_000_000_123);
  assert.deepEqual(parsed.frames.map((x) => Array.from(x)), [[1, 2, 3], [9]]);
  assert.equal(parsed.durationMs, 40);
});

test("header layout is exactly the spec's byte layout", () => {
  const bytes = buildChunk({ codec: 0x14, startedAtMs: 256, frames: [f(7)] });
  assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x54, 0x52, 0x43, 0x48]); // "TRCH"
  assert.equal(bytes[4], 1); // version
  assert.equal(bytes[5], 0x14); // codec
  assert.deepEqual(Array.from(bytes.subarray(6, 8)), [0, 0]); // reserved
  assert.deepEqual(Array.from(bytes.subarray(8, 16)), [0, 1, 0, 0, 0, 0, 0, 0]); // 256 LE
  assert.deepEqual(Array.from(bytes.subarray(16)), [1, 0, 7]); // len=1 LE, frame
});

test("rejects bad magic, version, codec, and truncated frames", () => {
  const good = buildChunk({ codec: 0x14, startedAtMs: 1, frames: [f(1, 2)] });
  const badMagic = Uint8Array.from(good); badMagic[0] = 0x58;
  assert.throws(() => parseChunk(badMagic), /bad chunk: magic/);
  const badVersion = Uint8Array.from(good); badVersion[4] = 2;
  assert.throws(() => parseChunk(badVersion), /bad chunk: version/);
  const badCodec = Uint8Array.from(good); badCodec[5] = 0x01;
  assert.throws(() => parseChunk(badCodec), /bad chunk: codec/);
  assert.throws(() => parseChunk(good.subarray(0, good.length - 1)), /bad chunk: truncated/);
  assert.throws(() => parseChunk(good.subarray(0, 10)), /bad chunk: truncated/);
});

test("an empty chunk parses to zero frames and zero duration", () => {
  const parsed = parseChunk(buildChunk({ codec: 0x14, startedAtMs: 5, frames: [] }));
  assert.equal(parsed.frames.length, 0);
  assert.equal(parsed.durationMs, 0);
});
