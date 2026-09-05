// Usage: node scripts/capture-replay.mts path/to/chunk.trch [thresholdDbfs]
// Parses → decodes → runs VAD on one chunk and prints the spans it finds.
// This is how CAPTURE_VAD_DBFS gets tuned against real pendant audio.
import { readFileSync } from "node:fs";
import { parseChunk } from "../src/lib/capture/container.ts";
import { decodeChunk } from "../src/lib/capture/decode.ts";
import { detectSpeech, VAD_DEFAULTS, windowDbfs } from "../src/lib/capture/vad.ts";

const [file, thresholdArg] = process.argv.slice(2);
if (!file) {
  console.error("usage: capture-replay <chunk.trch> [thresholdDbfs]");
  process.exit(2);
}
const threshold = thresholdArg ? Number(thresholdArg) : VAD_DEFAULTS.thresholdDbfs;
const chunk = parseChunk(new Uint8Array(readFileSync(file)));
const pcm = decodeChunk(chunk);
console.log(
  `codec 0x${chunk.codec.toString(16)} · ${chunk.frames.length} frames · ${chunk.durationMs} ms · started ${new Date(chunk.startedAtMs).toISOString()}`
);
console.log(`overall level ${windowDbfs(pcm, 0, pcm.length).toFixed(1)} dBFS · threshold ${threshold} dBFS`);
const spans = detectSpeech(pcm, { thresholdDbfs: threshold });
const voiced = spans.reduce((n, s) => n + s.endMs - s.startMs, 0);
console.log(`${spans.length} spans, ${voiced} ms voiced (${((100 * voiced) / Math.max(1, chunk.durationMs)).toFixed(0)}%)`);
for (const s of spans) console.log(`  ${s.startMs}–${s.endMs} ms`);
