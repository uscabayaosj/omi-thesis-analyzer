# ADHD Aid — Second Analysis Layer

**Date:** 2026-08-11
**Status:** Approved design, pending implementation plan
**Author:** Ulysses S. Cabayao, SJ (with Claude Code)

## Summary

Add a second analysis lens to the Omi Thesis Analyzer: an **ADHD Aid** cognitive
prosthetic that runs alongside the existing Pioneer Sovereignty thesis analysis.
Each conversation transcript can be run through the thesis lens, the ADHD Aid
lens, or both. The ADHD Aid has two tiers:

1. **Per-conversation pass** — extracts commitments, decisions/recall, people,
   open loops, and forward planning from a single transcript into structured,
   trackable data.
2. **Daily rollup** — a stateful, calendar-day pass that merges the day's
   per-conversation outputs, deduplicates and re-prioritizes commitments, ages
   carried-over items, and produces one plan for tomorrow. It chains to the
   previous day's rollup for commitment aging and open-loop killing.

The app keeps its "Thesis Analyzer" identity; ADHD Aid is an added lens, not a
rebrand.

## Locked decisions

These were resolved during brainstorming and are not open for reinterpretation
during implementation:

1. **Scope:** Build all three pieces in one spec — (A) per-conversation ADHD
   analysis, (B) the thesis/ADHD/both lens selection across single + multi, and
   (C) the calendar-day rollup.
2. **Rollup anchor:** Calendar-day, automatic. A dedicated Daily Rollup view
   groups conversations by day; generating a rollup for a day auto-chains to the
   prior day's stored rollup for aging.
3. **ADHD data model:** Structured JSON with per-commitment done-toggles. The
   done-state is what makes rollup aging and "nothing vanished" tracking real.
4. **Multi-select + ADHD:** Batch per-conversation — runs the per-conversation
   pass on each selected conversation independently. It does **not** produce an
   ad-hoc rollup (the rollup stays day-anchored). Thesis on a multi-select
   remains group synthesis, unchanged.
5. **Label:** The lens is named **"ADHD Aid"** in the UI. (The analysis *output*
   still follows the prompt's tone rule: neutral, no "you forgot", no ADHD
   mention inside the generated text.)

## Non-goals (YAGNI)

- No custom free-form ADHD prompt route (the thesis lens has one; the ADHD lens
  does not — not requested).
- No literal "Both" button on multi-select (thesis-multi and ADHD-multi go to
  different destinations; they are offered as two side-by-side actions).
- No server-side persistence. All analysis storage stays in `localStorage`,
  consistent with the existing app.
- No app-wide tab/IA restructure. The lens model reuses existing surfaces.
- No rename of the app or its thesis branding.

## Architecture

The app already provides the reusable foundation:

- `src/lib/analysis.ts` — a provider-agnostic `chatCompletion(messages, jsonMode)`
  plus `clampTranscript`, `extractJsonObject`. These are reused as-is.
- `src/lib/omi-api.ts` — `getConversation`, `segmentsToText`.
- Client-orchestrated pipeline: pages call API routes and persist results to
  `localStorage`. The ADHD layer follows the same shape.

### Data flow

**Per-conversation ADHD (single or batch):**
1. Client POSTs `{ conversationId }` to `/api/analyze-adhd`.
2. Route fetches the conversation, builds the transcript, calls `analyzeAdhd`.
3. Route returns `{ conversation, analysis }` (structured `AdhdAnalysis`).
4. Client persists to `omi-adhd-analyses` keyed by `conversationId`.

**Daily rollup (calendar-day):**
1. Client groups the conversation list by calendar day (from `created_at`).
2. User picks a day. Client ensures every conversation that day has an
   `AdhdAnalysis` — running `/api/analyze-adhd` for any that are missing (with
   progress), tolerating partial failures.
3. Client POSTs `{ day, conversations: [{ id, title, date, analysis }], previousRollup? }`
   to `/api/rollup`, where `previousRollup` is the stored rollup for the most
   recent earlier day (if any).
