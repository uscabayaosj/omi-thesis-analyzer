import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";
import { ENRICH_CLAMP_CHARS, toEnrichment, type Enrichment } from "./enrich-core";

/**
 * The enrichment pass — TRACE's replacement for the Omi post-processing that
 * custom-STT conversations no longer receive (BasedHardware/omi#7690): a
 * title, a short overview, and a junk verdict, produced once per conversation
 * and cached by the caller. Pure helpers live in enrich-core.ts.
 */

export { JUNK_WORD_FLOOR, ENRICH_CLAMP_CHARS, countTranscriptWords, toEnrichment } from "./enrich-core";
export type { Enrichment } from "./enrich-core";

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
