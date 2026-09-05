import { NextRequest, NextResponse } from "next/server";
import { getConversation, type Conversation } from "@/lib/omi-api";
import { getStore } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getConversationRow } from "@/lib/capture/store";
import { friendlyError } from "@/lib/api-error";

/** TRACE's own store first; Omi only while its key remains (see ../route.ts). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    let conversation: Conversation | null = null;
    const sql = getStore();
    if (sql) {
      await ensureCaptureSchemaOnce(sql);
      const r = await getConversationRow(sql, id);
      if (r) {
        conversation = {
          id: r.id,
          created_at: r.created_at,
          started_at: r.started_at ?? undefined,
          finished_at: r.finished_at ?? undefined,
          source: r.source,
          structured: (r.structured as Conversation["structured"]) ?? undefined,
          transcript_segments: r.transcript_segments as Conversation["transcript_segments"],
          geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
        };
      }
    }
    if (!conversation) {
      if (!process.env.OMI_API_KEY) {
        return NextResponse.json({ error: "That conversation isn't in TRACE's store." }, { status: 404 });
      }
      conversation = await getConversation(id);
    }
    return NextResponse.json(conversation, {
      headers: {
        // A finished conversation (with transcript) never changes — cache hard.
        "Cache-Control": conversation.transcript_segments?.length
          ? "private, max-age=86400, immutable"
          : "private, max-age=30",
      },
    });
  } catch (err) {
    console.error("conversation fetch failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
