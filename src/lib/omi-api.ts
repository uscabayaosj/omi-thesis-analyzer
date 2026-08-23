const OMI_BASE = "https://api.omi.me/v1/dev";

export interface TranscriptSegment {
  id?: string;
  text: string;
  speaker_id?: number;
  speaker_name?: string;
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

export interface OmiGeolocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  location_name?: string;
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
  geolocation?: OmiGeolocation | null;
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

const OMI_TIMEOUT_MS = 30_000;

async function omiFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const apiKey = process.env.OMI_API_KEY;
  if (!apiKey) throw new Error("OMI_API_KEY not set");

  const url = new URL(`${OMI_BASE}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(OMI_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(`Omi API request timed out after ${OMI_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 500);
    throw new Error(`Omi API ${res.status}: ${body}`);
  }
  return res.json();
}

export async function getConversations(limit = 25, offset = 0): Promise<Conversation[]> {
  return omiFetch<Conversation[]>("/user/conversations", {
    limit: String(limit),
    offset: String(offset),
    include_transcript: "false",
  });
}

export async function getConversation(id: string): Promise<Conversation> {
  return omiFetch<Conversation>(`/user/conversations/${encodeURIComponent(id)}`, {
    include_transcript: "true",
  });
}

export function segmentsToText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => {
      const speaker = s.speaker_name || `Speaker ${s.speaker_id ?? 0}`;
      return `${speaker}: ${s.text}`;
    })
    .join("\n");
}
