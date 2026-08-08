import { type Analysis } from "./omi-api";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  headers: Record<string, string>;
}

function getProviderConfig(): ProviderConfig {
  const provider = process.env.AI_PROVIDER || "openai";
  const model = process.env.AI_MODEL || "";

  switch (provider) {
    case "openai":
      return {
        baseUrl: "https://api.openai.com/v1/chat/completions",
        apiKey: process.env.OPENAI_API_KEY || "",
        model: model || "gpt-4o",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      };

    case "anthropic":
      return {
        baseUrl: "https://api.anthropic.com/v1/messages",
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        model: model || "claude-sonnet-4-20250514",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY || "",
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
      };

    case "google":
      return {
        baseUrl: `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-2.0-flash"}:generateContent`,
        apiKey: process.env.GOOGLE_API_KEY || "",
        model: model || "gemini-2.0-flash",
        headers: {
          "Content-Type": "application/json",
        },
      };

    case "openrouter":
      return {
        baseUrl: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: process.env.OPENROUTER_API_KEY || "",
        model: model || "anthropic/claude-sonnet-4",
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
      };

    default:
      throw new Error(`Unknown AI_PROVIDER: ${provider}. Use openai, anthropic, google, or openrouter.`);
  }
}

function buildRequestBody(config: ProviderConfig, messages: ChatMessage[], jsonMode: boolean) {
  const provider = process.env.AI_PROVIDER || "openai";

  if (provider === "anthropic") {
    // Anthropic Messages API format
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsgs = messages.filter((m) => m.role !== "system");
    return {
      model: config.model,
      max_tokens: 4096,
      system: systemMsg?.content || "",
      messages: userMsgs,
    };
  }

  if (provider === "google") {
    // Google Generative AI format
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsgs = messages.filter((m) => m.role !== "system");
    return {
      contents: userMsgs.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 4096,
        responseMimeType: jsonMode ? "application/json" : "text/plain",
      },
    };
  }

  // OpenAI / OpenRouter format (compatible)
  return {
    model: config.model,
    messages,
    temperature: 0.7,
    max_tokens: 4096,
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };
}

function extractContent(data: Record<string, unknown>, provider: string): string {
  if (provider === "anthropic") {
    const content = data.content as Array<{ text: string }>;
    return content?.[0]?.text || "";
  }

  if (provider === "google") {
    const candidates = data.candidates as Array<{ content: { parts: Array<{ text: string }> } }>;
    return candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  // OpenAI / OpenRouter
  const choices = data.choices as Array<{ message: { content: string } }>;
  return choices?.[0]?.message?.content || "";
}

async function chatCompletion(messages: ChatMessage[], jsonMode = false): Promise<string> {
  const config = getProviderConfig();
  if (!config.apiKey) {
    throw new Error(`API key not set for provider '${process.env.AI_PROVIDER || "openai"}'. Check your .env.local.`);
  }

  const provider = process.env.AI_PROVIDER || "openai";
  let url = config.baseUrl;

  // Google needs API key as query param
  if (provider === "google") {
    url += `?key=${config.apiKey}`;
  }

  const body = buildRequestBody(config, messages, jsonMode);

  const res = await fetch(url, {
    method: "POST",
    headers: config.headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`${provider} API ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  return extractContent(data, provider);
}

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
  const content = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(transcript, title) },
    ],
    true
  );

  return JSON.parse(content) as Analysis;
}

export async function analyzeCustom(
  transcript: string,
  title: string,
  customPrompt: string
): Promise<string> {
  const systemPrompt = `You are an academic research assistant helping a PhD anthropology student analyze fieldwork conversations. The student's thesis is "Pioneer Sovereignty" — sovereignty through ranch sociality in Montana.

You will be given a conversation transcript and a specific analysis question. Provide a thoughtful, detailed analysis (2-4 paragraphs). Be specific — quote or reference actual content from the conversation.`;

  const userPrompt = `Conversation: "${title}"

Transcript:
${transcript}

Analysis question: ${customPrompt}`;

  return chatCompletion([
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ]);
}
