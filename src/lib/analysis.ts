import { createHash } from "node:crypto";
import type { Analysis } from "./conversation-types";
import { logUsage, type NormalizedUsage } from "./usage";

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
        model: model || "gpt-5.6-luna",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      };

    case "anthropic":
      return {
        baseUrl: "https://api.anthropic.com/v1/messages",
        apiKey: process.env.ANTHROPIC_API_KEY || "",
        model: model || "claude-sonnet-5",
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
          "x-goog-api-key": process.env.GOOGLE_API_KEY || "",
        },
      };

    case "openrouter":
      return {
        baseUrl: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: process.env.OPENROUTER_API_KEY || "",
        model: model || "deepseek/deepseek-v4",
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
    const systemMsg = messages.find((m) => m.role === "system");
    const userMsgs = messages.filter((m) => m.role !== "system");
    return {
      model: config.model,
      max_tokens: 8192,
      // Mark the stable system prompt for prompt caching: it is identical on
      // every call, so Anthropic serves it from cache (~90% cheaper, lower
      // latency) after the first hit. Only prompts that clear the model's
      // minimum cacheable prefix actually cache — 1024 tokens on Sonnet 5,
      // which the thesis and ADHD frameworks clear and the shorter rollup and
      // group prompts do not. Below the minimum this marker is simply inert.
      system: systemMsg?.content
        ? [{ type: "text", text: systemMsg.content, cache_control: { type: "ephemeral" } }]
        : undefined,
      messages: userMsgs,
    };
  }

  if (provider === "google") {
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
        maxOutputTokens: 8192,
        responseMimeType: jsonMode ? "application/json" : "text/plain",
      },
    };
  }

  // GPT-5 renamed max_tokens to max_completion_tokens and dropped temperature;
  // sending either of the old fields is a 400. Everything else — earlier OpenAI
  // models, and OpenRouter, which normalizes these itself — keeps the old pair.
  const gptVersion = provider === "openai" ? parseGptVersion(config.model) : null;
  const isGpt5Plus = gptVersion !== null && gptVersion >= GPT_5;

  const base = {
    model: config.model,
    messages,
    ...(isGpt5Plus
      ? {
          // On a reasoning model this ceiling covers reasoning tokens as well
          // as the reply, so 8192 could be spent thinking and leave the JSON
          // truncated. It is a cap, not a reservation — unused headroom is not
          // billed — so it is set well clear of what these prompts return.
          max_completion_tokens: GPT5_OUTPUT_CEILING,
          // Reasoning tokens bill at the output rate, 6x input, which makes
          // them the largest controllable cost here. These calls extract
          // structured fields from a transcript against a fixed rubric, so
          // they need far less deliberation than the default. Raise this via
          // the env var if analysis quality suffers.
          reasoning_effort: process.env.AI_REASONING_EFFORT || "low",
        }
      : { temperature: 0.7, max_tokens: 8192 }),
    ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
  };

  // Every analysis is a one-off: a stable system prompt followed by a
  // transcript that never repeats. Left implicit, GPT-5.6 would put its cache
  // breakpoint on that transcript and bill a 1.25x write for a prefix nothing
  // ever reads. So pin the breakpoint at the end of the system prompt and turn
  // the implicit one off. The key is a hash of the system prompt, which makes
  // it stable per prompt type without threading an id through every caller.
  // Older OpenAI models and OpenRouter reject these fields, hence the gate.
  const systemMsg = messages.find((m) => m.role === "system");
  if (!systemMsg || gptVersion === null || gptVersion < GPT_5_6) {
    return base;
  }

  return {
    ...base,
    messages: messages.map((m) =>
      m === systemMsg
        ? {
            role: m.role,
            content: [
              {
                type: "text",
                text: m.content,
                prompt_cache_breakpoint: { mode: "explicit" },
              },
            ],
          }
        : m,
    ),
    prompt_cache_key: promptCacheKey(systemMsg.content),
    prompt_cache_options: { mode: "explicit" },
  };
}

// Model generations as major*100+minor, so they compare as plain numbers.
const GPT_5 = 500; // max_completion_tokens replaces max_tokens; no temperature
const GPT_5_6 = 506; // explicit prompt cache breakpoints

// Headroom for reasoning tokens plus the JSON reply. Only what the model
// actually generates is billed, so this buys truncation safety for free.
const GPT5_OUTPUT_CEILING = 16384;

// Returns null for anything that isn't a "gpt-<major>[.<minor>]-..." model.
function parseGptVersion(model: string): number | null {
  const m = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
  if (!m) return null;
  return Number(m[1]) * 100 + Number(m[2] ?? 0);
}

