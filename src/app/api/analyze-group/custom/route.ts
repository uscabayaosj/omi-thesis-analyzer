import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText, type Conversation } from "@/lib/omi-api";
import { chatCompletion, clampTranscript } from "@/lib/analysis";
import { friendlyError } from "@/lib/api-error";

const MAX_GROUP_SIZE = 20;
const PER_CONVO_CHARS = 60_000;
// See analyze-group/route.ts — caps the combined prompt across a large group.
const MAX_GROUP_CHARS = 200_000;

export async function POST(req: NextRequest) {
  try {
    const { conversationIds, prompt } = await req.json();

    const ids = Array.isArray(conversationIds)
      ? Array.from(
          new Set(
            conversationIds.filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0
            )
          )
        )
      : [];

    if (ids.length < 2 || !prompt || typeof prompt !== "string") {
      return NextResponse.json(
        { error: "Select at least 2 conversations and enter a question." },
        { status: 400 }
      );
    }
    if (prompt.length > 2000) {
      return NextResponse.json(
        { error: "Question is too long. Please keep it under 2000 characters." },
        { status: 400 }
      );
    }
    if (ids.length > MAX_GROUP_SIZE) {
      return NextResponse.json(
        { error: `Group analysis supports up to ${MAX_GROUP_SIZE} conversations at a time. Select fewer and try again.` },
        { status: 400 }
      );
    }

    const results = await Promise.allSettled(ids.map((id) => getConversation(id)));
    const convos = results
      .filter((r): r is PromiseFulfilledResult<Conversation> => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((c) => c.transcript_segments && c.transcript_segments.length > 0);

    if (convos.length < 2) {
      return NextResponse.json(
        { error: "Not enough conversations with transcripts could be loaded to analyze as a group." },
        { status: 400 }
      );
    }

    const perConvoBudget = Math.min(
      PER_CONVO_CHARS,
      Math.floor(MAX_GROUP_CHARS / Math.max(1, convos.length))
    );
    const convoBlocks = convos
      .map((c, i) => {
        const title = c.structured?.title || "Untitled";
        const date = typeof c.created_at === "string" ? c.created_at.split("T")[0] : "unknown date";
        const transcript = clampTranscript(segmentsToText(c.transcript_segments!), perConvoBudget);
        return `--- CONVERSATION ${i + 1}: ${title} (${date}) ---\n${transcript}`;
      })
      .join("\n\n");

    const systemPrompt = `You are an academic research assistant helping a PhD anthropology student analyze multiple fieldwork conversations together. The student's thesis is "Pioneer Sovereignty" — sovereignty through ranch sociality in Montana.

You will be given multiple conversation transcripts and a specific analysis question. Analyze them TOGETHER to answer the question. Be specific — reference which conversation and speaker you are drawing from. Provide 2-4 paragraphs.`;

    const userPrompt = `Analysis question: ${prompt}

${convoBlocks}`;

    const result = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      false,
      "group-custom"
    );

    return NextResponse.json({ result });
  } catch (err) {
    console.error("custom group analysis failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
