import { NextRequest, NextResponse } from "next/server";
import { loadConversation } from "@/lib/conversations";
import { after } from "next/server";
import { segmentsToText } from "@/lib/conversation-types";
import { analyzeAdhd, type AdhdAnalysis, type Rollup } from "@/lib/adhd";
import { generateRollup, type DayConvoOutput } from "@/lib/rollup";
import { getStore, ensureSchema, getNamespaceData, putNamespaceData, type Sql } from "@/lib/kv";
import { getRollupJob, setRollupJob, tryClaimRollupJob } from "@/lib/rollup-job";
import { mergeMaps, type RecordMap } from "@/lib/merge";

/**
 * Server-side daily rollup: unlike the per-conversation analyze/rollup
 * routes, this one runs the *whole* day's batch (analyze every conversation,
 * then summarize) inside `after()` so it keeps going after the response is
 * sent — and, crucially, after the browser tab that started it closes.
 * Progress is polled via GET, backed by the same durable store the analyses
 * and rollups already sync through, so a returning client (or a different
 * device) picks the run up rather than losing it.
 */
export const maxDuration = 300;

interface ConvoLite {
  id: string;
  created_at: string;
  structured?: { title?: string };
}

interface StoredAdhdAnalysis {
  conversationId: string;
  timestamp: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
  doneKeys: string[];
  /** Retired promises — read here so the rollup prompt does not report them
   *  as open (see fmtCommitment in rollup.ts). Never written by this route. */
  letGoKeys?: string[];
}

interface StoredRollup {
  day: string;
  timestamp: string;
  /** When the rollup was produced; `timestamp` is the merge clock. Mirrors the
   *  client's StoredRollup so the export reports the right time either way. */
  generatedAt?: string;
  conversationIds: string[];
  rollup: Rollup;
}

/**
 * Write new records into a namespace without clobbering anything else in it.
 *
 * The job used to read a namespace at the start of a run, spend minutes in
 * LLM calls, then write the whole map back — discarding every record the
 * phone pushed in between (a ticked promise, a let-go, an analysis run on the
 * other device). Re-reading immediately before the write and merging with the
 * same rule the sync layer uses (newest record wins; done-state fields on
 * their own clocks) means this route can only ever add.
 */
async function mergeIntoNamespace(sql: Sql, ns: string, created: RecordMap): Promise<void> {
  if (Object.keys(created).length === 0) return;
  const fresh = (await getNamespaceData(sql, ns)) as RecordMap | null;
  const base: RecordMap = fresh && typeof fresh === "object" && !Array.isArray(fresh) ? fresh : {};
  await putNamespaceData(sql, ns, mergeMaps(created, base));
}

const ANALYSES_NS = "omi-adhd-analyses";
const ROLLUPS_NS = "omi-adhd-rollups";

