import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";

const OPENAI_BASE = "https://api.openai.com/v1/chat/completions";

export async function POST(req: NextRequest) {
  try {
    const { conversationId, prompt } = await req.json();

    if (!conversationId || !prompt) {
      return NextResponse.json(
        { error: "conversationId and prompt required" },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });
    }

    const convo = await getConversation(conversationId);

    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json({ error: "No transcript available" }, { status: 404 });
    }

    const transcript = segmentsToText(convo.transcript_segments);
    const title = convo.structured?.title || "Untitled";

    const systemPrompt = `You are an academic research assistant helping a PhD anthropology student analyze fieldwork conversations. The student's thesis is "Pioneer Sovereignty" — sovereignty through ranch sociality in Montana.

You will be given a conversation transcript and a specific analysis question. Provide a thoughtful, detailed analysis (2-4 paragraphs). Be specific — quote or reference actual content from the conversation.`;

    const userPrompt = `Conversation: "${title}"

Transcript:
${transcript}

Analysis question: ${prompt}`;

    const res = await fetch(OPENAI_BASE, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenAI API ${res.status}: ${body}`);
    }

    const data = await res.json();
    const result = data.choices[0].message.content;

    return NextResponse.json({ result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
