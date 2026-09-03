/**
 * The pure half of the enrichment pass — types, the junk word floor, and the
 * reply coercion — kept dependency-free (like merge.ts) so node --test can
 * import it directly without resolving the app's extensionless import graph.
 * The LLM call itself lives in enrich.ts.
 */

import type { TranscriptSegment } from "./omi-api";

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