export async function POST(req: NextRequest) {
  const sql = getStore();
  if (!sql) {
    // No durable store provisioned — the client falls back to running the
    // batch itself, tab-bound, same as before this feature existed.
    return NextResponse.json({ error: "not_configured" }, { status: 501 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }
  const day = (body as { day?: unknown })?.day;
  const conversations = (body as { conversations?: unknown })?.conversations;
  if (typeof day !== "string" || !day || !Array.isArray(conversations) || conversations.length === 0) {
    return NextResponse.json({ error: "Missing day or conversations." }, { status: 400 });
  }

  await ensureSchema(sql);

  // Atomic claim: succeeds only if no live (non-stale) job already owns this
  // day, so a second tab or a second device tapping "Generate" at the same
  // moment can't start a duplicate LLM batch.
  const claimed = await tryClaimRollupJob(day, conversations.length);
  if (!claimed) {
    const existing = await getRollupJob(day);
    return NextResponse.json({ started: false, job: existing });
  }

  after(() =>
    runRollupJob(sql, day, conversations as ConvoLite[]).catch(async (err) => {
      console.error("rollup job failed:", err);
      await setRollupJob(day, {
        day, status: "error", total: claimed.total, done: 0, failed: 0,
        error: err instanceof Error ? err.message : "Rollup job failed",
        updatedAt: new Date().toISOString(),
      });
    })
  );

  return NextResponse.json({ started: true, job: claimed });
}

export async function GET(req: NextRequest) {
  const day = req.nextUrl.searchParams.get("day");
  if (!day) return NextResponse.json({ error: "Missing day." }, { status: 400 });
  const job = await getRollupJob(day);
  return NextResponse.json({ job });
}

async function runRollupJob(sql: Sql, day: string, dayConvos: ConvoLite[]): Promise<void> {
  const total = dayConvos.length;
  let done = 0;
  let failed = 0;

  const existingAnalyses = (await getNamespaceData(sql, ANALYSES_NS)) as Record<string, StoredAdhdAnalysis> | null;
  const analysesMap: Record<string, StoredAdhdAnalysis> =
    existingAnalyses && typeof existingAnalyses === "object" ? { ...existingAnalyses } : {};

  const outputs: DayConvoOutput[] = [];
  // Only what this run produced. Written back through a merge, never as the
  // whole map (see mergeIntoNamespace).
  const created: Record<string, StoredAdhdAnalysis> = {};

  for (const c of dayConvos) {
    try {
      let stored = analysesMap[c.id];
      if (!stored) {
        const convo = await loadConversation(c.id);
        if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
          throw new Error("no transcript");
        }
        const transcript = segmentsToText(convo.transcript_segments);
        // The client fills structured.title from its enrichment cache before
        // posting, so `c.structured.title` carries the human name a bare TRACE
        // conversation would otherwise lack.
        const title = convo.structured?.title || c.structured?.title || "Untitled Conversation";
        const date = convo.created_at || c.created_at;
        const analysis = await analyzeAdhd(transcript, title, date);
        stored = {
          conversationId: c.id,
          timestamp: new Date().toISOString(),
          title,
          date,
          analysis,
          doneKeys: [],
        };
        analysesMap[c.id] = stored;
        created[c.id] = stored;
      }
      outputs.push({
        title: stored.title,
        date: stored.date || c.created_at,
        analysis: stored.analysis,
        doneKeys: Array.isArray(stored.doneKeys) ? stored.doneKeys : [],
        letGoKeys: Array.isArray(stored.letGoKeys) ? stored.letGoKeys : [],
      });
    } catch {
      failed++;
    }
    done++;
    await setRollupJob(day, { day, status: "running", total, done, failed, updatedAt: new Date().toISOString() });
  }

  // Persist whatever got analyzed even if the rollup step below fails, so a
  // retry (or another device) doesn't redo work that already succeeded.
  await mergeIntoNamespace(sql, ANALYSES_NS, created as unknown as RecordMap);

  if (outputs.length === 0) {
    await setRollupJob(day, {
      day, status: "error", total, done, failed,
      error: "None of this day's conversations could be analyzed, so there is nothing to roll up.",
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  const existingRollups = (await getNamespaceData(sql, ROLLUPS_NS)) as Record<string, StoredRollup> | null;
  const rollupsMap: Record<string, StoredRollup> =
    existingRollups && typeof existingRollups === "object" ? { ...existingRollups } : {};
  const earlierDay = Object.keys(rollupsMap).filter((d) => d < day).sort().at(-1);
  const previousRollup = earlierDay ? rollupsMap[earlierDay].rollup : undefined;

  const rollup = await generateRollup(day, outputs, previousRollup);

  const now = new Date().toISOString();
  const record: StoredRollup = {
    day,
    timestamp: now,
    generatedAt: now,
    conversationIds: dayConvos.map((c) => c.id),
    rollup,
  };
  // Merged, not replaced: the merge's done-field rule carries the day's
  // ticked plan steps (planDoneKeys, on their own clock) onto this new
  // record, and every other day's rollup is untouched.
  await mergeIntoNamespace(sql, ROLLUPS_NS, { [day]: record } as unknown as RecordMap);

  await setRollupJob(day, { day, status: "done", total, done, failed, rollup, updatedAt: new Date().toISOString() });
}
