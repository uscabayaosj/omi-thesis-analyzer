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

// Approximate: does not account for prompt-caching discounts (Anthropic
// excludes cached tokens from input_tokens; OpenAI includes them at a
// discounted rate not reflected here). Treat these figures as directional,
// not an exact bill.
export function estimateCostUsd(model: string, usage: NormalizedUsage): number | null {
  const pricing = findPricing(model);
  if (!pricing) return null;
  const inputCost = (usage.promptTokens / 1_000_000) * pricing.input;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.output;
  return Math.round((inputCost + outputCost) * 10_000) / 10_000; // 4 decimal places
}

import { getStore, withTimeout, type Sql } from "./kv";

export const USAGE_TIMEZONES = {
  london: "Europe/London",
  phoenix: "America/Phoenix",
  manila: "Asia/Manila",
} as const;

export type UsageTimezoneKey = keyof typeof USAGE_TIMEZONES;

export const DEFAULT_USAGE_TIMEZONE: UsageTimezoneKey = "manila";

export function isUsageTimezoneKey(v: unknown): v is UsageTimezoneKey {
  return typeof v === "string" && v in USAGE_TIMEZONES;
}

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

let schemaReady: Promise<void> | null = null;

async function ensureUsageSchemaOnce(sql: Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureUsageSchema(sql);
  }
  try {
    await schemaReady;
  } catch (e) {
    schemaReady = null; // allow retry on the next call if this attempt failed
    throw e;
  }
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
  await ensureUsageSchemaOnce(sql);
  await withTimeout(sql`
    INSERT INTO trace_usage (label, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd)
    VALUES (${args.label}, ${args.provider}, ${args.model}, ${args.usage.promptTokens}, ${args.usage.completionTokens}, ${cost})
  `);
}

/** Deepgram nova-3 prerecorded, pay-as-you-go, $ per audio minute. */
const DEEPGRAM_PER_MINUTE_USD = 0.0043;

/**
 * Logs one transcription call alongside the LLM rows so /usage shows the
 * whole bill. Tokens are meaningless for audio, so both token columns stay 0
 * and the cost is derived from the audio duration Deepgram actually billed.
 * Same fire-and-forget contract as logUsage.
 */
export async function logTranscriptionUsage(args: { audioSeconds: number; model?: string }): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  const cost = Math.round((args.audioSeconds / 60) * DEEPGRAM_PER_MINUTE_USD * 10_000) / 10_000;
  await ensureUsageSchemaOnce(sql);
  await withTimeout(sql`
    INSERT INTO trace_usage (label, provider, model, prompt_tokens, completion_tokens, estimated_cost_usd)
    VALUES ('transcribe', 'deepgram', ${args.model ?? "nova-3"}, 0, 0, ${cost})
  `);
}

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
export async function getUsageSummary(tzKey: UsageTimezoneKey = DEFAULT_USAGE_TIMEZONE): Promise<UsageSummary> {
  const sql = getStore();
  if (!sql) {
    return { configured: false, today: EMPTY_PERIOD, thisWeek: EMPTY_PERIOD, thisMonth: EMPTY_PERIOD, byLabel: [], byModel: [] };
  }

  const tz = USAGE_TIMEZONES[tzKey];

  await ensureUsageSchemaOnce(sql);

  const [todayRows, weekRows, monthRows, labelRows, modelRows] = await withTimeout(
    Promise.all([
      sql`SELECT SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens FROM trace_usage WHERE created_at >= (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`,
      sql`SELECT SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens FROM trace_usage WHERE created_at >= (date_trunc('week', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`,
      sql`SELECT SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count, SUM(prompt_tokens) AS prompt_tokens, SUM(completion_tokens) AS completion_tokens FROM trace_usage WHERE created_at >= (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`,
      sql`SELECT label AS key, SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count FROM trace_usage WHERE created_at >= (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) GROUP BY label ORDER BY cost_usd DESC NULLS LAST`,
      sql`SELECT model AS key, SUM(estimated_cost_usd) AS cost_usd, COUNT(*) AS call_count FROM trace_usage WHERE created_at >= (date_trunc('month', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) GROUP BY model ORDER BY cost_usd DESC NULLS LAST`,
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
