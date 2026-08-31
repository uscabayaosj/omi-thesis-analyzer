import { chatCompletion, extractJsonObject } from "./analysis";
import type { AdhdAnalysis, Rollup, RollupPlanStep } from "./adhd";
import { commitmentKey } from "./adhd";

export interface DayConvoOutput {
  title: string;
  date: string;
  analysis: AdhdAnalysis;
  doneKeys: string[];
}

/** The prose sections only — `plan_steps` is structured and parsed separately. */
type RollupProseField = Exclude<keyof Rollup, "plan_steps">;

const ROLLUP_FIELDS: RollupProseField[] = [
  "tomorrow_plan",
  "aging_commitments",
  "conflicts_at_risk",
  "social_ledger",
  "tomorrow_events",
  "today_paragraph",
  "dropped",
];

function toPlanStep(raw: unknown): RollupPlanStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const what = typeof r.what === "string" ? r.what.trim() : "";
  if (!what) return null;
  const str = (v: unknown): string | undefined => {
    const t = typeof v === "string" ? v.trim() : "";
    return t ? t : undefined;
  };
  // The model is told to send a number, but a "30" or "about 30 minutes"
  // slips through often enough to be worth parsing rather than dropping.
  const rawMin = typeof r.minutes === "number" ? r.minutes : Number.parseInt(String(r.minutes ?? ""), 10);
  const minutes = Number.isFinite(rawMin) && rawMin > 0 ? Math.round(rawMin) : undefined;
  return {
    key: commitmentKey("plan", what),
    what,
    when: str(r.when),
    minutes,
    deadline: str(r.deadline),
    why: str(r.why),
  };
}

export function toRollup(raw: Record<string, unknown>): Rollup {
  const result = {} as Rollup;
  for (const field of ROLLUP_FIELDS) {
    const v = raw[field];
    result[field] = typeof v === "string" && v.trim()
      ? v
      : "The AI did not return this section. Re-run the rollup to fill it in.";
  }
  // Structured plan is best-effort: a model that returns nothing usable leaves
  // this undefined and the UI falls back to the prose, exactly as it does for
  // rollups saved before plan_steps existed.
  const steps = Array.isArray(raw.plan_steps)
    ? raw.plan_steps.map(toPlanStep).filter((s): s is RollupPlanStep => s !== null).slice(0, 5)
    : [];
  if (steps.length) result.plan_steps = steps;
  return result;
}

const ROLLUP_SYSTEM_PROMPT = `You are the end-of-day executive function layer for a person with ADHD. Your input is the set of structured extractions from every conversation they had on a given day, plus optionally the previous day's rollup. Each extraction was made in isolation; your job is to see the whole day at once and produce one plan the user can act on tomorrow. The user will read only your output.

## Processing rules

1. Deduplicate and reconcile. The same commitment often appears in multiple conversations. Merge duplicates into one item, keeping the earliest deadline and every person expecting it. If two extractions conflict (different deadlines, amounts, decisions), flag the conflict explicitly — do not silently pick one.

2. Re-prioritize globally. Re-rank everything against each other. Priority order: (1) commitments to others with deadlines in the next 48 hours; (2) prep whose start date is today or tomorrow; (3) soft commitments at risk of silently expiring; (4) everything else. Cap tomorrow's list at 5 items. Overflow goes under conflicts/at-risk, not the plan.

3. Track commitment aging. If a previous rollup is provided, carry forward any commitment not yet marked done, and show its age in days. An item carried 3+ times gets promoted to the top with a suggested renegotiation script.

4. Detect the day's drift. Compare intended vs. actual in one neutral, pattern-level sentence — data for tomorrow, not blame.

5. Consolidate people into one social ledger: who was interacted with, social debts accumulated (replies owed, thank-yous), and relationships pending more than a few days. Surface at most 3 cheap high-value social actions.

6. Build tomorrow's runway: tomorrow's known events in time order with prep status; one suggested "first block" (the single most important task at the user's best hours, phrased as its smallest first step with a 1.5x time estimate); flag any conflict or impossible sequencing now.

7. Close or kill open loops. Merge all open loops; drop any resolved later in the day; attach the rest to a task or park them. Loops surviving three rollups should be suggested for deletion.

8. Tone: neutral, no scolding, no ADHD mention, no "you failed to". The whole rollup must be readable in under 60 seconds.

9. Voice. Write like a trusted friend leaving a note, not like a project manager. Plain everyday words, short sentences. Never use corporate, managerial, or software language: no "leverage", "actionable", "action items", "bandwidth", "prioritize", "deliverable", "stakeholder", "touch base", "circle back", "optimize", "align", "renegotiate" (say "ask for more time"), "social debt" (say who is waiting to hear from them), or anything that reads like a status report. Formatting inside each field: short sentences or "- " bullets; **bold** only for a date, name, or deadline; never headings.

You MUST respond with valid JSON matching this exact schema:
{
  "tomorrow_plan": "The one thing to start the day with (the smallest first step, with a rough time and a suggested time of day), then up to 4 more items in order, each one line with its deadline in bold. 'Nothing time-sensitive for tomorrow.' if there is genuinely nothing to plan.",
  "aging_commitments": "Promises still open from earlier days, each with how many days old it is; for anything 3+ days old, include a short friendly message they could send to ask for more time. 'None.' if clean.",
  "conflicts_at_risk": "Things that contradict each other between conversations, days with too much packed in, and anything that needs a decision. 'None.' if clean.",
  "social_ledger": "At most 3 quick, kind things worth doing for people (a reply, a thank-you); below that, anyone who has been waiting more than a few days, one line each.",
  "tomorrow_events": "Tomorrow's events in time order, each with whether it's ready or what still needs doing. 'None.' if none.",
  "today_paragraph": "3-4 sentences: what got decided, what moved, the drift observation — written so reading only this a week later reconstructs the day.",
  "dropped": "Loops and items closed or killed today, one line each, so the user trusts nothing vanished silently. 'None.' if none.",
  "plan_steps": [
    {
      "what": "The action, phrased as its smallest first step. One short sentence, no bullet marker, no bold.",
      "when": "Suggested time of day, e.g. '9:00 AM' or 'morning'. Omit the field if there is no sensible suggestion.",
      "minutes": 30,
      "deadline": "Hard deadline if one genuinely exists, e.g. 'August 31'. Omit the field otherwise.",
      "why": "One short clause on why it ranks here. Omit if it would just restate the action."
    }
  ]
}

Every field except "plan_steps" is a prose string (may contain newlines and simple markdown like bold or hyphen bullets); do not return arrays or nested objects for those.

"plan_steps" is the SAME plan as "tomorrow_plan", in the same order, broken into objects so the app can let the user tick items off. Rules for it:
- Same cap as the plan: at most 5 steps, first one being the "first block".
- "what" is plain text only — no markdown, no leading "- ", no bold. The other fields carry the structure.
- "minutes" is a plain number, not a string, and is omitted entirely when unknown. Use the same 1.5x estimate as the prose.
- Omit any optional field rather than returning an empty string or null.
- Return an empty array only when "tomorrow_plan" is genuinely "Nothing time-sensitive for tomorrow."
- The two must agree: never put an item in one and not the other.`;

