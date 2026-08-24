# Weekly Rollup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "This Week" view that synthesizes a calendar week's already-generated daily rollups into one LLM-written weekly narrative — patterns, what kept slipping, what's worth resetting.

**Architecture:** `src/lib/weekly-rollup.ts` holds the `WeeklyRollup` type and `generateWeeklyRollup()`, which reads each available day's daily-rollup prose fields (not raw conversations — synthesizing syntheses, the same layering the daily rollup already does) and makes one `chatCompletion` call. Storage functions are added directly to the existing `src/lib/adhd-storage.ts`, mirroring its existing daily-rollup functions. A new `POST /api/rollup/weekly` route wires the client's already-loaded daily rollups to the generator. A new page, `src/app/rollup/week/page.tsx`, drives the whole thing — a 7-day strip, a Generate button, and the rendered result — reached via a new link on the existing `/rollup` page.

**Tech Stack:** Next.js 16 App Router, TypeScript, the existing `chatCompletion` (`src/lib/analysis.ts`).

## Global Constraints

- Input is the week's daily rollups (`StoredRollup.rollup` prose fields), never raw conversations or transcripts — a day with no daily rollup yet is simply excluded, never blocking.
- Week boundary is the calendar week, Monday–Sunday, identified by the Monday's `YYYY-MM-DD` date.
- Trigger is manual only (a button) — no scheduled/automatic generation.
- New namespace `omi-adhd-weekly-rollups` (a keyed map, like `omi-adhd-rollups` — not array-shaped, no `ARRAY_NAMESPACES` change needed) added to `SYNCED_NAMESPACES` in `src/lib/kv.ts`.
- The weekly rollup's voice must match the daily rollup's exactly: neutral tone, no scolding, no ADHD mention, plain everyday words, the same banned-corporate-language list from `ROLLUP_SYSTEM_PROMPT` in `src/lib/rollup.ts`.
- **No test runner exists in this codebase** (confirmed: no jest/vitest/tsx, no `test` script, zero test files under `src/`). Verification in this plan uses `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual runtime checks — do not introduce a new test framework.

---

## File Structure

- **Create `src/lib/weekly-rollup.ts`** — `WeeklyRollup` type, coercion, `generateWeeklyRollup()`. Mirrors `src/lib/rollup.ts`'s shape.
- **Modify `src/lib/format.ts`** — add `mondayOf(day)` and `addDays(day, n)`, small pure date helpers alongside the existing `dayOf`.
- **Modify `src/lib/adhd-storage.ts`** — add `StoredWeeklyRollup`, `getWeeklyRollup`, `getWeeklyRollupWeeks`, `saveWeeklyRollup`, mirroring the existing daily-rollup trio.
- **Modify `src/lib/kv.ts`** — add `"omi-adhd-weekly-rollups"` to `SYNCED_NAMESPACES`.
- **Create `src/app/api/rollup/weekly/route.ts`** — thin `POST` handler wiring the client's daily rollups to `generateWeeklyRollup`.
- **Create `src/app/rollup/week/page.tsx`** — the week view UI.
- **Modify `src/app/rollup/page.tsx`** — add a "This Week" link.

---

### Task 1: Weekly rollup types, date helpers, and storage

**Files:**
- Create: `src/lib/weekly-rollup.ts`
- Modify: `src/lib/format.ts`
- Modify: `src/lib/adhd-storage.ts`
- Modify: `src/lib/kv.ts`

**Interfaces:**
- Consumes: `chatCompletion`, `extractJsonObject` from `src/lib/analysis.ts`; `type Rollup` from `src/lib/adhd.ts`; `schedulePush` from `src/lib/sync.ts`; `isSyncedNamespace` from `src/lib/kv.ts` (all existing exports, already used the same way elsewhere in these files).
- Produces: `export interface WeeklyRollup { week_summary: string; completion_pattern: string; chronically_aging: string; dropped_this_week: string; social_pattern: string; next_week_setup: string }`
- Produces: `export interface DayRollupInput { day: string; rollup: Rollup }`
- Produces: `export async function generateWeeklyRollup(weekStart: string, dailyRollups: DayRollupInput[]): Promise<WeeklyRollup>`
- Produces (format.ts): `export function mondayOf(day: string): string`, `export function addDays(day: string, n: number): string`
- Produces (adhd-storage.ts): `export interface StoredWeeklyRollup { weekStart: string; timestamp: string; dayCount: number; rollup: WeeklyRollup }`, `export function getWeeklyRollup(weekStart: string): StoredWeeklyRollup | null`, `export function getWeeklyRollupWeeks(): string[]`, `export function saveWeeklyRollup(record: { weekStart: string; dayCount: number; rollup: WeeklyRollup }): StoredWeeklyRollup`

- [ ] **Step 1: Add date helpers to `format.ts`**

Read `src/lib/format.ts` first to see the current `dayOf` and confirm exact surrounding code. Append:

```typescript
// Both helpers anchor at noon, not midnight — the same convention already
// used across this codebase (e.g. rollup/page.tsx's
// `formatDateTime(\`${day}T12:00:00\`, ...)`) so a date-only string never
// shifts to the adjacent day from a DST transition or timezone parsing edge.
// Output is built from local getFullYear/getMonth/getDate, never
// toISOString(), so the result stays in local time throughout — going
// through toISOString would reintroduce the exact UTC-conversion edge this
// is avoiding.
function toDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The Monday (YYYY-MM-DD) of the calendar week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toDayString(d);
}

