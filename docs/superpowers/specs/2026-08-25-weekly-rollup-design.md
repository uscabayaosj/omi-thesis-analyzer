# Weekly Rollup — Design Spec (2026-08-25)

## Purpose

Daily Rollup closes out one day at a time; nothing today shows the pattern
across a week — what kept slipping, what actually got done, what's worth
resetting going into the next one. This adds a once-a-week synthesis over
the week's already-generated daily rollups.

## Approved decisions

- **Format: LLM-written narrative**, matching the daily rollup's voice and
  synthesis style — not a stats-only view. Small added LLM cost per week,
  in exchange for actual pattern synthesis rather than raw numbers.
- **Input: the week's daily rollups, not raw conversations.** The weekly
  rollup synthesizes syntheses — it reads each available day's `StoredRollup`
  prose fields (`today_paragraph`, `aging_commitments`, `dropped`,
  `conflicts_at_risk`, `social_ledger`), the same layering the daily rollup
  already does one level down (over per-conversation ADHD extractions, not
  raw transcripts). A day with no daily rollup yet is simply excluded from
  the input — never blocking.
- **Week boundary: calendar week, Monday–Sunday.** The week is identified by
  its Monday's date (`YYYY-MM-DD`), independent of which day within it the
  user happens to be viewing.
- **Trigger: manual only**, a "Generate" button — same posture as the daily
  rollup. No scheduled/automatic generation.
- **New dedicated page, `/rollup/week`**, not grown into the existing
  `src/app/rollup/page.tsx` (already 600+ lines) — a related but distinct
  view gets its own file per the "one clear responsibility per file"
  convention already followed elsewhere in this codebase (`/usage`, `/search`
  are likewise separate from the pages that link to them).
- **Storage: new namespace `omi-adhd-weekly-rollups`**, a map keyed by the
  week's Monday date, added to `SYNCED_NAMESPACES` — same mirroring pattern
  every other namespace uses (no array-shape wrinkle this time, since it's
  a keyed map like the daily-rollups namespace).
- **Out of scope:** automatic/scheduled generation, cross-week trend charts
  or graphs, editing a generated weekly rollup's text after the fact.

## Data model

`src/lib/weekly-rollup.ts`:

```ts
export interface WeeklyRollup {
  week_summary: string;        // what the week was, one paragraph
  completion_pattern: string;  // what got done vs. didn't, the pattern across days
  chronically_aging: string;   // items carried 3+ times this week, each with a renegotiation suggestion
  dropped_this_week: string;   // what was explicitly let go
  social_pattern: string;      // the week's relationship pattern, not a day-by-day ledger
  next_week_setup: string;     // what's worth setting up heading into next week
}
```

Mirrors `Rollup` (`src/lib/adhd.ts`) in shape and coercion style: every field
a prose string, "The AI did not return this section..." fallback per field
if the model omits one, matching `toRollup`'s existing pattern in
`src/lib/rollup.ts`.

Storage record, mirroring `StoredRollup`:

```ts
export interface StoredWeeklyRollup {
  weekStart: string;   // YYYY-MM-DD, the Monday
  timestamp: string;
  dayCount: number;    // how many days of the week had a daily rollup available
  rollup: WeeklyRollup;
}
```

## Generation

`generateWeeklyRollup(weekStart: string, dailyRollups: Array<{ day: string; rollup: Rollup }>): Promise<WeeklyRollup>`
in `src/lib/weekly-rollup.ts`. Builds a prompt from each available day's
`today_paragraph`, `aging_commitments`, `dropped`, `conflicts_at_risk`, and
`social_ledger` fields (the fields most useful for week-level pattern
synthesis — `tomorrow_plan` and `tomorrow_events` are day-specific and not
included), in chronological order. Calls the existing `chatCompletion`
(`src/lib/analysis.ts`) with `jsonMode: true` and label `"weekly-rollup"`
(threading into the existing usage-tracking feature at no extra cost, same
as every other analysis call site).

System prompt keeps the daily rollup's voice rules verbatim (neutral tone,
no scolding, no ADHD mention, plain everyday words, the same banned
corporate-language list) — the weekly rollup is read by the same person for
the same purpose, so the voice must not shift.

## API

`POST /api/rollup/weekly` (`src/app/api/rollup/weekly/route.ts`):
accepts `{ weekStart: string, dailyRollups: Array<{ day: string, rollup: Rollup }> }`
(the client already has the daily rollups in localStorage — no server-side
fetch needed, matching how `/api/rollup` already receives its per-day inputs
from the client rather than looking them up itself), calls
`generateWeeklyRollup`, returns `{ rollup: WeeklyRollup }`.

## Client storage

Added directly to `src/lib/adhd-storage.ts` (165 lines today — the weekly
functions are a small, near-identical parallel to the existing
`getRollup`/`saveRollup`/`getRollupDays` trio, and colocating them keeps
"where do I look for rollup storage" a single answer rather than splitting
one concern across two files for ~20 lines of new code):
`getWeeklyRollup(weekStart)`, `getWeeklyRollupWeeks()`,
`saveWeeklyRollup(record)` — same `localStorage` + `schedulePush` pattern
every other namespace already uses.

## UI

`src/app/rollup/week/page.tsx`, reading `?start=<Monday-date>` from the
query string (defaulting to the current week's Monday if absent or
malformed). Shows:
- A 7-day strip (Mon–Sun) marking which days have a daily rollup already,
  reusing `getRollup(day)` from `src/lib/adhd-storage.ts`.
- A "Generate weekly rollup" button (disabled if zero days in the week have
  a daily rollup — nothing to synthesize).
- The rendered `WeeklyRollup` once generated, in the same prose-card layout
  style the daily rollup already uses.
- Previous/next week navigation (adjusting `?start=` by 7 days).

`src/app/rollup/page.tsx` gets one small addition: a "This Week" link next
to the existing day list, pointing at `/rollup/week` with no `?start=`
(so it defaults to the current week).