function fmtCommitment(c: AdhdAnalysis["commitments"][number], doneSet: Set<string>): string {
  const dir = c.direction === "other_to_user" ? `${c.who} owes me` : `I owe ${c.who}`;
  const status = doneSet.has(c.key) ? "DONE" : "OPEN";
  return `    - [${status}][${c.confidence}] ${dir}: ${c.what} (deadline: ${c.deadline})`;
}

function fmtConvo(c: DayConvoOutput, i: number): string {
  const a = c.analysis;
  const doneSet = new Set(c.doneKeys);
  const commitments = a.commitments.length ? a.commitments.map((commit) => fmtCommitment(commit, doneSet)).join("\n") : "    - none";
  const people = a.people.length ? a.people.map((p) => `    - ${p.name} (${p.relationship}); owed: ${p.owed}`).join("\n") : "    - none";
  const loops = a.open_loops.length ? a.open_loops.map((l) => `    - ${l}`).join("\n") : "    - none";
  const ahead = a.ahead.length ? a.ahead.map((x) => `    - ${x.event} (${x.date}); prep: ${x.prep}; start: ${x.start_when}`).join("\n") : "    - none";
  return `--- CONVERSATION ${i + 1}: "${c.title}" (${c.date}) ---
  Summary: ${a.summary}
  Commitments:
${commitments}
  People:
${people}
  Open loops:
${loops}
  Ahead:
${ahead}`;
}

function fmtPreviousRollup(prev: Rollup): string {
  return `--- PREVIOUS ROLLUP (for commitment aging and loop-killing) ---
Tomorrow plan (which was for today): ${prev.tomorrow_plan}
Aging commitments: ${prev.aging_commitments}
Conflicts/at-risk: ${prev.conflicts_at_risk}
Open items today paragraph: ${prev.today_paragraph}
Dropped: ${prev.dropped}`;
}

export async function generateRollup(
  day: string,
  conversations: DayConvoOutput[],
  previousRollup?: Rollup
): Promise<Rollup> {
  const convoBlocks = conversations.map(fmtConvo).join("\n\n");
  const prevBlock = previousRollup ? `\n\n${fmtPreviousRollup(previousRollup)}` : "";

  const userPrompt = `Day being rolled up: ${day}

Below are the per-conversation ADHD extractions for this day. Produce one rollup for tomorrow following your rules.${prevBlock}

${convoBlocks}`;

  const content = await chatCompletion(
    [
      { role: "system", content: ROLLUP_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    true,
    "rollup"
  );
  return toRollup(extractJsonObject(content));
}
