// Maps internal/upstream errors to user-facing messages so raw API bodies
// (which may include upstream status codes and payloads) never reach the UI.

export interface FriendlyError {
  error: string;
  status: number;
}

export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof SyntaxError) {
    return { error: "The request could not be read. Please try again.", status: 400 };
  }

  const raw = err instanceof Error ? err.message : String(err);

  if (raw.includes("OMI_API_KEY")) {
    return { error: "Omi is not configured. Set OMI_API_KEY in your environment.", status: 500 };
  }
  if (raw.includes("Omi API 404")) {
    return { error: "That conversation no longer exists on Omi. It may have been deleted.", status: 404 };
  }
  if (raw.includes("Omi API 401") || raw.includes("Omi API 403")) {
    return { error: "Omi rejected the request. Check that OMI_API_KEY is valid.", status: 502 };
  }
  if (raw.includes("Omi API 429")) {
    return { error: "Omi is rate-limiting requests. Wait a moment and try again.", status: 429 };
  }
  if (raw.includes("Omi API")) {
    return { error: "Could not reach Omi. Check your connection and OMI_API_KEY, then try again.", status: 502 };
  }
  if (raw.includes("API key not set")) {
    return { error: "AI provider is not configured. Set the API key for your AI_PROVIDER in .env.local.", status: 500 };
  }
  if (raw.includes("Unknown AI_PROVIDER")) {
    return { error: "AI_PROVIDER is set to an unknown value. Use openai, anthropic, google, or openrouter.", status: 500 };
  }
  if (raw.includes("API 401") || raw.includes("API 403")) {
    return { error: "AI service authentication failed. Check your API key.", status: 502 };
  }
  if (raw.includes("429") || raw.toLowerCase().includes("rate")) {
    return { error: "AI service is busy. Please wait a moment and try again.", status: 429 };
  }
  if (raw.includes("timed out") || raw.includes("timeout") || raw.includes("ETIMEDOUT") || raw.includes("aborted")) {
    return { error: "The request took too long. Try again, or analyze a shorter conversation.", status: 504 };
  }
  if (raw.includes("did not return valid JSON")) {
    return { error: "The AI returned an unreadable response. Re-run the analysis.", status: 502 };
  }
  if (raw.includes("fetch failed") || raw.includes("ENOTFOUND") || raw.includes("ECONNREFUSED")) {
    return { error: "Could not reach an upstream service. Check your connection and try again.", status: 502 };
  }

  return { error: "Something went wrong. Please try again.", status: 500 };
}
