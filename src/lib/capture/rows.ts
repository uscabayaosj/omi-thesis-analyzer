/** The row shape of TRACE's own `conversations` table (spec §4). Kept
 *  dependency-free so tests can import it directly. */
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
