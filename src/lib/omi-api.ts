import type { Conversation } from "./conversation-types";

const OMI_BASE = "https://api.omi.me/v1/dev";
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
