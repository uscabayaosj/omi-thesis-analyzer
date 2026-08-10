import { NextRequest, NextResponse } from "next/server";
import { getConversation } from "@/lib/omi-api";
import { friendlyError } from "@/lib/api-error";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const conversation = await getConversation(id);
    return NextResponse.json(conversation, {
      headers: {
        // A finished conversation (with transcript) never changes — cache hard.
        "Cache-Control": conversation.transcript_segments?.length
          ? "private, max-age=86400, immutable"
          : "private, max-age=30",
      },
    });
  } catch (err) {
    console.error("conversation fetch failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
