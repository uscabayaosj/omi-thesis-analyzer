# Cost / Usage Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the user a small `/usage` dashboard showing LLM spend (cost estimate + call counts) by day/week/month and by feature/model, sourced from a new per-call usage log written at the single choke point every analysis already goes through.

**Architecture:** `chatCompletion()` in `src/lib/analysis.ts` gains an optional `label` argument. After each successful provider response it fire-and-forgets a normalized usage row into a new Neon table (`trace_usage`), via a new `src/lib/usage.ts` module that also holds the static pricing table and the read-side aggregation query. A new `GET /api/usage` route calls the aggregation query. A new `/usage` page renders it. All 7 existing call sites are updated to pass a label.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@neondatabase/serverless` (already a dependency), Tailwind v4.

## Global Constraints

- No historical backfill — counting starts when this ships (per spec).
- Usage logging must never block or fail the calling analysis — fire-and-forget, errors swallowed and logged to console only (matches `kv.ts`'s degrade-gracefully posture).
- `estimated_cost_usd` is `NULL` for any model not in the static pricing table — never a guessed price.
- If the Neon store isn't configured (`getStore()` returns `null`), `/api/usage` returns `{ configured: false }` with a 200, not an error (matches the existing `/api/store` GET pattern in `src/app/api/store/route.ts`).
- **No test runner exists in this codebase** (no jest/vitest/tsx — confirmed: `node_modules/.bin` has none, `package.json` has no `test` script). Verification in this plan uses `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual runtime checks (curl against `npm run dev`, browser) instead of unit tests — this matches the codebase's existing conventions (zero test files anywhere in `src/`). Do not introduce a new test framework as part of this plan.

---

## File Structure

- **Create `src/lib/usage.ts`** — pricing table, cost calculation, `ensureUsageSchema()`, `logUsage()` (write side), `getUsageSummary()` (read side, used by the API route). This is the one new file holding all usage business logic, kept separate from `kv.ts` (generic store plumbing) and `analysis.ts` (provider calls).
- **Modify `src/lib/analysis.ts`** — `chatCompletion()` gains a `label` parameter and calls `logUsage()` after extracting token counts from the raw provider response.
- **Modify `src/lib/adhd.ts`, `src/lib/rollup.ts`, `src/lib/people-extract.ts`** — pass a label into their `chatCompletion()` calls.
- **Modify `src/app/api/analyze-group/route.ts`, `src/app/api/analyze-group/custom/route.ts`** — pass a label into their `chatCompletion()` calls.
- **Modify `src/lib/analysis.ts`** (again, different functions) — `analyzeConversation()` and `analyzeCustom()` pass labels too.
- **Create `src/app/api/usage/route.ts`** — `GET` handler returning the aggregated summary.
- **Create `src/app/usage/page.tsx`** — the dashboard page.
- **Modify `src/app/page.tsx`** — add a nav link to `/usage` next to the existing Rollup/People links.

---

### Task 1: Pricing table and cost calculation

**Files:**
- Create: `src/lib/usage.ts`

**Interfaces:**
- Produces: `export interface NormalizedUsage { promptTokens: number; completionTokens: number }`
- Produces: `export function estimateCostUsd(model: string, usage: NormalizedUsage): number | null`

- [ ] **Step 1: Write the pricing table and cost function**

