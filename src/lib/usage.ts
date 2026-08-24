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
