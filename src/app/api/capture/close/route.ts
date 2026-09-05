import { NextResponse } from "next/server";
import { closeAllOpen } from "@/lib/capture/pipeline";

export const maxDuration = 300;

/**
 * "End the conversation now": closes every open capture session without
 * waiting for the three-minute silence gap. Unauthenticated like the app's
 * other single-user actions — it only transcribes the user's own audio.
 */
export async function POST() {
  try {
    return NextResponse.json(await closeAllOpen());
  } catch (err) {
    console.error("capture close failed:", err);
    return NextResponse.json({ error: "Could not end the conversation. Try again." }, { status: 500 });
  }
}
