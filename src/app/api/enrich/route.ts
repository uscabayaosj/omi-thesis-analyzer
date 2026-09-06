import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/conversations";
import { segmentsToText } from "@/lib/conversation-types";
import { enrichConversation } from "@/lib/enrich";
import { countTranscriptWords, JUNK_WORD_FLOOR } from "@/lib/enrich-core";
import { friendlyError } from "@/lib/api-error";
import { getStore, getNamespaceRecord } from "@/lib/kv";
import type { StoredEnrichment } from "@/lib/enrich-storage";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Please select a conversation to name." },
        { status: 400 }
      );
    }

    // Check the durable store before spending an LLM call: another device
    // may have already enriched this conversation and synced the result.
    // Narrows (but, without a real lock, can't fully close) the window where
    // two devices both name the same still-unnamed conversation at once.
    const sql = getStore();
    if (sql) {
      // One record, not the whole namespace: this runs once per conversation
      // in the "Name new" batch, and shipping every stored enrichment each
      // time scaled the batch with the archive rather than with the request.
      const existing = (await getNamespaceRecord(sql, "omi-enrichments", conversationId)) as
        | StoredEnrichment
        | null;
      if (existing && typeof existing === "object") {
        return NextResponse.json({
          enrichment: {
            junk: existing.junk,
            junk_reason: existing.junkReason ?? "",
            title: existing.title ?? "",
            overview: existing.overview ?? "",
          },
          wordCount: existing.wordCount,
        });
      }
    }

    const convo = await loadConversation(conversationId);
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
