import { NextResponse } from "next/server";
import { retryFailed } from "@/lib/capture/pipeline";

export const maxDuration = 300;

/**
 * "Retry failed transcriptions now": re-runs every session the pipeline has
 * marked failed, regardless of how many times the daily sweep already tried.
 * Unauthenticated like /api/capture/close — the app's other single-user
 * action on its own audio — and for the same reason: it is called straight
 * from the browser, which cannot hold a server-only token, and it can only
 * re-transcribe recordings that are already the user's.
 */
export async function POST() {
  try {
    return NextResponse.json(await retryFailed());
  } catch (err) {
    console.error("capture retry failed:", err);
    return NextResponse.json({ error: "Could not retry the failed transcriptions. Try again." }, { status: 500 });
  }
}