4. Route calls `generateRollup(dayOutputs, previousRollup)` and returns a
   `Rollup`. It performs **no Omi fetch** — the rollup operates on the
   structured per-conversation outputs, matching the prompt's design.
5. Client persists to `omi-adhd-rollups` keyed by `YYYY-MM-DD`.

## Data model

### `AdhdAnalysis` (per conversation)

```ts
type Confidence = "FIRM" | "SOFT" | "PROPOSED";

interface AdhdCommitment {
  key: string;            // client-generated deterministic hash of who+what
  direction: "user_to_other" | "other_to_user";
  who: string;            // the counterparty (who owes / is owed)
  what: string;
  deadline: string;       // explicit or inferred; "PROPOSED: <date>" when inferred
  confidence: Confidence;
  quote: string;          // short source quote
}

interface AdhdPerson {
  name: string;
  relationship: string;
  shared: string;         // personal details worth mentioning next time
  tone: string;           // emotional read
  owed: string;           // social debt: reply, thank-you, favor ("None" if none)
}

interface AdhdAheadItem {
  event: string;
  date: string;
  prep: string;           // what prep is required ("None" if none)
  start_when: string;     // when to start prep, worked backward from the date
  conflict: string;       // flagged scheduling/impossibility issue ("None" if none)
}

interface AdhdAnalysis {
  do_today: string[];       // max 3, each with a time estimate
  commitments: AdhdCommitment[];
  remember: string[];       // decisions (with reasoning), facts, answers, recs
  people: AdhdPerson[];
  open_loops: string[];     // phrased as actionable questions
  ahead: AdhdAheadItem[];
  summary: string;          // one-line
}
```

**Commitment `key`.** Generated client-side on save as a short stable hash of
`normalize(who) + "|" + normalize(what)` where `normalize` lowercases, trims,
and collapses whitespace. Models are not asked to produce ids (they won't be
stable). The key lets done-state survive re-runs and lets the rollup dedupe.

**Done-state.** Stored outside the model output. The stored record carries
`doneKeys: string[]`; toggling a commitment checkbox adds/removes its `key`. A
re-run of `analyzeAdhd` replaces `analysis` but preserves `doneKeys` (matched by
key; keys no longer present are dropped).

### `Rollup` (per day)

```ts
interface Rollup {
  tomorrow_plan: string;       // first block + up to 4 more, ranked
  aging_commitments: string;   // carried items w/ age; renegotiation script >=3d
  conflicts_at_risk: string;   // contradictions, overcommitted slots, overflow
  social_ledger: string;       // <=3 cheap high-value social actions + pending
  tomorrow_events: string;     // time-ordered w/ prep status
  today_paragraph: string;     // 3-4 sentence reconstruction + drift observation
  dropped: string;             // loops/items closed or killed, so nothing vanishes
}
```

The rollup fields are prose blocks (the prompt's output is narrative by design —
a plan to read in 60 seconds, not a table to re-parse). Structured commitment
data enters via the per-conversation `AdhdAnalysis` inputs and the prior
`Rollup`.

## Libraries

### `src/lib/adhd.ts`

- `ADHD_SYSTEM_PROMPT` — the per-conversation cognitive-prosthetic prompt from
  `omi-adhd-prompt.md`, rewritten to demand valid JSON matching `AdhdAnalysis`
  (the same technique `analysis.ts` uses: describe each field, then require an
  exact JSON schema). Tone rules preserved verbatim in the prompt.
- `analyzeAdhd(transcript: string, title: string, date: string): Promise<AdhdAnalysis>`
  — calls `chatCompletion([...], true)`, parses with `extractJsonObject`, and
  coerces to `AdhdAnalysis` with per-field fallbacks (mirroring `toAnalysis`).
  `date` is passed so the model can infer/propose deadlines relative to it.
- A `toAdhdAnalysis(raw)` coercer that guarantees array fields are arrays and
  string fields are strings, so the UI never crashes on a malformed response.

### `src/lib/rollup.ts`

