import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText, type Conversation } from "@/lib/omi-api";
import { chatCompletion } from "@/lib/analysis";

export async function POST(req: NextRequest) {
  try {
    const { conversationIds, prompt } = await req.json();

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length < 2 || !prompt) {
      return NextResponse.json(
        { error: "conversationIds (2+) and prompt required" },
        { status: 400 }
      );
    }

    const convos = await Promise.all(
      conversationIds.map((id: string) => getConversation(id))
    );

    const convoBlocks = convos
      .filter((c: Conversation) => c.transcript_segments && c.transcript_segments.length > 0)
      .map((c: Conversation, i: number) => {
        const title = c.structured?.title || "Untitled";
        const transcript = segmentsToText(c.transcript_segments!);
        return `--- CONVERSATION ${i + 1}: ${title} (${c.created_at.split("T")[0]}) ---\n${transcript}`;
      })
      .join("\n\n");

    const systemPrompt = `You are an academic research assistant helping a PhD anthropology student analyze multiple fieldwork conversations together. The student's thesis is "Pioneer Sovereignty" — sovereignty through ranch sociality in Montana.

You will be given multiple conversation transcripts and a specific analysis question. Analyze them TOGETHER to answer the question. Be specific — reference which conversation and speaker you are drawing from. Provide 2-4 paragraphs.`;

    const userPrompt = `Analysis question: ${prompt}

${convoBlocks}`;

    const result = await chatCompletion([
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
