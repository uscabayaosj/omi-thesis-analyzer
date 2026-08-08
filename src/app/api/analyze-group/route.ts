import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText, type Conversation } from "@/lib/omi-api";
import { chatCompletion } from "@/lib/analysis";

const GROUP_SYSTEM_PROMPT = `You are an academic research assistant helping a PhD anthropology student analyze multiple fieldwork conversations together.

The student's thesis is titled "Pioneer Sovereignty" — it examines sovereignty through ranch sociality in Montana. The research explores how people on Montana ranches enact, negotiate, and experience sovereignty through everyday social practices, land use, community relations, and political engagement.

You are given MULTIPLE conversations as a group. Your task is to analyze them TOGETHER — finding cross-conversation patterns, contradictions, evolving themes, and synthesis that individual analysis cannot reveal.

You MUST respond with valid JSON matching this exact schema:
{
  "cross_conversation_themes": "...",
  "contradictions_and_tensions": "...",
  "evolution_and_patterns": "...",
  "synthesis": "...",
  "forward_thinking": "..."
}

Each field should be 2-4 paragraphs. Be specific — reference which conversation and speaker you are drawing from.`;

function buildGroupPrompt(
  conversations: Array<{ title: string; date: string; transcript: string }>
): string {
  const convoBlocks = conversations
    .map(
      (c, i) =>
        `--- CONVERSATION ${i + 1} ---
Title: ${c.title}
Date: ${c.date}
Transcript:
${c.transcript}`
    )
    .join("\n\n");

  return `Analyze these ${conversations.length} conversations as a group across five dimensions:

1. **Cross-Conversation Themes**: What themes, topics, or ideas recur across multiple conversations? What shared concerns or preoccupations emerge?

2. **Contradictions & Tensions**: Where do different conversations (or speakers) contradict each other? What tensions exist between stated positions and actual practices?

3. **Evolution & Patterns**: How do ideas, positions, or dynamics change across the conversations in chronological order? What trajectory is visible?

4. **Synthesis**: What does the group of conversations reveal as a whole that no single conversation shows? What bigger picture emerges?

5. **Forward Thinking**: Based on the cross-conversation analysis, what research questions should the explorer pursue next? What hypotheses emerge from the patterns?

${convoBlocks}`;
}

export async function POST(req: NextRequest) {
  try {
    const { conversationIds } = await req.json();

    if (!conversationIds || !Array.isArray(conversationIds) || conversationIds.length < 2) {
      return NextResponse.json(
        { error: "At least 2 conversationIds required" },
        { status: 400 }
      );
    }

    // Fetch all conversations in parallel
    const convos = await Promise.all(
      conversationIds.map((id: string) => getConversation(id))
    );

    // Build transcript data
    const conversationData = convos
      .filter((c: Conversation) => c.transcript_segments && c.transcript_segments.length > 0)
      .map((c: Conversation) => ({
        id: c.id,
        title: c.structured?.title || "Untitled",
        date: c.created_at,
        transcript: segmentsToText(c.transcript_segments!),
      }));

    if (conversationData.length < 2) {
      return NextResponse.json(
        { error: "At least 2 conversations must have transcripts" },
        { status: 400 }
      );
    }

    const userPrompt = buildGroupPrompt(conversationData);
    const content = await chatCompletion(
      [
        { role: "system", content: GROUP_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      true
    );

    const analysis = JSON.parse(content);

    return NextResponse.json({
      analysis,
      conversations: convos.map((c: Conversation) => ({
        id: c.id,
        title: c.structured?.title || "Untitled",
        date: c.created_at,
        emoji: c.structured?.emoji || "💬",
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