- `ROLLUP_SYSTEM_PROMPT` — the daily-rollup prompt from
  `omi-adhd-daily-rollup-prompt.md`, rewritten to emit JSON matching `Rollup`.
- `generateRollup(day: string, conversations: DayConvoOutput[], previousRollup?: Rollup): Promise<Rollup>`
  — builds a user prompt that concatenates each conversation's structured ADHD
  output and, when present, the previous rollup (for aging + loop-killing).
  Uses `chatCompletion([...], true)` + `extractJsonObject`.

### `src/lib/adhd-storage.ts`

Separate from `storage.ts` (which is thesis-shaped) to keep both focused.

```ts
// key: "omi-adhd-analyses"  -> Record<conversationId, StoredAdhdAnalysis>
interface StoredAdhdAnalysis {
  conversationId: string;
  timestamp: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
  doneKeys: string[];
}

// key: "omi-adhd-rollups"   -> Record<day /* YYYY-MM-DD */, StoredRollup>
interface StoredRollup {
  day: string;
  timestamp: string;
  conversationIds: string[];
  rollup: Rollup;
}
```

Functions (mirroring `storage.ts` style, with corrupted-storage guards and
`QuotaExceededError` handling):
- `getAdhdAnalysis(id)`, `saveAdhdAnalysis(record)`, `getAdhdAnalyzedIds()`
- `toggleCommitmentDone(id, key)`, returns updated `doneKeys`
- `getRollup(day)`, `saveRollup(record)`, `getRollupDays()`
- `getPreviousRollup(day)` — most recent stored rollup for a day earlier than
  `day`, used for chaining.

## API routes

### `POST /api/analyze-adhd`

Mirrors `/api/analyze`. Body `{ conversationId }`. Validates, fetches the
conversation, 404s when there is no transcript, calls `analyzeAdhd`, returns
`{ conversation, analysis }`. Uses `friendlyError` for failures.

### `POST /api/rollup`

Body `{ day, conversations: [{ id, title, date, analysis }], previousRollup? }`.
Validates that `conversations` is a non-empty array of ADHD outputs. Calls
`generateRollup`. Returns `{ rollup }`. No Omi fetch. Uses `friendlyError`.

## UI

### Conversation detail page (`src/app/conversation/[id]/page.tsx`)

- Add a lens toggle — `Thesis | ADHD Aid | Both` — above the analyze area. The
  selected lens(es) determine which analyze action(s) run and which result
  blocks render. Default: if exactly one lens has a stored analysis, select it;
  if both or neither exist, default to **Thesis** (preserves current behavior).
  When "Both" is chosen with no stored results, the analyze action runs the two
  passes and stacks both result blocks (thesis first).
- **Code-health cleanup (in-scope, targeted):** the page is ~750 lines. Extract
  the existing thesis results rendering into `src/components/ThesisResults.tsx`
  and add `src/components/AdhdResults.tsx`. The page orchestrates state and
  data; the components render. No behavior change to the thesis path.
- `AdhdResults.tsx` renders:
  - **Do today** — list, each with its time estimate.
  - **Commitments** — a table (Who→Whom, What, **Deadline** bold, Confidence)
    with a leading done-checkbox per row bound to `doneKeys`; the source quote
    shown under each row. Toggling persists immediately.
  - **Remember** — bullet list.
  - **People** — one card per person (relationship, shared, tone, owed).
  - **Open loops** — list of actionable questions.
  - **Ahead** — event, date, prep, when-to-start, any conflict flagged.
  - **One-line summary**.
- ADHD results get the same Obsidian / Download-.md export controls the thesis
  results have, wired to the new export builders.

### Home list page (`src/app/page.tsx`)

- The analyzed indicator becomes two small lens badges — **T** (thesis) and
  **A** (ADHD Aid) — each lit when that lens has a stored analysis. Replaces the
  single green check while keeping the same visual footprint.
- Select-mode toolbar offers two explicit actions instead of one:
  - **Group Thesis (n)** → navigates to `/analyze-group?ids=...` (unchanged).
  - **Run ADHD (n)** → batch per-conversation ADHD, run **in place**:
    sequential calls to `/api/analyze-adhd`, a progress indicator (`k / n`),
    partial-success tolerant (a failed conversation is reported and skipped).
    On completion the lens badges update.
