import type { Conversation as OmiConversation, TranscriptSegment } from "../omi-api";

/** The row shape of TRACE's own `conversations` table (spec §4). */
export interface ConversationRow {
  id: string;
  source: "omi" | "trace";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  transcript_segments: unknown[];
  structured: unknown | null;
  geolocation: unknown | null;
  session_id: string | null;
  word_count: number;
  audio_refs: string[] | null;
}

export function countWords(segments: { text?: string }[]): number {
  let n = 0;
  for (const s of segments) {
    const t = s.text?.trim();
    if (t) n += t.split(/\s+/).length;
  }
  return n;
}

/** Ids are preserved so every stored analysis and enrichment stays attached. */
export function omiToRow(c: OmiConversation): ConversationRow {
  const segments: TranscriptSegment[] = c.transcript_segments ?? [];
  return {
    id: c.id,
    source: "omi",
    created_at: c.created_at,
    started_at: c.started_at ?? null,
    finished_at: c.finished_at ?? null,
    transcript_segments: segments,
    structured: c.structured ?? null,
    geolocation: c.geolocation ?? null,
    session_id: null,
    word_count: countWords(segments),
    audio_refs: null,
  };
}
