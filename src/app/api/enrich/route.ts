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
    const wordCount = countTranscriptWords(segments);

    // Below the floor there is nothing to name: junk by definition, no LLM
    // spent. A conversation with no transcript at all lands here too — a 404
    // would leave it permanently "unnamed", re-fetched on every batch run,
    // when what it needs is a cached verdict like any other noise recording.
    if (wordCount < JUNK_WORD_FLOOR) {
      return NextResponse.json({
        enrichment: {
          junk: true,
          junk_reason:
            wordCount === 0
              ? "No transcript was captured"
              : `Only ${wordCount} ${wordCount === 1 ? "word" : "words"} were caught`,
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
