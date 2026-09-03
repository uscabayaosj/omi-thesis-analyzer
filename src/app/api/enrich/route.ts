import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { enrichConversation } from "@/lib/enrich";
import { countTranscriptWords, JUNK_WORD_FLOOR } from "@/lib/enrich-core";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Please select a conversation to name." },
        { status: 400 }
      );
    }

    const convo = await getConversation(conversationId);
    const segments = convo.transcript_segments ?? [];
    if (segments.length === 0) {
      return NextResponse.json(
        { error: "This conversation has no transcript to name." },
        { status: 404 }
      );
    }

    const wordCount = countTranscriptWords(segments);

    // Below the floor there is nothing to name: junk by definition, no LLM spent.
    if (wordCount < JUNK_WORD_FLOOR) {
      return NextResponse.json({
        enrichment: {
          junk: true,
          junk_reason: `Only ${wordCount} ${wordCount === 1 ? "word" : "words"} were caught`,
          title: "",
          overview: "",
        },
        wordCount,
      });
    }

    const enrichment = await enrichConversation(segmentsToText(segments), convo.created_at);
    return NextResponse.json({ enrichment, wordCount });
  } catch (err) {
    console.error("enrich failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
