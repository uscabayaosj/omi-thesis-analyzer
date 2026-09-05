import type { DeepgramUtterance } from "./transcribe-map";
import { logTranscriptionUsage } from "../usage";

export { utterancesToSegments, type DeepgramUtterance } from "./transcribe-map";

const DEEPGRAM_URL =
  "https://api.deepgram.com/v1/listen?model=nova-3&diarize=true&smart_format=true&punctuate=true&utterances=true";
const TIMEOUT_MS = 240_000;

/**
 * One prerecorded call per closed session, bytes in the body — the audio never
 * needs a public URL. Utterances (not paragraphs) so timestamps stay tight.
 */
export async function transcribeWav(wav: Uint8Array<ArrayBuffer>): Promise<DeepgramUtterance[]> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY not set");
  const res = await fetch(DEEPGRAM_URL, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
    body: new Blob([wav], { type: "audio/wav" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Deepgram API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as {
    metadata?: { duration?: number };
    results?: { utterances?: DeepgramUtterance[] };
  };
  // Deepgram reports the seconds it billed; fall back to the WAV's own length.
  const audioSeconds = json.metadata?.duration ?? Math.max(0, wav.byteLength - 44) / 32_000;
  void logTranscriptionUsage({ audioSeconds }).catch((e) => console.error("transcription usage logging failed:", e));
  return json.results?.utterances ?? [];
}
