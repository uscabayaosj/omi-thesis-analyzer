import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { analyzeConversation } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId required" }, { status: 400 });
    }

    const convo = await getConversation(conversationId);

    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json({ error: "No transcript available" }, { status: 404 });
    }

    const transcript = segmentsToText(convo.transcript_segments);
    const title = convo.structured?.title || "Untitled Conversation";

    const analysis = await analyzeConversation(transcript, title);

    return NextResponse.json({ conversation: convo, analysis });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
