/**
 * Display helpers for ADHD-lens strings, kept dependency-free (like merge.ts
 * and enrich-core.ts) so node --test can import them directly without
 * resolving the app's extensionless import graph. adhd.ts re-exports them.
 */

/**
 * Normalise the three shapes a deadline arrives in, for display.
 *
 * "None." means there is no deadline and the row should simply not claim one;
 * an "Estimated: " prefix means the model inferred it, which is worth saying
 * once rather than twice ("Deadline: Estimated: …"). Shared by the promises
 * ledger and the per-conversation results so the two cannot disagree.
 */
export function formatDeadline(raw: string | undefined): { label: string; value: string } | null {
  const t = (raw ?? "").trim();
  if (!t || /^none\.?$/i.test(t) || /^no date given\.?$/i.test(t)) return null;
  const est = t.match(/^estimated:\s*(.+)$/i);
  if (est) return { label: "Estimated deadline:", value: est[1] };
  return { label: "Deadline:", value: t };
}

/** An LLM "None" is the schema's way of saying absent — treat it as empty. */
export function meaningful(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v || /^none\.?$/i.test(v)) return undefined;
  return v;
}
