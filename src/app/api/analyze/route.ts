import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { analyzeConversation } from "@/lib/analysis";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Please select a conversation to analyze." },
        { status: 400 }
      );
    }

    const convo = await getConversation(conversationId);

    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json(
        { error: "This conversation has no transcript to analyze. Try recording a new conversation with your Omi device." },
        { status: 404 }
      );
    }

    const transcript = segmentsToText(convo.transcript_segments);
    const title = convo.structured?.title || "Untitled Conversation";

    const analysis = await analyzeConversation(transcript, title);

    return NextResponse.json({ conversation: convo, analysis });
  } catch (err) {
    console.error("analyze failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
