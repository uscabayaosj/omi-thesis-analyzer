import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { analyzeCustom } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  try {
    const { conversationId, prompt } = await req.json();

    if (!conversationId || !prompt) {
      return NextResponse.json(
        { error: "conversationId and prompt required" },
        { status: 400 }
      );
    }

    const convo = await getConversation(conversationId);

    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json({ error: "No transcript available" }, { status: 404 });
    }

    const transcript = segmentsToText(convo.transcript_segments);
    const title = convo.structured?.title || "Untitled";

    const result = await analyzeCustom(transcript, title, prompt);

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
