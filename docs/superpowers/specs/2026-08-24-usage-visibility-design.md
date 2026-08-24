# Cost / Usage Visibility — Design Spec (2026-08-24)

## Purpose

Every analysis pass in this app calls out to a paid LLM provider, but nothing
today tells the user how much that's costing or how often it's happening.
This adds a lightweight, server-side usage log and a small dashboard page so
the user can see spend by day/week/month and by feature, without adding any
new external dependency.

## Approved decisions

- **Capture point:** a single choke point, `chatCompletion()` in
  `src/lib/analysis.ts`, which every analysis path already calls through
  (thesis, thesis-custom, ADHD, group, group-custom, rollup, people-extract).
  Add an optional `label` argument identifying the caller; each of the 7 call
  sites passes its own label.
- **Non-blocking:** usage logging never blocks or fails the calling analysis.
  If the write fails (or the store isn't configured), the analysis result is
  still returned — same degrade-gracefully posture as the existing Neon
  mirror in `src/lib/kv.ts`.
- **Storage:** a new Neon table, `trace_usage`, one row per `chatCompletion`
  call — not the JSONB-namespace pattern used elsewhere, since this is
  server-generated time-series data, not client state being mirrored.
- **Cost estimate:** a static `$/1M tokens` pricing table (input/output
  split) keyed by model-name prefix, covering the models actually in use
  (gpt-5.6-luna, claude-sonnet-5, gemini-2.0-flash, deepseek-v4). An
  unrecognized model still gets its row and token counts logged, with
  `estimated_cost_usd = NULL` rather than a guessed price.
- **Surface:** a new page, `/usage`, not a widget bolted onto an existing
  page.
- **No historical backfill.** Counting starts from when this ships.
- **Out of scope:** live/remote pricing lookups, budgets or alerts, editing
  or deleting usage rows.

## Data model

New table, created lazily on first use (mirrors how `ensureSchema` creates
`trace_store` in `kv.ts` — no separate migration step):

```sql
CREATE TABLE IF NOT EXISTS trace_usage (
  id                  BIGSERIAL PRIMARY KEY,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  label               TEXT NOT NULL,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  prompt_tokens       INT NOT NULL,
  completion_tokens   INT NOT NULL,
  estimated_cost_usd  NUMERIC(10,4)
);
CREATE INDEX IF NOT EXISTS trace_usage_created_at_idx ON trace_usage (created_at);
```

`label` values: `"thesis"`, `"thesis-custom"`, `"adhd"`, `"group"`,
`"group-custom"`, `"rollup"`, `"people-extract"`.

## Usage capture

In `src/lib/analysis.ts`:

- `chatCompletion(messages, jsonMode = false, label?: string)` gains the
  third parameter. Existing calls that omit it still work (logging is simply
  skipped for unlabeled calls) — but all 7 real call sites are updated to
  pass a label as part of this change.
- After a successful response, extract token usage from the raw provider
  response before returning just the string content:
  - OpenAI/OpenRouter: `data.usage.prompt_tokens`, `data.usage.completion_tokens`
  - Anthropic: `data.usage.input_tokens`, `data.usage.output_tokens`
  - Google: `data.usageMetadata.promptTokenCount`, `data.usageMetadata.candidatesTokenCount`
  - Normalize to `{ promptTokens, completionTokens }`; if the shape is
    missing/unrecognized, skip logging that call rather than logging zeros.
- Fire-and-forget an insert (`void logUsage(...).catch(...)`) so a slow or
  failed usage write never adds latency or an error path to the analysis
  itself. Compute `estimated_cost_usd` at write time from the static pricing
  table.
- New file `src/lib/usage.ts` holds: the pricing table, the cost calculation,
  `logUsage()` (writes to `trace_usage` via `getStore()`/`withTimeout()` from
  `kv.ts`, no-ops if the store isn't configured), and the read-side
  aggregation query used by the API route below.

## Read API

`GET /api/usage` (`src/app/api/usage/route.ts`):

- Returns `{ configured: boolean, today, thisWeek, thisMonth, byLabel, byModel }`.
- `today` / `thisWeek` / `thisMonth`: `{ costUsd: number | null, callCount: number, promptTokens: number, completionTokens: number }`, computed with `date_trunc`/`now()` in SQL, not in JS.
- `byLabel` / `byModel`: arrays of `{ key: string, costUsd: number | null, callCount: number }`, scoped to the current month, ordered by cost descending.
- If the store isn't configured, returns `{ configured: false }` and the route does not error.

## UI

New page `src/app/usage/page.tsx`, linked from wherever the app's primary
nav lives (matching how `/people` and `/rollup` are already reached):

- Three stat tiles: Today / This Week / This Month, each showing estimated
  cost (or "—" if no cost data for that period, e.g. all-unknown-model calls)
  and call count.
- Two compact tables below: "By feature" (`byLabel`) and "By model"
  (`byModel`), each row showing cost and call count, current month only.
- If `configured: false`, render the same "not configured" empty state
  pattern already used elsewhere in the app for the optional Neon store,
  rather than a generic error.
- No client-side polling; a manual refresh (page reload) is sufficient for a
  single-user tool checked occasionally.