```typescript
// src/lib/usage.ts

/**
 * Server-side usage/cost tracking for LLM calls.
 *
 * Every analysis path routes through `chatCompletion()` in `analysis.ts`,
 * which is the single point that logs a row here. Logging is fire-and-forget
 * and non-blocking by design (see logUsage below) — a usage-tracking failure
 * must never turn into an analysis failure.
 */

export interface NormalizedUsage {
  promptTokens: number;
  completionTokens: number;
}

// $ per 1M tokens, input/output split. Matched by model-name prefix (longest
// match wins) so e.g. "gpt-5.6-luna-mini" still resolves to the "gpt-5.6"
// entry if a more specific one isn't listed. Unlisted models return null from
// estimateCostUsd — never a guessed price.
const PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-5.6-luna": { input: 1.75, output: 14.0 },
  "claude-sonnet-5": { input: 3.0, output: 15.0 },
  "claude-opus-5": { input: 15.0, output: 75.0 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "deepseek/deepseek-v4": { input: 0.3, output: 1.2 },
};

function findPricing(model: string): { input: number; output: number } | null {
  // Longest-prefix match: sort candidate keys by length descending so a more
  // specific entry (if one is ever added) wins over a shorter generic one.
  const match = Object.keys(PRICING_PER_1M)
    .filter((key) => model.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PRICING_PER_1M[match] : null;
}

export function estimateCostUsd(model: string, usage: NormalizedUsage): number | null {
  const pricing = findPricing(model);
  if (!pricing) return null;
  const inputCost = (usage.promptTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 10_000) / 10_000; // 4 decimal places
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors (this file has no other imports yet, so it either compiles cleanly or the command reports pre-existing unrelated errors only — confirm by running `npx tsc --noEmit` once before this change too and diffing the error count).

- [ ] **Step 3: Manually sanity-check the cost math**

Run:
```bash
node -e '
const PRICING = { "gpt-5.6-luna": { input: 1.75, output: 14.0 } };
const promptTokens = 10000, completionTokens = 2000;
const cost = (promptTokens/1e6)*PRICING["gpt-5.6-luna"].input + (completionTokens/1e6)*PRICING["gpt-5.6-luna"].output;
console.log(Math.round(cost*10000)/10000);
'
```
Expected output: `0.0455` (10000/1e6*1.75 = 0.0175; 2000/1e6*14 = 0.028; sum = 0.0455) — confirms the arithmetic in `estimateCostUsd` is right before it's wired into anything.

- [ ] **Step 4: Commit**

```bash
git add src/lib/usage.ts
git commit -m "feat(usage): add static pricing table and cost estimation"
```

---

### Task 2: Usage table schema and write path

**Files:**
- Modify: `src/lib/usage.ts`

**Interfaces:**
- Consumes: `getStore`, `withTimeout`, `Sql` from `src/lib/kv.ts` (existing exports)
- Consumes: `NormalizedUsage`, `estimateCostUsd` from Task 1 (same file)
- Produces: `export async function logUsage(args: { label: string; provider: string; model: string; usage: NormalizedUsage }): Promise<void>`

- [ ] **Step 1: Add the schema-ensure and write function**

Append to `src/lib/usage.ts`:

```typescript
import { getStore, withTimeout, type Sql } from "./kv";

/** Created on first use, same pattern as ensureSchema() in kv.ts. */
async function ensureUsageSchema(sql: Sql): Promise<void> {
  await withTimeout(
    sql`
      CREATE TABLE IF NOT EXISTS trace_usage (
        id                  BIGSERIAL PRIMARY KEY,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        label               TEXT NOT NULL,
        provider            TEXT NOT NULL,
        model               TEXT NOT NULL,
        prompt_tokens       INT NOT NULL,
        completion_tokens   INT NOT NULL,
        estimated_cost_usd  NUMERIC(10,4)
      )
    `
  );
  await withTimeout(
    sql`CREATE INDEX IF NOT EXISTS trace_usage_created_at_idx ON trace_usage (created_at)`
  );
}

/**
 * Logs one chatCompletion call. Fire-and-forget by contract: callers do
 * `void logUsage(...)` and never await it on the request's critical path, so
 * a slow or failed write never adds latency or an error to the analysis
 * itself. This function still awaits internally (so its own errors are
 * catchable by the caller's `.catch()`) — it just isn't meant to be awaited
 * by anything that cares about the analysis result.
 */
