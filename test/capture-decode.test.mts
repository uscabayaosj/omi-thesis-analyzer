import { test } from "node:test";
import assert from "node:assert/strict";
import OpusScript from "opusscript";
import { decodeFrames } from "../src/lib/capture/decode.ts";
import { windowDbfs } from "../src/lib/capture/vad.ts";

const SR = 16000;

/** Real Opus packets: a 440 Hz tone encoded by libopus itself. */
function encodeTone(frameSamples: 160 | 320, frames: number): Uint8Array[] {
  const enc = new OpusScript(SR, 1, OpusScript.Application.VOIP);
  const out: Uint8Array[] = [];
  for (let f = 0; f < frames; f++) {
    const pcm = new Int16Array(frameSamples);
    for (let i = 0; i < frameSamples; i++) {
      pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * (f * frameSamples + i)) / SR));
    }
    out.push(new Uint8Array(enc.encode(Buffer.from(pcm.buffer), frameSamples)));
  }
  enc.delete();
  return out;
}

test("decodes 20 ms (0x15) frames to 320 samples each, loud", () => {
  const pcm = decodeFrames(encodeTone(320, 25), 0x15);
  assert.equal(pcm.length, 25 * 320);
  assert.ok(windowDbfs(pcm, 320 * 5, 320 * 25) > -30, "decoded tone should be loud");
});

test("decodes 10 ms (0x14) frames to 160 samples each", () => {
  const pcm = decodeFrames(encodeTone(160, 50), 0x14);
  assert.equal(pcm.length, 50 * 160);
});

test("a corrupt frame becomes silence of the frame length, not a crash", () => {
  const good = encodeTone(320, 3);
  const frames = [good[0], new Uint8Array([0xff, 0x00, 0x13]), good[2]];
  const pcm = decodeFrames(frames, 0x15);
  assert.equal(pcm.length, 3 * 320);
  assert.equal(decodeFrames.lastDropped, 1);
});
