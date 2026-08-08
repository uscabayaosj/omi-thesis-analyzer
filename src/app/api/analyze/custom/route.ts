import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { analyzeCustom } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  try {
    const { conversationId, prompt } = await req.json();

    if (!conversationId || !prompt) {
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

    const convo = await getConversation(conversationId);

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
    const raw = err instanceof Error ? err.message : String(err);

    if (raw.includes("API key") || raw.includes("401") || raw.includes("403")) {
      return NextResponse.json(
        { error: "AI service authentication failed. Check your API key." },
        { status: 502 }
      );
    }
    if (raw.includes("429") || raw.includes("rate")) {
      return NextResponse.json(
        { error: "AI service is busy. Please wait a moment and try again." },
        { status: 429 }
      );
    }

    return NextResponse.json(
      { error: "Something went wrong during analysis. Please try again." },
      { status: 500 }
    );
  }
}
