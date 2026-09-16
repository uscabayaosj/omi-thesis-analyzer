/**
 * The conversation shape every part of TRACE reads — matches the Omi API's
 * response format so data flows through unchanged.
 */

export interface TranscriptSegment {
  id?: string;
  text: string;
  speaker_id?: number;
  speaker_name?: string;
  speaker_person_id?: string;
  start?: number;
  end?: number;
}

export interface ActionItem {
  description: string;
  completed: boolean;
  created_at?: string;
  due_at?: string | null;
}

export interface Structured {
  title: string;
  overview: string;
  emoji?: string;
  category?: string;
  action_items?: ActionItem[];
  events?: unknown[];
}

// Coordinates attached to a conversation from the Omi API. There is no
// human-readable place-name field — `location_type` is a coarse category
// (e.g. "restaurant"), not a name; `address` is the closest.
export interface ConversationGeolocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  location_type?: string;
  google_place_id?: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  language?: string;
  source?: string;
  structured?: Structured;
  transcript_segments?: TranscriptSegment[];
  folder_id?: string;
  folder_name?: string;
  geolocation?: ConversationGeolocation | null;
}

export interface Analysis {
  rq1_documentary_record: string;
  rq2_everyday_practices: string;
  rq3_cskt_intersection: string;
  rq4_wildness_imaginary: string;
  conditions_check: string;
  rival_hypothesis_test: string;
  refutation_signals: string;
  forward_thinking: string;
}

export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const speaker = s.speaker_name || `Speaker ${s.speaker_id ?? 0}`;
      return `${speaker}: ${s.text}`;
    })
    .join("\n");
}
