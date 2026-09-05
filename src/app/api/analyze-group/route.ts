import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/conversations";
import { segmentsToText, type Conversation } from "@/lib/omi-api";
import { chatCompletion, clampTranscript, extractJsonObject } from "@/lib/analysis";
import { friendlyError } from "@/lib/api-error";

const MAX_GROUP_SIZE = 20;
// Per-conversation budget so a large group still fits the model context.
const PER_CONVO_CHARS = 60_000;
// Aggregate budget across the whole group: PER_CONVO_CHARS * MAX_GROUP_SIZE
// alone can reach ~1.2M chars, far past any provider's context window. When a
// large group of long conversations pushes the combined prompt past this, the
// per-conversation budget is scaled down further so the request stays sane.
const MAX_GROUP_CHARS = 200_000;

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

const GROUP_FIELDS = [
  "cross_conversation_themes",
  "contradictions_and_tensions",
  "evolution_and_patterns",
  "synthesis",
  "forward_thinking",
] as const;

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

function sanitizeGroupIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    )
  );
}

export async function POST(req: NextRequest) {
  try {
    const { conversationIds } = await req.json();
    const ids = sanitizeGroupIds(conversationIds);

    if (ids.length < 2) {
      return NextResponse.json(
        { error: "Select at least 2 conversations to run a group analysis." },
        { status: 400 }
      );
    }
    if (ids.length > MAX_GROUP_SIZE) {
      return NextResponse.json(
        { error: `Group analysis supports up to ${MAX_GROUP_SIZE} conversations at a time. Select fewer and try again.` },
        { status: 400 }
      );
    }

    // Fetch in parallel; tolerate individual failures (deleted conversations,
    // transient Omi errors) as long as 2+ transcripts survive.
    const results = await Promise.allSettled(ids.map((id) => loadConversation(id)));
    const convos = results
      .filter((r): r is PromiseFulfilledResult<Conversation> => r.status === "fulfilled")
      .map((r) => r.value);
    const failedCount = results.length - convos.length;

    const withTranscripts = convos.filter(
      (c) => c.transcript_segments && c.transcript_segments.length > 0
    );
    // Reduce the per-conversation budget further if PER_CONVO_CHARS times the
    // group size would blow past the aggregate cap.
    const perConvoBudget = Math.min(
      PER_CONVO_CHARS,
      Math.floor(MAX_GROUP_CHARS / Math.max(1, withTranscripts.length))
    );
    const conversationData = withTranscripts.map((c) => ({
      id: c.id,
      title: c.structured?.title || "Untitled",
      date: c.created_at,
      transcript: clampTranscript(segmentsToText(c.transcript_segments!), perConvoBudget),
    }));

    if (conversationData.length < 2) {
      const reason = failedCount > 0
        ? `${failedCount} of the selected conversations could not be loaded from Omi.`
        : "Fewer than 2 of the selected conversations have transcripts.";
      return NextResponse.json(
        { error: `Not enough conversations to analyze as a group. ${reason}` },
        { status: 400 }
      );
    }

    const userPrompt = buildGroupPrompt(conversationData);
    const content = await chatCompletion(
      [
        { role: "system", content: GROUP_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      true,
      "group"
    );

    const raw = extractJsonObject(content);
    const analysis = Object.fromEntries(
      GROUP_FIELDS.map((field) => {
        const value = raw[field];
        return [
          field,
          typeof value === "string" && value.trim()
            ? value
            : "The AI did not return this dimension. Re-run the analysis to fill it in.",
        ];
      })
    );

    return NextResponse.json({
      analysis,
      skipped: failedCount,
      conversations: convos.map((c) => ({
        id: c.id,
        title: c.structured?.title || "Untitled",
        date: c.created_at,
        emoji: c.structured?.emoji || "💬",
      })),
    });
  } catch (err) {
    console.error("group analysis failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
