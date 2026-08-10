import { NextResponse } from "next/server";
import { getConversations } from "@/lib/omi-api";
import { friendlyError } from "@/lib/api-error";

export async function GET() {
  try {
    const conversations = await getConversations(50);
    return NextResponse.json(Array.isArray(conversations) ? conversations : [], {
      headers: {
        // Per-user data: let the browser reuse a recent list and revalidate
        // in the background rather than re-invoking the function each visit.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("conversations fetch failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