export async function logUsage(args: {
  label: string;
  provider: string;
  model: string;
  usage: NormalizedUsage;
}): Promise<void> {
  const sql = getStore();
  if (!sql) return; // Not configured — same "just skip it" posture as kv.ts.

  const cost = estimateCostUsd(args.model, args.usage);
  await ensureUsageSchema(sql);
  await withTimeout(sql`
    INSERT INTO trace_usage (label, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd)
    VALUES (${args.label}, ${args.provider}, ${args.model}, ${args.usage.promptTokens}, ${args.usage.completionTokens}, ${cost})
  `);
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no new errors beyond any pre-existing baseline noted in Task 1 Step 2.

- [ ] **Step 3: Manually verify against a real (or local) Neon database**

If `DATABASE_URL` is set in `.env.local`, run a scratch script to confirm the table gets created and a row inserted:

```bash
node --input-type=module -e '
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
await sql`
  CREATE TABLE IF NOT EXISTS trace_usage (
    id BIGSERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    label TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    prompt_tokens INT NOT NULL, completion_tokens INT NOT NULL,
    estimated_cost_usd NUMERIC(10,4)
  )`;
await sql`INSERT INTO trace_usage (label, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd)
  VALUES ("smoke-test", "openai", "gpt-5.6-luna", 100, 50, 0.001)`;
const rows = await sql`SELECT * FROM trace_usage WHERE label = "smoke-test"`;
console.log(rows);
await sql`DELETE FROM trace_usage WHERE label = "smoke-test"`;
' 2>&1 || echo "DATABASE_URL not set locally — skip this step, Task 4 will exercise the real path via the API route"
```
Expected: a printed row with the inserted values, or the fallback message if no local `DATABASE_URL` is configured (in which case this gets exercised for real in Task 4's manual check against the dev server, which has the deployed `DATABASE_URL`).

- [ ] **Step 4: Commit**

```bash
git add src/lib/usage.ts
git commit -m "feat(usage): add trace_usage schema and logUsage write path"
```

---

### Task 3: Wire usage capture into chatCompletion and all 7 call sites

**Files:**
- Modify: `src/lib/analysis.ts:214-267` (extractContent, chatCompletion)
- Modify: `src/lib/analysis.ts:428-465` (analyzeConversation, analyzeCustom)
- Modify: `src/lib/adhd.ts:299` (analyzeAdhd's chatCompletion call)
- Modify: `src/lib/rollup.ts:115` (generateRollup's chatCompletion call)
- Modify: `src/lib/people-extract.ts:22` (extractPeople's chatCompletion call)
- Modify: `src/app/api/analyze-group/route.ts:131`
- Modify: `src/app/api/analyze-group/custom/route.ts:78`

**Interfaces:**
- Consumes: `logUsage`, `NormalizedUsage` from `src/lib/usage.ts` (Task 2)
- Produces: `chatCompletion(messages: ChatMessage[], jsonMode?: boolean, label?: string): Promise<string>` — third parameter is new and optional, so any call site that doesn't pass it still compiles and simply skips logging.

- [ ] **Step 1: Add a usage-extraction helper and thread `label` through `chatCompletion`**

In `src/lib/analysis.ts`, add near `extractContent` (after line 227):

```typescript
import { logUsage, type NormalizedUsage } from "./usage";

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
```

Then change the `chatCompletion` signature and body (replacing the existing function at line 229):

```typescript
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
  let url = config.baseUrl;

  if (provider === "google") {
    url += `?key=${config.apiKey}`;
  }

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
```

- [ ] **Step 2: Pass labels from `analyzeConversation` and `analyzeCustom`**

In `src/lib/analysis.ts`, update the two call sites (around lines 432 and 461):

```typescript
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
```

- [ ] **Step 3: Pass labels from the remaining 5 call sites**

In `src/lib/adhd.ts`, find the `chatCompletion` call at line 299 and add `"adhd"` as the third argument (preserve whatever `jsonMode` value is already passed as the second argument).

In `src/lib/rollup.ts`, find the `chatCompletion` call at line 115 and add `"rollup"` as the third argument.

In `src/lib/people-extract.ts`, find the `chatCompletion` call at line 22 and add `"people-extract"` as the third argument.

In `src/app/api/analyze-group/route.ts`, find the `chatCompletion` call at line 131 (it currently passes `true` as the second argument) and add `"group"` as the third argument.

In `src/app/api/analyze-group/custom/route.ts`, find the `chatCompletion` call at line 78 — it currently passes only one argument (the messages array), so it needs both the second (`jsonMode`, which should be `false` to preserve current behavior) and third (`"group-custom"`) arguments added.

For each of these five, the change is adding one (or two) trailing arguments to an existing call — no other logic changes. Read the exact surrounding code with the Read tool before editing, since line numbers may have drifted slightly from Tasks 1–2's edits to other files.

- [ ] **Step 4: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the linter**

Run: `npm run lint`
Expected: no new warnings/errors introduced by this task's changes.

- [ ] **Step 6: Manual runtime check**

Run: `npm run dev`, then in another terminal analyze one real conversation through the UI (thesis or ADHD lens — whichever has data available), then check the server log for any `usage logging failed` lines (there should be none) and, if `DATABASE_URL` is configured, query the table directly:

```bash
node --input-type=module -e '
import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const rows = await sql`SELECT label, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd, created_at FROM trace_usage ORDER BY created_at DESC LIMIT 5`;
console.log(rows);
'
```
Expected: the row from the analysis just run, with a non-null `prompt_tokens`/`completion_tokens` and (if the model matches the pricing table) a non-null `estimated_cost_usd`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/analysis.ts src/lib/adhd.ts src/lib/rollup.ts src/lib/people-extract.ts src/app/api/analyze-group/route.ts src/app/api/analyze-group/custom/route.ts
git commit -m "feat(usage): capture token usage from every analysis call site"
```

---

### Task 4: Read-side aggregation and `/api/usage` route

**Files:**
- Modify: `src/lib/usage.ts`
- Create: `src/app/api/usage/route.ts`

**Interfaces:**
- Consumes: `getStore`, `withTimeout` from `src/lib/kv.ts`
- Produces: `export interface UsagePeriodSummary { costUsd: number | null; callCount: number; promptTokens: number; completionTokens: number }`
- Produces: `export interface UsageBreakdownRow { key: string; costUsd: number | null; callCount: number }`
- Produces: `export interface UsageSummary { configured: boolean; today: UsagePeriodSummary; thisWeek: UsagePeriodSummary; thisMonth: UsagePeriodSummary; byLabel: UsageBreakdownRow[]; byModel: UsageBreakdownRow[] }`
- Produces: `export async function getUsageSummary(): Promise<UsageSummary>`

- [ ] **Step 1: Add the aggregation query to `src/lib/usage.ts`**

Append:

```typescript
export interface UsagePeriodSummary {
  costUsd: number | null;
  callCount: number;
  promptTokens: number;
  completionTokens: number;
}

export interface UsageBreakdownRow {
  key: string;
  costUsd: number | null;
  callCount: number;
}

export interface UsageSummary {
  configured: boolean;
  today: UsagePeriodSummary;
  thisWeek: UsagePeriodSummary;
  thisMonth: UsagePeriodSummary;
  byLabel: UsageBreakdownRow[];
  byModel: UsageBreakdownRow[];
}

const EMPTY_PERIOD: UsagePeriodSummary = { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 };

type PeriodRow = {
  cost_usd: string | null;
  call_count: string;
  prompt_tokens: string | null;
  completion_tokens: string | null;
};

function toPeriodSummary(row: PeriodRow | undefined): UsagePeriodSummary {
  if (!row || Number(row.call_count) === 0) return EMPTY_PERIOD;
  return {
    costUsd: row.cost_usd === null ? null : Number(row.cost_usd),
    callCount: Number(row.call_count),
    promptTokens: Number(row.prompt_tokens ?? 0),
    completionTokens: Number(row.completion_tokens ?? 0),
  };
}

/**
 * Aggregates trace_usage for the dashboard. All aggregation happens in SQL
 * (SUM/COUNT/date_trunc) rather than pulling raw rows into JS, so this stays
 * cheap as the table grows — see spec's "Read API" section.
 */
export async function getUsageSummary(): Promise<UsageSummary> {
  const sql = getStore();
  if (!sql) {
    return { configured: false, today: EMPTY_PERIOD, thisWeek: EMPTY_PERIOD, thisMonth: EMPTY_PERIOD, byLabel: [], byModel: [] };
  }

  await ensureUsageSchema(sql);

  const [todayRows, weekRows, monthRows, labelRows, modelRows] = await withTimeout(
    Promise.all([
      sql`SELECT SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens FROM trace_usage WHERE created_at >= date_trunc('day', now())`,
      sql`SELECT SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens FROM trace_usage WHERE created_at >= date_trunc('week', now())`,
      sql`SELECT SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens FROM trace_usage WHERE created_at >= date_trunc('month', now())`,
      sql`SELECT label AS key, SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count FROM trace_usage WHERE created_at >= date_trunc('month', now()) GROUP BY label ORDER BY cost_usd DESC NULLS LAST`,
      sql`SELECT model AS key, SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count FROM trace_usage WHERE created_at >= date_trunc('month', now()) GROUP BY model ORDER BY cost_usd DESC NULLS LAST`,
    ])
  ) as [PeriodRow[], PeriodRow[], PeriodRow[], (UsageBreakdownRow & { cost_usd: string | null; call_count: string })[], (UsageBreakdownRow & { cost_usd: string | null; call_count: string })[]];

  return {
    configured: true,
    today: toPeriodSummary(todayRows[0]),
    thisWeek: toPeriodSummary(weekRows[0]),
    thisMonth: toPeriodSummary(monthRows[0]),
    byLabel: labelRows.map((r) => ({ key: r.key, costUsd: r.cost_usd === null ? null : Number(r.cost_usd), callCount: Number(r.call_count) })),
    byModel: modelRows.map((r) => ({ key: r.key, costUsd: r.cost_usd === null ? null : Number(r.cost_usd), callCount: Number(r.call_count) })),
  };
}
```

- [ ] **Step 2: Create the API route**

```typescript
// src/app/api/usage/route.ts
import { NextResponse } from "next/server";
import { getUsageSummary } from "@/lib/usage";

// GET /api/usage → aggregated spend/call-count for the dashboard.
export async function GET() {
  try {
    const summary = await getUsageSummary();
    return NextResponse.json(summary);
  } catch (err) {
    console.error("usage summary failed:", err);
    // Degrade to "not configured" rather than a 500 — same posture as
    // /api/store: a broken usage table should not read as an app-wide error.
    return NextResponse.json({
      configured: false,
      today: { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 },
      thisWeek: { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 },
      thisMonth: { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 },
      byLabel: [],
      byModel: [],
    });
  }
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual runtime check**

Run: `npm run dev`, then in another terminal:
```bash
curl -s http://localhost:3000/api/usage | node -e "process.stdin.pipe(process.stdout)" | head -c 2000
```
Expected: JSON with `configured: true` (assuming `DATABASE_URL` is set) and `today`/`thisWeek`/`thisMonth`/`byLabel`/`byModel` populated from whatever rows Task 3's manual check inserted. If `DATABASE_URL` isn't set, expect `configured: false` and all-zero/empty fields, with no 500.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usage.ts src/app/api/usage/route.ts
git commit -m "feat(usage): add usage aggregation and GET /api/usage"
```

---

### Task 5: `/usage` dashboard page and nav link

**Files:**
- Create: `src/app/usage/page.tsx`
- Modify: `src/app/page.tsx` (nav row, around line 697-712)

**Interfaces:**
- Consumes: `UsageSummary`, `UsagePeriodSummary`, `UsageBreakdownRow` types from `src/lib/usage.ts` (Task 4) — imported as types only, the page fetches via `fetchJson` rather than calling `getUsageSummary()` directly (client component, matches how `people/page.tsx` and `rollup/page.tsx` fetch through API routes rather than importing server-only Neon code).
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`
- Consumes: `ArrowLeftIcon`, `TrendingUpIcon` from `src/components/icons.tsx` (both already exported — confirmed present)

- [ ] **Step 1: Write the page**

```tsx
// src/app/usage/page.tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import type { UsageSummary, UsagePeriodSummary, UsageBreakdownRow } from "@/lib/usage";
import { ArrowLeftIcon } from "@/components/icons";

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "—";
  return `$${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
}

function StatTile({ title, summary }: { title: string; summary: UsagePeriodSummary }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-sm text-slate-400 mb-1">{title}</div>
      <div className="text-2xl font-semibold text-white">{formatCost(summary.costUsd)}</div>
      <div className="text-sm text-slate-400 mt-1">
        {summary.callCount} {summary.callCount === 1 ? "call" : "calls"}
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: UsageBreakdownRow[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-sm text-slate-400 mb-3">{title} — this month</div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500">No calls yet this month.</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-800 first:border-t-0">
                <td className="py-2 text-slate-200">{row.key}</td>
                <td className="py-2 text-right text-slate-400">{row.callCount}</td>
                <td className="py-2 text-right text-white w-20">{formatCost(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchJson<UsageSummary>("/api/usage")
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load usage."));
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/"
        className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back
      </Link>

      <h1 className="text-2xl font-bold text-white mb-6">Usage</h1>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {!summary && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {summary && !summary.configured && (
        <p className="text-sm text-slate-400">
          Usage tracking needs the server-side store configured (same one used for cross-device sync). Nothing to show yet.
        </p>
      )}

      {summary && summary.configured && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <StatTile title="Today" summary={summary.today} />
            <StatTile title="This Week" summary={summary.thisWeek} />
            <StatTile title="This Month" summary={summary.thisMonth} />
          </div>
          <BreakdownTable title="By feature" rows={summary.byLabel} />
          <BreakdownTable title="By model" rows={summary.byModel} />
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Add the nav link on the home page**

In `src/app/page.tsx`, add `TrendingUpIcon` to the existing icons import (find the `import { ... } from "@/components/icons"` line and add `TrendingUpIcon` to the list). Then, in the nav row (the `<div className="flex items-center gap-2 flex-shrink-0">` block containing the Rollup and People links, around line 697), add a third link after the People link and before the Refresh button:

```tsx
            <Link
              href="/usage"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
            >
              <TrendingUpIcon className="w-4 h-4 flex-shrink-0" />
              Usage
            </Link>
```

- [ ] **Step 3: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Full build**

Run: `npm run build`
Expected: build succeeds, `/usage` listed as a route in the build output.

- [ ] **Step 5: Manual browser check**

Run: `npm run dev`, open `http://localhost:3000/`, click the new "Usage" nav link, confirm it navigates to `/usage` and renders either the stat tiles + tables (if `DATABASE_URL` is set and Task 3's manual check logged rows) or the "not configured" message (if not). Then navigate back via the "Back" link and confirm it returns to `/`.

- [ ] **Step 6: Commit**

```bash
git add src/app/usage/page.tsx src/app/page.tsx
git commit -m "feat(usage): add /usage dashboard page and nav link"
```

---

## Spec Coverage Check

- Capture point / label per call site → Task 3
- Non-blocking logging → Task 3 Step 1 (`void logUsage(...).catch(...)`)
- `trace_usage` table, lazy schema creation → Task 2
- Static pricing table, NULL for unknown models → Task 1
- `GET /api/usage`, SQL-side aggregation, `configured: false` degrade → Task 4
- `/usage` page, stat tiles + by-label/by-model tables, not-configured state → Task 5
- No historical backfill, no budgets/alerts, no row edit/delete → not built anywhere in this plan (correct — out of scope per spec)
