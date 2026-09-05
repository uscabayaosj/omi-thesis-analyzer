import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleVoiced, outToAbsMs, encodeWav } from "../src/lib/capture/assemble.ts";

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
