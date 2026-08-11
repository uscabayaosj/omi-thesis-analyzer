import { chatCompletion, extractJsonObject } from "./analysis";
import type { AdhdAnalysis, Rollup } from "./adhd";

export interface DayConvoOutput {
  title: string;
  date: string;
  analysis: AdhdAnalysis;
  doneKeys: string[];
}

const ROLLUP_FIELDS: (keyof Rollup)[] = [
  "tomorrow_plan",
  "aging_commitments",
  "conflicts_at_risk",
  "social_ledger",
  "tomorrow_events",
  "today_paragraph",
  "dropped",
];

export function toRollup(raw: Record<string, unknown>): Rollup {
  const result = {} as Record<keyof Rollup, string>;
  for (const field of ROLLUP_FIELDS) {
    const v = raw[field];
    result[field] = typeof v === "string" && v.trim()
      ? v
      : "The AI did not return this section. Re-run the rollup to fill it in.";
  }
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

8. Tone: neutral, no scolding, no ADHD mention, no "you failed to". Facts and next actions. The whole rollup must be readable in under 60 seconds.

You MUST respond with valid JSON matching this exact schema:
{
  "tomorrow_plan": "First block: <smallest first step, time estimate, suggested slot>. Then up to 4 more ranked items, each one line with the deadline in bold.",
  "aging_commitments": "Carried items with age in days; renegotiation script for anything 3+ days old. 'None.' if clean.",
  "conflicts_at_risk": "Contradictions between conversations, overcommitted slots, overflow tasks needing a decision or renegotiation. 'None.' if clean.",
  "social_ledger": "At most 3 cheap high-value social actions; longer-pending relationship debts below, one line each.",
  "tomorrow_events": "Time-ordered events, each with prep status (ready / needs X min / unprepared). 'None.' if none.",
  "today_paragraph": "3-4 sentences: what got decided, what moved, the drift observation — written so reading only this a week later reconstructs the day.",
  "dropped": "Loops and items closed or killed today, one line each, so the user trusts nothing vanished silently. 'None.' if none."
}

Each field is a prose string (may contain newlines and simple markdown like bold or hyphen bullets). Do not return arrays or nested objects.`;

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
    true
  );
  return toRollup(extractJsonObject(content));
}