/** `day` shifted by `n` days (negative moves backward). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDayString(d);
}
```

- [ ] **Step 2: Write `src/lib/weekly-rollup.ts`**

```typescript
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

3. Anything that shows up as "aging" in 3 or more of the week's daily rollups is chronically aging — call it out by name with a suggested renegotiation script, not just "some things are still open."

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
```

- [ ] **Step 3: Add the namespace to `kv.ts`**

Read `src/lib/kv.ts`'s `SYNCED_NAMESPACES` array first. Add `"omi-adhd-weekly-rollups"` as a new entry (any position in the array is fine — order isn't semantic):

```typescript
export const SYNCED_NAMESPACES = [
  "omi-thesis-analyses",
  "omi-adhd-analyses",
  "omi-adhd-rollups",
  "omi-adhd-weekly-rollups",
  "omi-thesis-group-analyses",
  "omi-people",
  "omi-people-pending",
] as const;
```

- [ ] **Step 4: Add weekly storage functions to `adhd-storage.ts`**

Read the current file first (shown in full in this task's context — the `ROLLUPS_KEY` constant and the "── rollups ──" section at the bottom). Add a new constant near `ROLLUPS_KEY`:

```typescript
const WEEKLY_ROLLUPS_KEY = "omi-adhd-weekly-rollups";
```

And append a new section after the existing "── rollups ──" functions:

```typescript
// ── weekly rollups ──

export interface StoredWeeklyRollup {
  weekStart: string; // YYYY-MM-DD, the Monday
  timestamp: string;
  dayCount: number;
  rollup: WeeklyRollup;
}

export function getWeeklyRollup(weekStart: string): StoredWeeklyRollup | null {
  const map = readMap<StoredWeeklyRollup>(WEEKLY_ROLLUPS_KEY);
  return map[weekStart] ?? null;
}

export function getWeeklyRollupWeeks(): string[] {
  return Object.keys(readMap<StoredWeeklyRollup>(WEEKLY_ROLLUPS_KEY)).sort().reverse();
}

export function saveWeeklyRollup(record: {
  weekStart: string;
  dayCount: number;
  rollup: WeeklyRollup;
}): StoredWeeklyRollup {
  const map = readMap<StoredWeeklyRollup>(WEEKLY_ROLLUPS_KEY);
  const stored: StoredWeeklyRollup = {
    weekStart: record.weekStart,
    timestamp: new Date().toISOString(),
    dayCount: record.dayCount,
    rollup: record.rollup,
  };
  map[record.weekStart] = stored;
  writeMap(WEEKLY_ROLLUPS_KEY, map);
  return stored;
}
```

Add `WeeklyRollup` to the file's existing type-only import from `./weekly-rollup` — the top of the file currently imports `import type { AdhdAnalysis, Rollup } from "./adhd";`; add a second import line: `import type { WeeklyRollup } from "./weekly-rollup";`.

- [ ] **Step 5: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the linter**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 7: Manually verify the date helpers**

Run:
```bash
node -e '
function toDayString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function mondayOf(day) {
  const d = new Date(`${day}T12:00:00`);
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toDayString(d);
}
function addDays(day, n) {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDayString(d);
}
console.log(mondayOf("2026-08-25")); // a Tuesday -> expect 2026-08-24
console.log(mondayOf("2026-08-24")); // a Monday -> expect 2026-08-24 (itself)
console.log(mondayOf("2026-08-23")); // a Sunday -> expect 2026-08-17 (previous Monday)
console.log(addDays("2026-08-24", 6)); // expect 2026-08-30 (Sunday of that week)
'
```
Expected output:
```
2026-08-24
2026-08-24
2026-08-17
2026-08-30
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/weekly-rollup.ts src/lib/format.ts src/lib/adhd-storage.ts src/lib/kv.ts
git commit -m "feat(weekly-rollup): add types, date helpers, generation, and storage"
```

---

### Task 2: Weekly rollup API route

**Files:**
- Create: `src/app/api/rollup/weekly/route.ts`

**Interfaces:**
- Consumes: `generateWeeklyRollup`, `type DayRollupInput` from `src/lib/weekly-rollup.ts` (Task 1)
- Consumes: `friendlyError` from `src/lib/api-error.ts` (existing export, already used by every other analysis-triggering route)

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/rollup/weekly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyRollup, type DayRollupInput } from "@/lib/weekly-rollup";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { weekStart, dailyRollups } = await req.json();

    if (typeof weekStart !== "string" || !weekStart) {
      return NextResponse.json({ error: "Missing weekStart for weekly rollup." }, { status: 400 });
    }
    if (!Array.isArray(dailyRollups) || dailyRollups.length === 0) {
      return NextResponse.json(
        { error: "No daily rollups to synthesize for this week." },
        { status: 400 }
      );
    }

    const rollup = await generateWeeklyRollup(weekStart, dailyRollups as DayRollupInput[]);

    return NextResponse.json({ rollup });
  } catch (err) {
    console.error("weekly rollup failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 2: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual runtime check**

Run: `npm run dev`, then in another terminal:
```bash
curl -s -X POST http://localhost:3000/api/rollup/weekly \
  -H "Content-Type: application/json" \
  -d '{"weekStart":"2026-08-24","dailyRollups":[]}'
```
Expected: `{"error":"No daily rollups to synthesize for this week."}` with a 400 status (confirm via `-w`/`-i` if you want the status code visible) — this exercises validation without needing a real AI provider key. Do not attempt to test the real generation path without a configured `OPENAI_API_KEY`/equivalent; note in your report if this worktree doesn't have one configured, since that's expected and not a gap in this task's own verification.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/rollup/weekly/route.ts
git commit -m "feat(weekly-rollup): add POST /api/rollup/weekly"
```

---

### Task 3: Weekly rollup page and nav link

**Files:**
- Create: `src/app/rollup/week/page.tsx`
- Modify: `src/app/rollup/page.tsx`

**Interfaces:**
- Consumes: `getRollup`, `getWeeklyRollup`, `saveWeeklyRollup`, `type StoredWeeklyRollup` from `src/lib/adhd-storage.ts` (Task 1)
- Consumes: `mondayOf`, `addDays` from `src/lib/format.ts` (Task 1)
- Consumes: `type WeeklyRollup` from `src/lib/weekly-rollup.ts` (Task 1)
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`
- Consumes: `formatDateTime` from `src/lib/format.ts` (existing export)
- Consumes: `Prose` from `src/components/Prose.tsx`
- Consumes: `ArrowLeftIcon`, `CalendarIcon`, `FileTextIcon`, `TrendingUpIcon`, `WarningIcon`, `XCircleIcon`, `UsersIcon`, `ZapIcon`, `ChevronRightIcon` from `src/components/icons.tsx` (all already exported — confirm each exists before using; if `ZapIcon` doesn't exist, check `src/app/rollup/page.tsx`'s own icon import list for what it uses in its place, since that page already imports `ZapIcon` for a similar "action" concept)

- [ ] **Step 1: Write the weekly rollup page**

```tsx
// src/app/rollup/week/page.tsx
"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, mondayOf, addDays } from "@/lib/format";
import {
  getRollup, getWeeklyRollup, saveWeeklyRollup, type StoredWeeklyRollup,
} from "@/lib/adhd-storage";
import type { WeeklyRollup } from "@/lib/weekly-rollup";
import {
  ArrowLeftIcon, CalendarIcon, FileTextIcon, TrendingUpIcon, WarningIcon,
  XCircleIcon, UsersIcon, ZapIcon, ChevronRightIcon, LoaderIcon,
} from "@/components/icons";
import { Prose } from "@/components/Prose";
import { BUTTON_PRIMARY } from "@/lib/ui";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKLY_SECTIONS: { key: keyof WeeklyRollup; heading: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "week_summary", heading: "This week", icon: FileTextIcon },
  { key: "completion_pattern", heading: "What got done", icon: TrendingUpIcon },
  { key: "chronically_aging", heading: "Still stuck", icon: WarningIcon },
  { key: "dropped_this_week", heading: "Let go this week", icon: XCircleIcon },
  { key: "social_pattern", heading: "People", icon: UsersIcon },
  { key: "next_week_setup", heading: "Setting up next week", icon: ZapIcon },
];

function WeeklySectionBlock({
  icon: Icon, heading, content,
}: {
  icon: ComponentType<{ className?: string }>;
  heading: string;
  content: string;
}) {
  const isEmpty = !content || !content.trim() || /^(none|nothing specific)\.?$/i.test(content.trim());
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {heading}
        </h3>
        {isEmpty ? (
          <p className="text-sm text-slate-400 mt-3">None.</p>
        ) : (
          <Prose text={content} className="text-sm leading-relaxed mt-3" />
        )}
      </div>
    </div>
  );
}

function WeekPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startParam = searchParams.get("start");

  const weekStart = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam)) return mondayOf(startParam);
    return mondayOf(today);
  }, [startParam]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const [stored, setStored] = useState<StoredWeeklyRollup | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored(getWeeklyRollup(weekStart));
    setError(null);
  }, [weekStart]);

  const dayRollups = useMemo(
    () => days
      .map((day) => ({ day, stored: getRollup(day) }))
      .filter((d): d is { day: string; stored: NonNullable<ReturnType<typeof getRollup>> } => d.stored !== null),
    [days]
  );

  const generate = async () => {
    if (dayRollups.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await fetchJson<{ rollup: WeeklyRollup }>("/api/rollup/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart,
          dailyRollups: dayRollups.map((d) => ({ day: d.day, rollup: d.stored.rollup })),
        }),
      });
      const saved = saveWeeklyRollup({ weekStart, dayCount: dayRollups.length, rollup: data.rollup });
      setStored(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Weekly rollup failed.");
    } finally {
      setGenerating(false);
    }
  };

  const goToWeek = (newStart: string) => {
    router.push(`/rollup/week?start=${newStart}`);
  };

  const weekEnd = addDays(weekStart, 6);
  const weekStartLabel = formatDateTime(`${weekStart}T12:00:00`, { day: "numeric", month: "long" });
  const weekEndLabel = formatDateTime(`${weekEnd}T12:00:00`, { day: "numeric", month: "long", year: "numeric" });
  const weekLabel = `${weekStartLabel} – ${weekEndLabel}`;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/rollup" className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2">
        <ArrowLeftIcon className="w-4 h-4" />
        Back to Daily Rollup
      </Link>

      <header className="mb-6">
        <h1 className="font-bold text-white mb-2 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-cyan-400 flex-shrink-0" />
          This Week
        </h1>
        <p className="text-slate-400 text-sm">{weekLabel}</p>
      </header>

      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => goToWeek(addDays(weekStart, -7))}
          className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Previous week
        </button>
        <button
          onClick={() => goToWeek(addDays(weekStart, 7))}
          className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Next week
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2 mb-6" aria-label="Days this week">
        {days.map((day, i) => {
          const hasRollup = !!getRollup(day);
          return (
            <div
              key={day}
              className={`flex-1 text-center py-2 rounded-lg text-xs ${
                hasRollup ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400" : "bg-slate-900 border border-slate-800 text-slate-500"
              }`}
            >
              {WEEKDAY_LABELS[i]}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          <button onClick={() => setError(null)} className="mt-2 text-sm text-slate-400 hover:text-white min-h-[44px] px-2">Dismiss</button>
        </div>
      )}

      {!stored && (
        <div className="card p-8 text-center">
          <p className="text-slate-400 mb-4">
            {dayRollups.length === 0
              ? "No daily rollups yet this week — run at least one from Daily Rollup first."
              : `${dayRollups.length} of 7 days have a rollup ready to synthesize.`}
          </p>
          <button
            onClick={generate}
            disabled={generating || dayRollups.length === 0}
            className={`${BUTTON_PRIMARY} py-2.5 px-6 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {generating ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
            {generating ? "Generating…" : "Generate weekly rollup"}
          </button>
        </div>
      )}

      {stored && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Synthesized from {stored.dayCount} of 7 days
            </p>
            <button
              onClick={generate}
              disabled={generating || dayRollups.length === 0}
              className="text-sm text-slate-400 hover:text-white min-h-[44px] px-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
          {WEEKLY_SECTIONS.map((s) => (
            <WeeklySectionBlock key={s.key} icon={s.icon} heading={s.heading} content={stored.rollup[s.key]} />
          ))}
        </div>
      )}
    </main>
  );
}

export default function WeekPage() {
  return <WeekPageInner />;
}
```

Note: this page does not wrap `WeekPageInner` in a `<Suspense>` boundary around `useSearchParams()` the way `src/app/rollup/page.tsx` does — read that file's own top-level export (search for `Suspense`) to check whether Next 16's App Router requires it in this project's configuration, and match whatever that file actually does, since this page uses `useSearchParams()` the same way.

- [ ] **Step 2: Verify `ZapIcon` exists**

Run: `grep -n "ZapIcon" src/components/icons.tsx`
Expected: a match (it's already imported and used in `src/app/rollup/page.tsx`, confirmed during planning). If it doesn't exist for some reason, check what icon `src/app/rollup/page.tsx` actually imports for its "renegotiation/action" concept and use that instead — don't invent a new icon component.

- [ ] **Step 3: Add the "This Week" link to `src/app/rollup/page.tsx`**

Read the current file's `<header className="mb-6">` block first (shown in this task's context above — it currently ends with the push-reminder toggle/unsupported-message block). Add a new link after that block, still inside `<header>`:

```tsx
        <Link
          href="/rollup/week"
          className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 -ml-3 mt-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors w-fit"
        >
          <CalendarIcon className="w-4 h-4 flex-shrink-0" />
          This Week
        </Link>
```

`CalendarIcon` and `Link` are already imported in this file (confirmed — `CalendarIcon` is used for the page's own `<h1>`, and `Link` for the "Back to conversations" link).

- [ ] **Step 4: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Full build**

Run: `npm run build`
Expected: build succeeds, `/rollup/week` listed as a route.

- [ ] **Step 6: Manual browser check**

Run: `npm run dev` (or `npm run build && npm run start` for a more reliable check, per this codebase's history of dev-mode chunk-loading flakiness with some tooling — if you hit that, try a fresh browser tab/origin before concluding something is broken), open `http://localhost:3000/rollup`, click "This Week", confirm the week page renders: the 7-day strip, the correct week label, and either the "no daily rollups yet" state or a "N of 7 days" + Generate button state depending on what's in local storage. Click "Previous week"/"Next week" and confirm the `?start=` param and displayed week both change. If any daily rollups exist locally, click Generate and confirm either a rendered weekly rollup or a readable error (if no AI provider key is configured in this environment, expect a readable error, not a crash).

- [ ] **Step 7: Commit**

```bash
git add src/app/rollup/week/page.tsx src/app/rollup/page.tsx
git commit -m "feat(weekly-rollup): add /rollup/week page and nav link"
```

---

## Spec Coverage Check

- Input is daily rollups, not raw conversations; a day with no daily rollup is excluded, not blocking → Task 1's `generateWeeklyRollup` signature (`dailyRollups: DayRollupInput[]`), Task 3's `dayRollups` filter
- Monday–Sunday calendar week, identified by Monday's date → Task 1's `mondayOf`, Task 3's `days` array and `weekStart` computation
- Manual trigger only → Task 3's Generate button, no scheduled job anywhere in this plan
- New namespace `omi-adhd-weekly-rollups`, keyed map, added to `SYNCED_NAMESPACES` → Task 1 Step 3
- Voice matches the daily rollup exactly → Task 1's `WEEKLY_SYSTEM_PROMPT`, copying the banned-language list and tone rules verbatim
- New dedicated page, not grown into `/rollup/page.tsx` → Task 3's `src/app/rollup/week/page.tsx`
- Storage colocated in `adhd-storage.ts` → Task 1 Step 4
- Nav link from `/rollup` → Task 3 Step 3
- Out of scope (automatic generation, cross-week trend charts, editing generated text): not built anywhere in this plan — correct per spec