function promptCacheKey(systemPrompt: string): string {
  return `omi:${createHash("sha256").update(systemPrompt).digest("hex").slice(0, 16)}`;
}

// A response cut off at the token ceiling still arrives as HTTP 200 with
// partial content, which then fails JSON parsing as "did not return valid
// JSON" — pointing at the model's formatting rather than at the real cause.
// Name it here instead, so the fix (raise the ceiling, or lower the reasoning
// effort spending it) is legible from the log line.
function assertNotTruncated(data: Record<string, unknown>, provider: string): void {
  let truncated = false;

  if (provider === "anthropic") {
    truncated = data.stop_reason === "max_tokens";
  } else if (provider === "google") {
    const candidates = data.candidates as Array<{ finishReason?: string }> | undefined;
    truncated = candidates?.[0]?.finishReason === "MAX_TOKENS";
  } else {
    const choices = data.choices as Array<{ finish_reason?: string }> | undefined;
    truncated = choices?.[0]?.finish_reason === "length";
  }

  if (truncated) {
    throw new Error(
      `${provider} response hit the output token ceiling and was truncated. ` +
        `Raise the ceiling, or lower AI_REASONING_EFFORT so fewer tokens go to reasoning.`,
    );
  }
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

  const choices = data.choices as Array<{ message: { content: string } }>;
  return choices?.[0]?.message?.content || "";
}

function extractUsage(data: Record<string, unknown>, provider: string): NormalizedUsage | null {
  if (provider === "anthropic") {
    const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    if (typeof usage?.input_tokens !== "number" || typeof usage?.output_tokens !== "number") return null;
    return { promptTokens: usage.input_tokens, completionTokens: usage.output_tokens };
  }

  if (provider === "google") {
    const usage = data.usageMetadata as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
    if (typeof usage?.promptTokenCount !== "number" || typeof usage?.candidatesTokenCount !== "number") return null;
    return { promptTokens: usage.promptTokenCount, completionTokens: usage.candidatesTokenCount };
  }

  const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
  if (typeof usage?.prompt_tokens !== "number" || typeof usage?.completion_tokens !== "number") return null;
  return { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens };
}

export async function chatCompletion(
  messages: ChatMessage[],
  jsonMode = false,
  label?: string
): Promise<string> {
  const config = getProviderConfig();
  if (!config.apiKey) {
    throw new Error(`API key not set for provider '${process.env.AI_PROVIDER || "openai"}'. Check your .env.local.`);
  }

  const provider = process.env.AI_PROVIDER || "openai";
  const url = config.baseUrl;

  const body = buildRequestBody(config, messages, jsonMode);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: config.headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new Error(`${provider} API request timed out after ${AI_TIMEOUT_MS / 1000}s`);
    }
    throw e;
  }

  if (!res.ok) {
    const errorBody = (await res.text()).slice(0, 500);
    throw new Error(`${provider} API ${res.status}: ${errorBody}`);
  }

  const data = await res.json();
  assertNotTruncated(data, provider);

  if (label) {
    const usage = extractUsage(data, provider);
    if (usage) {
      void logUsage({ label, provider, model: config.model, usage }).catch((e) =>
        console.error(`usage logging failed for label "${label}":`, e)
      );
    }
  }

  return extractContent(data, provider);
}

const AI_TIMEOUT_MS = 120_000;

// Rough character budget for transcripts sent to the AI (~50k tokens),
// so a marathon recording degrades to a truncated analysis instead of a
// context-window error from the provider.
export const MAX_TRANSCRIPT_CHARS = 200_000;

export function clampTranscript(transcript: string, maxChars = MAX_TRANSCRIPT_CHARS): string {
  if (transcript.length <= maxChars) return transcript;
  return `${transcript.slice(0, maxChars)}\n\n[Transcript truncated for analysis — the recording exceeds the size limit. The analysis covers the portion above.]`;
}

// Providers (Anthropic especially, which has no JSON mode) often wrap JSON
// in markdown fences or prose. Extract the object rather than failing.
export function extractJsonObject(content: string): Record<string, unknown> {
  const attempts = [content.trim()];

  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) attempts.push(fenced[1].trim());

  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first !== -1 && last > first) attempts.push(content.slice(first, last + 1));

  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new Error("AI response did not return valid JSON");
}

const ANALYSIS_FIELDS: (keyof Analysis)[] = [
  "rq1_documentary_record",
  "rq2_everyday_practices",
  "rq3_cskt_intersection",
  "rq4_wildness_imaginary",
  "conditions_check",
  "rival_hypothesis_test",
  "refutation_signals",
  "forward_thinking",
];

