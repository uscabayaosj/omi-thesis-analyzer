import type { CodecId, ParsedChunk } from "./types";

/**
 * The TRCH chunk container (spec §1). The phone writes it; the server reads
 * it; this module is the only place either side's byte layout is defined.
 */

const MAGIC = [0x54, 0x52, 0x43, 0x48]; // "TRCH"
const VERSION = 1;
const HEADER_BYTES = 16;

export function frameMsFor(codec: CodecId): 10 | 20 {
  return codec === 0x14 ? 10 : 20;
}

function isCodec(v: number): v is CodecId {
  return v === 0x14 || v === 0x15;
}

export function buildChunk(input: { codec: CodecId; startedAtMs: number; frames: Uint8Array[] }): Uint8Array {
  const body = input.frames.reduce((n, f) => n + 2 + f.length, 0);
  const out = new Uint8Array(HEADER_BYTES + body);
  const view = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = VERSION;
  out[5] = input.codec;
  view.setUint16(6, 0, true);
  view.setBigInt64(8, BigInt(input.startedAtMs), true);
  let at = HEADER_BYTES;
  for (const f of input.frames) {
    view.setUint16(at, f.length, true);
    out.set(f, at + 2);
    at += 2 + f.length;
  }
  return out;
}

export function parseChunk(bytes: Uint8Array): ParsedChunk {
  if (bytes.length < HEADER_BYTES) throw new Error("bad chunk: truncated header");
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error("bad chunk: magic");
  }
  if (bytes[4] !== VERSION) throw new Error(`bad chunk: version ${bytes[4]}`);
  const codec = bytes[5];
  if (!isCodec(codec)) throw new Error(`bad chunk: codec 0x${codec.toString(16)}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const startedAtMs = Number(view.getBigInt64(8, true));
  const frames: Uint8Array[] = [];
  let at = HEADER_BYTES;
  while (at < bytes.length) {
    if (at + 2 > bytes.length) throw new Error("bad chunk: truncated frame length");
    const len = view.getUint16(at, true);
    at += 2;
    if (at + len > bytes.length) throw new Error("bad chunk: truncated frame");
    frames.push(bytes.subarray(at, at + len));
    at += len;
  }
  const frameMs = frameMsFor(codec);
  return { codec, frameMs, startedAtMs, frames, durationMs: frames.length * frameMs };
}