- A **Daily Rollup** link is added to the header (e.g. next to Refresh).
- The existing `all / analyzed / unanalyzed` filter is retained; "analyzed"
  means **any lens** has a stored analysis (thesis OR ADHD Aid). No new
  per-lens filter is added in this spec (YAGNI — revisit if needed).

### Daily Rollup page (`src/app/rollup/page.tsx`, new)

- Lists days that contain conversations, newest first. Each row shows the day,
  the conversation count, and a badge if a rollup already exists.
- Selecting a day shows that day's conversations with per-conversation ADHD
  status (analyzed / not yet). A **Generate Rollup** button:
  1. Runs `/api/analyze-adhd` for any conversation that day lacking an
     `AdhdAnalysis` (progress, partial-success tolerant).
  2. Looks up `getPreviousRollup(day)`.
  3. POSTs the day's outputs + previous rollup to `/api/rollup`.
  4. Persists via `saveRollup` and renders.
- Renders the seven `Rollup` sections with the prompt's emoji headings
  (🌅 Tomorrow's plan, ⏳ Aging commitments, ⚠️ Conflicts & at-risk,
  👥 Social ledger, 📅 Tomorrow's events, 🧠 Today in one paragraph,
  🗑 Dropped). Exportable to Obsidian / markdown.

## Export (`src/lib/obsidian.ts`)

Add two builders alongside the existing thesis one, each with the same
`MAX_URI_LENGTH` fallback to `downloadMarkdown`:
- ADHD per-conversation note — frontmatter `type: adhd-analysis`, tags include
  `adhd-aid`; renders commitments (with ✅/⬜ per done-state), remember, people,
  loops, ahead, summary.
- Daily rollup note — frontmatter `type: adhd-rollup`, `date: <day>`; renders the
  seven sections.

## Icons (`src/components/icons.tsx`)

Add three icons the set lacks: **UsersIcon** (People), **CalendarIcon** (Ahead /
Tomorrow's events), **CheckSquareIcon** (done-toggle). Follow the existing
`className`-prop SVG convention.

## Error handling

- Both routes reuse `friendlyError` and the existing timeout/clamp behavior in
  `analysis.ts` (`AI_TIMEOUT_MS`, `clampTranscript`, `extractJsonObject`).
- Batch and rollup pipelines tolerate partial failure: a conversation that fails
  to analyze is surfaced (count + message) and skipped; the run continues.
- `toAdhdAnalysis` coercion guarantees renderable shapes even on malformed model
  output, so the UI degrades gracefully rather than throwing.
- `localStorage` helpers guard against corrupted JSON and `QuotaExceededError`,
  matching `storage.ts`.

## Testing / verification

The project has no test harness today; verification is manual via the dev server
and the browser preview (per the repo's verification workflow):
- Per-conversation ADHD on a single conversation renders all sections; deadlines
  bold; commitment checkboxes persist across reload.
- Re-running per-conversation ADHD preserves `doneKeys` by key.
- Batch ADHD over a multi-select updates lens badges and tolerates a forced
  failure (e.g. a conversation with no transcript).
- Daily Rollup for a day with 2+ conversations generates, chains to a prior
  day's rollup (aging visible), and persists.
- Obsidian export + markdown download produce valid notes for both new types.
- Thesis flows (single, group, custom) remain unchanged.

## Build order

1. Data/types (`AdhdAnalysis`, `Rollup`) + `adhd.ts`.
2. `POST /api/analyze-adhd`.
3. `adhd-storage.ts`.
4. Conversation-page lens toggle + `ThesisResults`/`AdhdResults` extraction +
   done-toggle persistence.
5. Home-page lens badges + batch ADHD action + Daily Rollup link.
6. `rollup.ts` + `POST /api/rollup`.
7. Daily Rollup page.
8. Export builders + icons.
9. Manual verification pass.