function toAnalysis(raw: Record<string, unknown>): Analysis {
  const result = {} as Record<keyof Analysis, string>;
  for (const field of ANALYSIS_FIELDS) {
    const value = raw[field];
    result[field] =
      typeof value === "string" && value.trim()
        ? value
        : "The AI did not return this dimension. Re-run the analysis to fill it in.";
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────
// Analysis prompts — grounded in the Pioneer Sovereignty proposal
// ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an academic research assistant for a PhD anthropology thesis titled "Ranch Sociality and the Making of Authority in the Flathead Valley, Montana: An Ethnography of Pioneer Sovereignty" by Ulysses S. Cabayao, SJ (UCL).

## The thesis argument

The thesis argues for a concept called **pioneer sovereignty**: the sovereign formation produced when state-constituted settler agents redeploy the ideological and material resources of their own constitution against the regulatory authority of the state that empowered them, while denying the prior and ongoing sovereignty of the Confederated Salish and Kootenai Tribes (CSKT) whose territory they occupy.

The Flathead Valley concentrates three sovereignty formations on one ground:
1. **CSKT sovereignty** — held under the 1855 Hellgate Treaty, with time-immemorial water priority
2. **Federal/state regulatory authority** — BLM grazing, Clean Water Act, ESA, CSKT Water Compact
3. **Ranching families' authority** — presented as prior to federal regulation while depending on it

A single federal process (the 1904 Allotment Act) produced two of these formations: it allotted the reservation and opened surplus to homestead entry, assembling the settler land base out of Indigenous dispossession.

## The five orienting conditions

These direct ethnographic attention to where the formation should be observable:

**Condition 1: State delegation through friendly aspects of sovereignty.** The federal state extended land, water, and grazing authority to settlers through homestead patents, water rights, and grazing permits. Families may know their land began with a homestead patent and still narrate authority as self-made. The candid family is the expected case, not a counterexample.

**Condition 2: The eliminatory structure of settler colonialism.** Ranching authority is exercised on dispossessed ground. In the Flathead, dispossession and grant were executed under the same statute (1904 Act) within the same decade.

**Condition 3: The regulatory contradiction and refrontierisation.** Post-1970s federal regulation constrains authority the state itself constituted. Ranching communities experience this as betrayal, triggering refrontierisation — present conflict is narrated as repetition of the original frontier struggle, with the federal government now occupying the position the wild landscape held in the founding story.

**Condition 4: The wildness imaginary as a double-erasure instrument.** One apparatus produces two erasures through the same resources:
- **4A:** Erasure of Indigenous prior sovereignty — the frontier mythos presents pre-settlement landscape as empty
- **4B:** Erasure of federal regulatory authority — the same binary presents regulation as intrusion into a naturally self-governing space
The two erasures co-vary: where disavowal of federal authority intensifies, disavowal of CSKT sovereignty intensifies with it.

**Condition 5: The affective constitution of sovereign subjectivity.** Sovereignty is felt and performed rather than legally held — a form of sovereign agency, "often more aspiration than realization" (Bryant and Reeves 2021), directed at regaining the felt capacity to govern land, herd, and community without external interference.

## The rival hypothesis

The strongest alternative is that pioneer sovereignty is organized interest-group politics deploying frontier mythology instrumentally — a rhetorical resource in regulatory contexts, not a felt sovereign subjectivity. The accounts diverge on one observable axis: the interest-group account predicts frontier framing concentrates in strategic, audience-bearing settings and thins in intimate ones (private inheritance disputes, kinship talk, ordinary ranch work). Pioneer sovereignty predicts the same framing saturates both registers.

## What would refute the concept

1. Frontier framing appeared only in strategic-public settings, substantially absent from intimate ones
2. Families' acknowledgment of federal origins dissolved rather than coexisted with the claim to autonomy
3. The two erasures did not co-vary (e.g., families who contest federal authority while readily affirming CSKT priority)
4. Authority claims tracked economic stakes irrespective of heritage narrative

## Four research questions

**RQ1 (contextual):** Which historical and legal acts constituted pioneer and settler authority (homestead patents, allotment law, grazing permits, water-rights adjudications, federal irrigation projects) and how are they documented, preserved, and remembered?

**RQ2 (primary):** Through which everyday social practices (kinship, inheritance, land use, animal husbandry, boundary-maintenance, and conflict) do ranching families produce, assert, and contest authority over land and herd?
- How is ranch property transmitted across generations (legal instrument, family negotiation, informal expectation)?
- How are cattle ownership, branding, and herd management used to assert status and territorial claim?
- How are boundary disputes handled (kin obligation, informal arbitration, legal recourse, threat of force)?

**RQ3 (secondary):** How do ranching families' practices of authority intersect with, depend on, and become contested by CSKT sovereignty over the same territory?

**RQ4 (secondary):** How is the frontier wildness imaginary enacted through observable practice (rodeo, branding, hunting, oral storytelling) and what work does that enactment do in legitimating authority claims against both Indigenous prior sovereignty and federal regulatory authority?

You MUST respond with valid JSON matching this exact schema:
{
  "rq1_documentary_record": "...",
  "rq2_everyday_practices": "...",
  "rq3_cskt_intersection": "...",
  "rq4_wildness_imaginary": "...",
  "conditions_check": "...",
  "rival_hypothesis_test": "...",
  "refutation_signals": "...",
  "forward_thinking": "..."
}

Each field should be 2-3 paragraphs. Be specific — quote or reference actual content from the conversation. If a conversation does not provide evidence for a dimension, say so explicitly rather than speculating.

Formatting inside each field: short paragraphs separated by blank lines; use "- " bullets when listing distinct pieces of evidence; **bold** only for key terms or quoted phrases; never use headings. Prefer readable academic prose over analysis-speak — no filler like "it is worth noting" or "this serves to underscore".`;

function buildUserPrompt(transcript: string, title: string): string {
  return `Analyze this conversation titled "${title}" against the thesis on Pioneer Sovereignty.

For each dimension, ground your analysis in what the transcript actually contains. If a dimension has no evidence in this conversation, say so.

1. **RQ1 — Documentary Record**: What evidence exists of the historical-legal constitution of authority? References to land titles, water rights, homestead patents, grazing permits, federal agencies (BLM, Forest Service, Fish & Wildlife), the CSKT Water Compact, or the 1904 Allotment Act? How are these documented, preserved, or remembered in the conversation?

2. **RQ2 — Everyday Practices**: What social practices of authority production are observable? Look for: kinship obligations, inheritance talk, land transmission, cattle branding, herd management as status claim, boundary disputes, labor exchange, conflict resolution (kin obligation vs. legal recourse vs. threat of force).

3. **RQ3 — CSKT Intersection**: How does CSKT sovereignty appear in this conversation? Direct references to the Tribes, the Water Compact, the reservation, the Bison Range? Silences where you would expect reference? How do participants frame the relationship between their authority and tribal sovereignty?

4. **RQ4 — Wildness Imaginary**: Is the frontier wildness imaginary enacted? Look for: the pre-settlement landscape described as empty or wild, settlement described as "opening" or "taming," regulation described as intrusion, the pioneer generation referenced as self-made. Which erasure does it perform — of Indigenous prior sovereignty (4A), of federal regulatory authority (4B), or both?

5. **Conditions Check**: Which of the five orienting conditions are evidenced in this conversation? Cite specific moments.

6. **Rival Hypothesis Test**: Is frontier framing appearing in an audience-bearing (public/strategic) setting or an intimate one (private, kinship, ordinary work)? What does the register tell us about whether this is felt subjectivity or instrumental rhetoric?

7. **Refutation Signals**: Does anything in this conversation challenge or complicate the pioneer sovereignty concept? Any acknowledgment of federal origins that coexists with autonomy claims? Any moments where the two erasures do NOT co-vary?

8. **Forward Thinking**: What research directions does this conversation suggest? What questions should the researcher pursue next? What connections to other data or theoretical literatures emerge?

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
      { role: "user", content: buildUserPrompt(clampTranscript(transcript), title) },
    ],
    true,
    "thesis"
  );

  return toAnalysis(extractJsonObject(content));
}

export async function analyzeCustom(
  transcript: string,
  title: string,
  customPrompt: string
): Promise<string> {
  const systemPrompt = `You are an academic research assistant for a PhD anthropology thesis on "Pioneer Sovereignty" — the sovereign formation produced when state-constituted settler ranching families in Montana's Flathead Valley redeploy the resources of their own federal constitution against the regulatory state, while denying CSKT sovereignty.

Key concepts: friendly aspects of sovereignty (Miller), refrontierisation (Haug), the wildness imaginary, settler common sense (Rifkin), possessive logics (Moreton-Robinson), the double erasure (of Indigenous sovereignty + federal origin), defrontierisation (Acciaioli).

You will be given a conversation transcript and a specific analysis question. Provide a thoughtful, detailed analysis (2-4 paragraphs). Be specific — quote or reference actual content from the conversation.`;

  const userPrompt = `Conversation: "${title}"

Transcript:
${clampTranscript(transcript)}

Analysis question: ${customPrompt}`;

  return chatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    false,
    "thesis-custom"
  );
}
