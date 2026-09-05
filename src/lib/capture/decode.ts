import OpusScript from "opusscript";
import type { CodecId, ParsedChunk } from "./types";

/**
 * Opus → PCM16 through libopus compiled to WASM. No native module, so it runs
 * unchanged on Vercel functions. One decoder per call: opusscript keeps
 * decoder state, and a session's frames are always decoded chunk by chunk in
 * order, so a fresh decoder per chunk is both correct and leak-proof.
 *
 * Imports only the `opusscript` package (type imports are erased) so the
 * node:test suite can load this file without the app's extensionless graph.
 */

const SAMPLE_RATE = 16000;

/** 0x14 = 10 ms frames, 0x15 = 20 ms (sdks/device/PROTOCOL.md) — mirrors container.ts. */
const frameSamplesFor = (codec: CodecId) => (SAMPLE_RATE * (codec === 0x14 ? 10 : 20)) / 1000;

export function decodeFrames(frames: Uint8Array[], codec: CodecId): Int16Array {
  const frameSamples = frameSamplesFor(codec);
  const out = new Int16Array(frames.length * frameSamples);
  const dec = new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.VOIP);
  let dropped = 0;
  try {
    frames.forEach((frame, i) => {
      try {
        const pcm = dec.decode(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
        const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.min(pcm.byteLength / 2, frameSamples));
        out.set(samples, i * frameSamples);
      } catch {
        dropped++; // leaves this frame's slot as silence
      }
    });
  } finally {
    dec.delete();
  }
  decodeFrames.lastDropped = dropped;
  return out;
}
decodeFrames.lastDropped = 0;

export function decodeChunk(chunk: ParsedChunk): Int16Array {
  return decodeFrames(chunk.frames, chunk.codec);
}
