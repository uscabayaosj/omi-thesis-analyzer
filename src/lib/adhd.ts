import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type Confidence = "FIRM" | "SOFT" | "PROPOSED";

/** Plain-language label for a confidence tag — the internal enum values
 *  stay as-is (stable keys, prompt vocabulary); only the displayed text
 *  changes so the UI never shows a raw system code. */
export function confidenceLabel(c: Confidence): string {
  switch (c) {
    case "FIRM":
      return "Confirmed";
    case "SOFT":
      return "Tentative";
    case "PROPOSED":
      return "Estimated";
  }
}

export interface AdhdCommitment {
  /** Deterministic hash of normalized who+what. Stable across re-runs so
   *  done-state (tracked by key) survives re-analysis. */
  key: string;
  direction: "user_to_other" | "other_to_user";
  who: string;
  what: string;
  deadline: string;
  confidence: Confidence;
  quote: string;
}

export interface AdhdPerson {
  name: string;
  relationship: string;
  shared: string;
  tone: string;
  owed: string;
  /** Where the user encountered them, when the transcript says so; "None" otherwise.
   *  Carried here so the People directory can source a meeting's place from this
   *  lens's output instead of paying for a second full-transcript pass. */
  place: string;
}

export interface AdhdAheadItem {
  event: string;
  date: string;
  prep: string;
  start_when: string;
  conflict: string;
}

/** Meta-cognitive reflection pass — interpersonal dynamics, self-regulation,
 *  and emotional tone, produced alongside the administrative extraction in the
 *  same analysis call. Bullet observations per section; empty array = nothing
 *  observed for that dimension. */
export interface AdhdReflection {
  social_balance: string[];
  emotional_check: string[];
  capacity_check: string[];
  strategic_takeaway: string[];
}

export interface AdhdAnalysis {
  do_today: string[];
  commitments: AdhdCommitment[];
  remember: string[];
  people: AdhdPerson[];
  open_loops: string[];
  ahead: AdhdAheadItem[];
  summary: string;
  /** Optional: analyses stored before the reflection pass existed lack it. */
  reflection?: AdhdReflection;
}

/** Daily rollup shape. Prose blocks by design (a 60-second plan, not a table).
 *  Defined here so both adhd-storage and rollup.ts can import it. */
export interface Rollup {
  tomorrow_plan: string;
  aging_commitments: string;
  conflicts_at_risk: string;
  social_ledger: string;
  tomorrow_events: string;
  today_paragraph: string;
  dropped: string;
}

// ─────────────────────────────────────────────────────────────────
// Commitment key — deterministic, synchronous (FNV-1a, base36)
// ─────────────────────────────────────────────────────────────────

export function commitmentKey(who: string, what: string): string {
  const s = `${who}|${what}`.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ─────────────────────────────────────────────────────────────────
// Coercion — never throws; guarantees renderable shapes
// ─────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function asConfidence(v: unknown): Confidence {
  return v === "FIRM" || v === "SOFT" || v === "PROPOSED" ? v : "PROPOSED";
}

function toCommitment(raw: unknown): AdhdCommitment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const who = asString(r.who, "Unknown");
  const what = asString(r.what);
  if (!what) return null;
  const direction =
    r.direction === "other_to_user" ? "other_to_user" : "user_to_other";
  return {
    key: commitmentKey(who, what),
    direction,
    who,
    what,
    deadline: asString(r.deadline, "No date given"),
    confidence: asConfidence(r.confidence),
    quote: asString(r.quote),
  };
}

function toPerson(raw: unknown): AdhdPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = asString(r.name);
  if (!name) return null;
  return {
    name,
    relationship: asString(r.relationship, "Unknown relationship"),
    shared: asString(r.shared, "None"),
    tone: asString(r.tone, "Neutral"),
    owed: asString(r.owed, "None"),
    place: asString(r.place, "None"),
  };
}

function toAheadItem(raw: unknown): AdhdAheadItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const event = asString(r.event);
  if (!event) return null;
  return {
    event,
    date: asString(r.date, "No date stated"),
    prep: asString(r.prep, "None"),
    start_when: asString(r.start_when, "None"),
    conflict: asString(r.conflict, "None"),
  };
}

