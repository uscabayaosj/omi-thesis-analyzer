import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { analyzeConversation } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId) {
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
    const raw = err instanceof Error ? err.message : String(err);

    // User-friendly error mapping
    if (raw.includes("API key") || raw.includes("401") || raw.includes("403")) {
      return NextResponse.json(
        { error: "AI service authentication failed. Check that OPENAI_API_KEY is set correctly." },
        { status: 502 }
      );
    }
    if (raw.includes("429") || raw.includes("rate")) {
      return NextResponse.json(
        { error: "AI service is busy. Please wait a moment and try again." },
        { status: 429 }
      );
    }
    if (raw.includes("timeout") || raw.includes("ETIMEDOUT")) {
      return NextResponse.json(
        { error: "The analysis took too long. Try with a shorter conversation." },
        { status: 504 }
      );
    }
    if (raw.includes("Omi API")) {
      return NextResponse.json(
        { error: "Could not load the conversation from Omi. Check your OMI_API_KEY and try again." },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: "Something went wrong during analysis. Please try again." },
      { status: 500 }
    );
  }
}
