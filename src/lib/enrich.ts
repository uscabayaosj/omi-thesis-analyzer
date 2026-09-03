import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";
import type { TranscriptSegment } from "./omi-api";

/**
 * The enrichment pass — TRACE's replacement for the Omi post-processing that
 * custom-STT conversations no longer receive (BasedHardware/omi#7690): a
 * title, a short overview, and a junk verdict, produced once per conversation
 * and cached by the caller.
 */

export interface Enrichment {
  /** True when the recording is noise with no recoverable subject matter. */
  junk: boolean;
  junk_reason: string;
  title: string;
  overview: string;
}

/** Below this many transcript words a recording is junk by definition and the
 *  route answers without spending an LLM call. Strictly-below is junk. */
export const JUNK_WORD_FLOOR = 25;

/** A name doesn't need the whole conversation. Input tokens are this feature's
 *  entire cost, so the pass reads only the opening — enough to name, summarize,
 *  and junk-classify (real junk is short; anything long enough to truncate here
 *  is by definition not junk). */
export const ENRICH_CLAMP_CHARS = 4000;

export function countTranscriptWords(segments: TranscriptSegment[]): number {
  let n = 0;
  for (const s of segments) {
    const t = s.text?.trim();
    if (t) n += t.split(/\s+/).length;
  }
  return n;
}

/** Never throws. `junk` must be literally `true` to count: a malformed reply
 *  can only over-show a conversation, never hide one. */
export function toEnrichment(raw: Record<string, unknown>): Enrichment {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return {
    junk: raw.junk === true,
    junk_reason: str(raw.junk_reason),
    title: str(raw.title),
    overview: str(raw.overview),
  };
}

const ENRICH_SYSTEM_PROMPT = `You name conversations captured by a wearable microphone. The transcript comes from speech-to-text and may have errors and imperfect speaker labels.

You MUST respond with valid JSON matching this exact schema:
{
  "junk": boolean,
  "junk_reason": "one short clause when junk is true, else \\"\\"",
  "title": "at most 8 words",
  "overview": "1-2 plain sentences"
}

Rules:
- junk is true ONLY when the recording is noise with no recoverable subject matter: TV/radio/background speech not involving the wearer, a few stray words, or speech-to-text garbage. A short but real exchange is NOT junk.
- title names the actual subject, concretely: "Fence repair plan with Dale", not "A conversation about ranching". No quotation marks, no trailing period.
- overview is 1-2 plain sentences on what was discussed and decided, written the way a trusted friend would describe it. No corporate language.
- When junk is true, still fill title and overview with your best short description of what the noise was.`;

export async function enrichConversation(transcript: string, date: string): Promise<Enrichment> {
  const content = await chatCompletion(
    [
      { role: "system", content: ENRICH_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Conversation date: ${date}\n\nTranscript (may be truncated):\n${clampTranscript(transcript, ENRICH_CLAMP_CHARS)}`,
      },
    ],
    true,
    "enrich"
  );
  return toEnrichment(extractJsonObject(content));
}
