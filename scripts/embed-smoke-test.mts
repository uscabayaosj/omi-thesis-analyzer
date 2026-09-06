import { embedAudio } from "../src/lib/capture/embed.ts";
import { cosineSimilarity } from "../src/lib/capture/identify.ts";

function tone(freqHz: number, seconds: number, sampleRate = 16000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 0.5;
  return out;
}

const a1 = await embedAudio(tone(220, 2));
const a2 = await embedAudio(tone(220, 2));
const b = await embedAudio(tone(880, 2));

console.log("same-tone similarity (expect high):", cosineSimilarity(a1, a2));
console.log("different-tone similarity (expect lower):", cosineSimilarity(a1, b));
console.log("embedding length:", a1.length);
