import { type Analysis } from "./omi-api";

const OPENAI_BASE = "https://api.openai.com/v1/chat/completions";

const SYSTEM_PROMPT = `You are an academic research assistant helping a PhD anthropology student analyze fieldwork conversations.

The student's thesis is titled "Pioneer Sovereignty" — it examines sovereignty through ranch sociality in Montana. The research explores how people on Montana ranches enact, negotiate, and experience sovereignty through everyday social practices, land use, community relations, and political engagement.

When analyzing conversations, consider:
- How themes of land, territory, belonging, and governance appear
- Social dynamics around community, family, labor, and place
- Power relations, autonomy, and self-determination
- Connections to broader political and economic structures
- The lived experience of people in rural/frontier contexts

You MUST respond with valid JSON matching this exact schema:
{
  "thesis_relevance": "...",
  "meanings": "...",
  "summary": "...",
  "forward_thinking": "..."
}

Each field should be 2-4 paragraphs of thoughtful analysis. Be specific — quote or reference actual content from the conversation.`;

function buildUserPrompt(transcript: string, title: string): string {
  return `Analyze this conversation titled "${title}" across four dimensions:

1. **Thesis Relevance**: How is this conversation relevant to the thesis on "Pioneer Sovereignty" — sovereignty through ranch sociality in Montana? Identify specific themes, concepts, or data points that connect.

2. **Derived Meanings**: What deeper meanings, patterns, or insights can be extracted from this conversation? Consider social dynamics, power relations, cultural patterns, and implicit knowledge.

3. **Comprehensive Summary**: Provide a thorough summary that captures the key points, participants, context, and significance of this conversation.

4. **Forward Thinking**: Based on this conversation, what questions should the researcher explore next? What connections can be drawn to other data? What hypotheses emerge? How can the researcher think several steps ahead from this material?

Conversation transcript:
${transcript}`;
}

export async function analyzeConversation(
  transcript: string,
  title: string
): Promise<Analysis> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const res = await fetch(OPENAI_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(transcript, title) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${body}`);
  }

  const data = await res.json();
  const content = data.choices[0].message.content;
  return JSON.parse(content) as Analysis;
}
