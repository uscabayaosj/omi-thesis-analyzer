"use client";

// fetch + JSON parse that always throws a human-readable Error:
// network failures, non-JSON bodies (proxy/dev-server HTML pages),
// and { error } payloads from our API routes all become clean messages.
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      res.ok
        ? "The server sent an unexpected response. Refresh and try again."
        : `Something went wrong on the server. Please try again. (error ${res.status})`
    );
  }

  if (data && typeof data === "object" && "error" in data) {
    const msg = (data as { error: unknown }).error;
    if (typeof msg === "string" && msg) throw new Error(msg);
  }
  if (!res.ok) {
    throw new Error(`Something went wrong on the server. Please try again. (error ${res.status})`);
  }

  return data as T;
}