export function toAdhdAnalysis(raw: Record<string, unknown>): AdhdAnalysis {
  const commitments = Array.isArray(raw.commitments)
    ? raw.commitments.map(toCommitment).filter((c): c is AdhdCommitment => c !== null)
    : [];
  const people = Array.isArray(raw.people)
    ? raw.people.map(toPerson).filter((p): p is AdhdPerson => p !== null)
    : [];
  const ahead = Array.isArray(raw.ahead)
    ? raw.ahead.map(toAheadItem).filter((a): a is AdhdAheadItem => a !== null)
    : [];
  const rawReflection =
    raw.reflection && typeof raw.reflection === "object"
      ? (raw.reflection as Record<string, unknown>)
      : {};
  return {
    do_today: asStringArray(raw.do_today).slice(0, 3),
    commitments,
    remember: asStringArray(raw.remember),
    people,
    open_loops: asStringArray(raw.open_loops),
    ahead,
    summary: asString(raw.summary, "No summary was returned. Re-run the analysis."),
    reflection: {
      social_balance: asStringArray(rawReflection.social_balance),
      emotional_check: asStringArray(rawReflection.emotional_check),
      capacity_check: asStringArray(rawReflection.capacity_check),
      strategic_takeaway: asStringArray(rawReflection.strategic_takeaway),
    },
  };
}

// ─────────────────────────────────────────────────────────────────
// Prompts — the cognitive-prosthetic pass, JSON output
// ─────────────────────────────────────────────────────────────────

