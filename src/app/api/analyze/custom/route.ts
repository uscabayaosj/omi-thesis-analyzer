import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/conversations";
import { segmentsToText } from "@/lib/omi-api";
import { analyzeCustom } from "@/lib/analysis";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId, prompt } = await req.json();

    if (!conversationId || typeof conversationId !== "string" || !prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Please select a conversation and enter a question." },
        { status: 400 }
      );
    }

    if (prompt.length > 2000) {
      return NextResponse.json(
        { error: "Question is too long. Please keep it under 2000 characters." },
        { status: 400 }
      );
    }

    const convo = await loadConversation(conversationId);

    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json(
        { error: "This conversation has no transcript to analyze." },
        { status: 404 }
      );
    }

    const transcript = segmentsToText(convo.transcript_segments);
    const title = convo.structured?.title || "Untitled";

    const result = await analyzeCustom(transcript, title, prompt);

    return NextResponse.json({ result });
  } catch (err) {
    console.error("custom analysis failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
