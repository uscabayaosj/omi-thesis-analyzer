import { chatCompletion, extractJsonObject } from "./analysis";
import type { Rollup } from "./adhd";

export interface DayRollupInput {
  day: string;
  rollup: Rollup;
}

export interface WeeklyRollup {
  week_summary: string;
  completion_pattern: string;
  chronically_aging: string;
  dropped_this_week: string;
  social_pattern: string;
  next_week_setup: string;
}

const WEEKLY_FIELDS: (keyof WeeklyRollup)[] = [
  "week_summary",
  "completion_pattern",
  "chronically_aging",
  "dropped_this_week",
  "social_pattern",
  "next_week_setup",
];

export function toWeeklyRollup(raw: Record<string, unknown>): WeeklyRollup {
  const result = {} as Record<keyof WeeklyRollup, string>;
  for (const field of WEEKLY_FIELDS) {
    const v = raw[field];
    result[field] = typeof v === "string" && v.trim()
      ? v
      : "The AI did not return this section. Re-run the weekly rollup to fill it in.";
  }
  return result;
}

const WEEKLY_SYSTEM_PROMPT = `You are the weekly executive-function layer for a person with ADHD. Your input is that week's daily rollups — each already a synthesis of that day's conversations. Your job is to see the pattern across the whole week, not repeat what each day already said.

## Processing rules

1. Look for what repeats. A commitment or loop appearing in multiple days' aging/dropped sections is the signal — name the pattern, not just the item.

2. Judge completion honestly but without blame: what got done, what didn't, and anything about the week's shape (too packed, too scattered, a specific day that broke the rhythm) that explains it.

3. Anything that shows up as "aging" in 3 or more of the week's daily rollups is chronically aging — call it out by name with a short friendly message they could send to ask for more time, not just "some things are still open."

4. Consolidate what got dropped across the week into one list — the point is the user trusts nothing vanished silently, at the week level too.

5. Read the social ledger sections across the week as one shape: a person mentioned as owed a reply on Monday and still owed by Friday is a pattern worth naming, not five separate facts.

6. Suggest one or two concrete things worth setting up before next week starts — not a to-do list, just what would make next week's Monday easier given what this week showed.

7. Tone: neutral, no scolding, no ADHD mention, no "you failed to". Voice: like a trusted friend leaving a note, not a project manager. Plain everyday words, short sentences. Never use corporate, managerial, or software language: no "leverage", "actionable", "action items", "bandwidth", "prioritize", "deliverable", "stakeholder", "touch base", "circle back", "optimize", "align", "renegotiate" (say "ask for more time"), "social debt" (say who is waiting to hear from them), or anything that reads like a status report. Formatting inside each field: short sentences or "- " bullets; **bold** only for a date, name, or deadline; never headings.

You MUST respond with valid JSON matching this exact schema:
{
  "week_summary": "What this week was, in one paragraph — written so reading only this a month later reconstructs the week.",
  "completion_pattern": "What got done vs. what didn't, and the pattern across the days — not a day-by-day recap.",
  "chronically_aging": "Anything aging in 3+ of this week's daily rollups, named specifically, each with a short friendly message they could send to ask for more time. 'None.' if clean.",
  "dropped_this_week": "Everything let go across the week, consolidated, one line each. 'None.' if none.",
  "social_pattern": "The week's relationship pattern — who's been waiting, any repeat, not a fresh per-day list. 'None.' if clean.",
  "next_week_setup": "One or two concrete things worth setting up before next week starts, given what this week showed. 'Nothing specific.' if there's nothing worth flagging."
}

Each field is a prose string (may contain newlines and simple markdown like bold or hyphen bullets). Do not return arrays or nested objects.`;

function fmtDay(input: DayRollupInput): string {
  const r = input.rollup;
  return `--- ${input.day} ---
Today in one paragraph: ${r.today_paragraph}
Aging commitments: ${r.aging_commitments}
Conflicts/at-risk: ${r.conflicts_at_risk}
Social ledger: ${r.social_ledger}
Dropped: ${r.dropped}`;
}

export async function generateWeeklyRollup(
  weekStart: string,
  dailyRollups: DayRollupInput[]
): Promise<WeeklyRollup> {
  const sorted = [...dailyRollups].sort((a, b) => a.day.localeCompare(b.day));
  const dayBlocks = sorted.map(fmtDay).join("\n\n");

  const userPrompt = `Week starting Monday ${weekStart}. Below are this week's daily rollups (${sorted.length} of 7 days have one). Produce one weekly synthesis following your rules.

${dayBlocks}`;

  const content = await chatCompletion(
    [
      { role: "system", content: WEEKLY_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    true,
    "weekly-rollup"
  );
  return toWeeklyRollup(extractJsonObject(content));
}
