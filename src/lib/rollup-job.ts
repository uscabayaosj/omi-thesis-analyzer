import type { Rollup } from "@/lib/adhd";
import { getStore, ensureSchema, withTimeout, getNamespaceData, putNamespaceData } from "@/lib/kv";

// Comfortably past the job route's 300s maxDuration: a "running" row this old
// didn't just fall behind on progress, it stopped — the function that owned
// it was killed by the platform timeout or a server restart mid-batch, with
// no chance to write a final status. Left alone, that reads to the client as
// "Analyzing…" forever, with no way to retry (the button stays disabled
// while a job looks running). Treating age past this line as failure is what
// makes the run recoverable instead of a permanent stuck state.
const STALE_MS = 6 * 60 * 1000;

function isStale(job: RollupJobState): boolean {
  return job.status === "running" && Date.now() - Date.parse(job.updatedAt) > STALE_MS;
}

/**
 * Status of a server-side daily-rollup run, keyed by day. Lives in the same
 * `trace_store` table as the synced analysis namespaces, under its own
 * `rollup-job:` prefix — it's job bookkeeping, not user data, so it's kept out
 * of SYNCED_NAMESPACES (nothing should mirror it back into localStorage).
 */
export interface RollupJobState {
  day: string;
  status: "running" | "done" | "error";
  total: number;
  done: number;
  failed: number;
  rollup?: Rollup;
  error?: string;
  updatedAt: string;
}

function jobNamespace(day: string): string {
  return `rollup-job:${day}`;
}

export async function getRollupJob(day: string): Promise<RollupJobState | null> {
  const sql = getStore();
  if (!sql) return null;
  await ensureSchema(sql);
  const data = (await getNamespaceData(sql, jobNamespace(day))) as RollupJobState | null;
  if (!data) return null;
  if (isStale(data)) {
    const healed: RollupJobState = {
      ...data,
      status: "error",
      error: "This run stalled and never finished — the server may have restarted mid-way. Try again.",
      updatedAt: new Date().toISOString(),
    };
    await putNamespaceData(sql, jobNamespace(day), healed);
    return healed;
  }
  return data;
}

export async function setRollupJob(day: string, state: RollupJobState): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  await ensureSchema(sql);
  await putNamespaceData(sql, jobNamespace(day), state);
}

/**
 * Atomically claim the right to run this day's job — succeeds only if no
 * (non-stale) job is already running for this day. Without this, two devices
 * tapping "Generate rollup" for the same day within the same moment (this
 * app is explicitly used from both phone and desktop) would both kick off a
 * full LLM batch, double the cost, and race each other's writes to the same
 * analyses/rollup records.
 */
export async function tryClaimRollupJob(day: string, total: number): Promise<RollupJobState | null> {
  const sql = getStore();
  if (!sql) return null;
  await ensureSchema(sql);
  const ns = jobNamespace(day);
  const initial: RollupJobState = {
    day, status: "running", total, done: 0, failed: 0, updatedAt: new Date().toISOString(),
  };
  const staleCutoff = new Date(Date.now() - STALE_MS).toISOString();
  const rows = (await withTimeout(sql`
    INSERT INTO trace_store (namespace, data, updated_at)
    VALUES (${ns}, ${JSON.stringify(initial)}::jsonb, now())
    ON CONFLICT (namespace) DO UPDATE
      SET data = ${JSON.stringify(initial)}::jsonb, updated_at = now()
      WHERE trace_store.data->>'status' != 'running'
         OR (trace_store.data->>'updatedAt')::timestamptz < ${staleCutoff}::timestamptz
    RETURNING data
  `)) as { data: RollupJobState }[];
  // No row returned means the WHERE excluded every candidate — someone else
  // already holds a live claim, so the caller must not start a second run.
  return rows[0]?.data ?? null;
}
