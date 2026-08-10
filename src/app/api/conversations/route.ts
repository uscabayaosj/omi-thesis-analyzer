import { NextResponse } from "next/server";
import { getConversations } from "@/lib/omi-api";

export async function GET() {
  try {
    const conversations = await getConversations(50);
    return NextResponse.json(conversations, {
      headers: {
        // Per-user data: let the browser reuse a recent list and revalidate
        // in the background rather than re-invoking the function each visit.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