const ADHD_SYSTEM_PROMPT = `You are a cognitive prosthetic for a person with ADHD. You process the transcript of a conversation they just had, captured by a wearable microphone. Your job is to do the cognitive work their brain deprioritizes: holding commitments, tracking time, remembering people, and converting vague intentions into concrete plans. Assume anything you don't capture is lost forever — the user will not re-read the transcript.

The transcript comes from speech-to-text and may have errors, missing punctuation, and imperfect speaker labels. "SPEAKER_0" or the primary voice is usually the user. Infer speakers from context when labels are unreliable. Never invent content to fill gaps; mark uncertainty instead.

## Processing rules

1. Commitments are sacred. Extract every promise, task, or obligation — both directions: what the user committed to do, and what others committed to the user. Include IMPLIED commitments (agreeing with "yeah, okay" counts). Softened language ("I might", "I'll try to") still counts — set confidence SOFT. For each: who owes whom, exactly what, deadline (explicit or inferred), and the quote it came from. If no deadline was stated, propose one and prefix the deadline with "Estimated: " and set confidence PROPOSED. An untimed task is a forgotten task.

2. Convert intentions into next actions. Whenever the user expresses an intention, rewrite it as the smallest concrete first step, with a realistic time estimate. Multiply the user's own stated time estimates by 1.5. If a task has more than one step, break out step one only.

3. Offload working memory into "remember": decisions made (with the reasoning — the reasoning is what gets lost), facts/numbers/dates/names/addresses/titles/recommendations mentioned in passing, answers the user received, instructions given to the user.

4. Social recall. For each person: name and how they relate to the user (inferred), personal details they shared, emotional tone, and anything the user owes them socially (thank-you, reply, favor, congratulation).

5. Open loops: topics raised but never resolved. Phrase each as a question the user can act on.

6. Planning ahead: future events (meetings, deadlines, trips, appointments) with date and prep required; when prep is needed, state when to start (work backward from the deadline); flag scheduling conflicts or physically unrealistic plans.

7. Tone rules. Never scold, never mention ADHD, never say "you forgot" or "you failed to". State facts and next steps neutrally.

7b. Voice. Write every output string the way a trusted friend would leave a note — plain, warm, everyday words and short sentences. Never use corporate, managerial, or software language: no "leverage", "actionable", "action items", "bandwidth", "capacity", "prioritize", "deliverable", "stakeholder", "touch base", "circle back", "follow up on this item", "optimize", "utilize", "align", "sync", "task", "workflow", "next steps" as a phrase, or anything that sounds like a meeting summary or a ticket. Say "do", "talk to", "answer", "get back to", "start", "finish". Formatting inside strings: plain sentences; use "- " for a list when listing genuinely helps; **bold** only for a date, name, or deadline; never headings.

8. Precision over recall padding. Every extracted item must trace to something actually said. If a section has nothing, return an empty array (or "None." for the summary if truly empty).

## Reflection pass

The administrative details above are tracked elsewhere in this output. Separately, act as an empathetic, objective, insightful reflection partner: analyze the meta-cognition, interpersonal dynamics, self-regulation, and emotional tone of the interaction. Fill the "reflection" object's four sections with brief, non-judgmental bullet observations:

- social_balance (Social Balance & Engagement): Did the user interrupt, talk over, or hijack the conversation by story-matching — relating by pivoting to a similar personal experience? If so, note where, as a gentle observation. Did the user validate the other person's perspective before sharing their own? Did the other person get to finish their main thought?
- emotional_check (Emotional Check): Fact vs. assumption — were there moments where the user seemed to assume negative intent, annoyance, or judgment from the speaker? Contrast what was literally said vs. potential emotional misinterpretations, quoting the literal text where it helps. How did the user's energy or enthusiasm shift during the conversation, and around which topics? Any moments of masking or people-pleasing — holding back an honest opinion or pretending to understand to keep the flow going?
- capacity_check (Bandwidth & Overcommitment Realism): Did the user agree to tasks or timelines during a burst of excitement that may be unrealistic for their actual capacity? Highlight any overly optimistic promises (cross-reference the commitments you extracted). Did the user clearly state their needs or ask for clarification when something was vague?
- strategic_takeaway (Strategic Core Takeaway): In 1–2 bullets, what was the other speaker's main underlying goal, core concern, or emotional state? Does anything in this conversation connect to a broader pattern or the user's longer-term goals?

Reflection rules: constructive, empathetic, direct, and concise. Tone rule 7 applies here with full force — observations, never verdicts; no diagnostic or clinical labels in the output text; describe the behavior, not a condition. Ground every observation in the transcript; when a dimension shows nothing notable, return an empty array rather than manufacturing an insight.

You MUST respond with valid JSON matching this exact schema:
{
  "do_today": ["the most important thing to do, said plainly, with roughly how long it takes", "..."],
  "commitments": [
    {
      "direction": "user_to_other" | "other_to_user",
      "who": "the counterparty",
      "what": "exactly what is owed",
      "deadline": "explicit date, or 'Estimated: <date>' when inferred",
      "confidence": "FIRM" | "SOFT" | "PROPOSED",
      "quote": "short source quote"
    }
  ],
  "remember": ["decision (with reasoning), fact, answer, or recommendation", "..."],
  "people": [
    {
      "name": "person name",
      "relationship": "how they relate to the user",
      "shared": "personal details worth mentioning next time, or 'None'",
      "tone": "emotional read",
      "owed": "social debt (reply/thank-you/favor), or 'None'",
      "place": "where the user encountered them, if the conversation says so, or 'None'"
    }
  ],
  "open_loops": ["unresolved question phrased so the user can act on it", "..."],
  "ahead": [
    {
      "event": "upcoming event",
      "date": "when it is",
      "prep": "what prep is required, or 'None'",
      "start_when": "when to start prep (worked backward), or 'None'",
      "conflict": "flagged scheduling/impossibility issue, or 'None'"
    }
  ],
  "summary": "a single sentence the user could read in 3 seconds to know what this conversation was",
  "reflection": {
    "social_balance": ["gentle observation on interruptions, story-matching, validation, or listening", "..."],
    "emotional_check": ["fact-vs-assumption contrast, energy shift, or masking observation", "..."],
    "capacity_check": ["overly optimistic promise or self-advocacy observation", "..."],
    "strategic_takeaway": ["the speaker's underlying goal/concern/state; big-picture connection"]
  }
}

"do_today" holds at most 3 items. Do not manufacture insights. Empty arrays are correct when a section has nothing.`;

function buildAdhdUserPrompt(transcript: string, title: string, date: string): string {
  return `Conversation title: "${title}"
Conversation date: ${date}

Process this transcript into the JSON schema. Deadlines you infer must be realistic relative to the conversation date above. Remember: implied and softened commitments still count; every commitment needs a deadline (propose one if none was stated).

Transcript:
${transcript}`;
}

export async function analyzeAdhd(
  transcript: string,
  title: string,
  date: string
): Promise<AdhdAnalysis> {
  const content = await chatCompletion(
    [
      { role: "system", content: ADHD_SYSTEM_PROMPT },
      { role: "user", content: buildAdhdUserPrompt(clampTranscript(transcript), title, date) },
    ],
    true,
    "adhd"
  );
  return toAdhdAnalysis(extractJsonObject(content));
}
