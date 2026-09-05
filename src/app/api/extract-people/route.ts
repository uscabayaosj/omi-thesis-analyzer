import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/conversations";
import { segmentsToText } from "@/lib/omi-api";
import { extractPeople } from "@/lib/people-extract";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();
    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json({ error: "Please select a conversation to scan." }, { status: 400 });
    }
    const convo = await loadConversation(conversationId);
    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json({ error: "This conversation has no transcript to scan." }, { status: 404 });
    }
    const people = await extractPeople(
      segmentsToText(convo.transcript_segments),
      convo.structured?.title || "Untitled Conversation",
      convo.created_at
    );
    return NextResponse.json({ conversation: convo, people });
  } catch (err) {
    console.error("extract-people failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
