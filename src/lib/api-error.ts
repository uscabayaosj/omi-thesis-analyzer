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

  if (raw.includes("OMI_API_KEY not set")) {
    return { error: "The OMI API key isn't configured. Add your OMI_API_KEY and reload.", status: 500 };
  }
  if (raw.includes("Omi API 401") || raw.includes("Omi API 403")) {
    return { error: "OMI authentication failed. Check your OMI_API_KEY.", status: 502 };
  }
  if (raw.includes("Omi API")) {
    return { error: "Could not reach the Omi service. Try again in a moment.", status: 502 };
  }
  if (raw.includes("conversation not found")) {
    return { error: "That conversation wasn't found.", status: 404 };
  }
  if (raw.includes("API key not set")) {
    return { error: "Your AI analysis key isn't set up yet. Add your provider's API key and reload.", status: 500 };
  }
  if (raw.includes("Unknown AI_PROVIDER")) {
    return { error: "The AI provider setting isn't recognized. Use one of: OpenAI, Anthropic, Google, or OpenRouter.", status: 500 };
  }
  if (raw.includes("API 401") || raw.includes("API 403")) {
    return { error: "AI service authentication failed. Check your API key.", status: 502 };
  }
  // Word-bounded on purpose: a bare `includes("rate")` matched "generate",
  // "accurate" and "separate", so an unrelated failure whose message contained
  // any of those was reported as a rate limit — and, because this check ran
  // before the timeout and JSON checks, it masked their more useful messages.
  if (/\b429\b/.test(raw) || /rate[ _-]?limit/i.test(raw) || /too many requests/i.test(raw)) {
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
