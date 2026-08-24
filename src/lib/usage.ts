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
