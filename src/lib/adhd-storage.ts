"use client";

import type { AdhdAnalysis, Rollup } from "./adhd";
import type { WeeklyRollup } from "./weekly-rollup";
import { schedulePush } from "./sync";
import { isSyncedNamespace } from "./kv";
import { syncAppBadge } from "./badge";

export interface StoredAdhdAnalysis {
  conversationId: string;
  timestamp: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
  /** Commitment keys the user has marked done. */
  doneKeys: string[];
  /** When `doneKeys` last changed. Its own clock, because ticking must not
   *  restamp `timestamp` (that means "when this analysis was produced") and
   *  without it a tick had no way to win a cross-device merge. */
  doneKeysUpdatedAt?: string;
}

export interface StoredRollup {
  day: string; // YYYY-MM-DD
  /** Last-write clock for cross-device merge. NOT "when this was generated" —
   *  restoring a replaced rollup rewrites this so the undo can win a merge,
   *  which is why `generatedAt` exists separately. */
  timestamp: string;
  /** When the rollup was actually produced. What the export reports. Optional
   *  for records written before the two meanings were separated; readers fall
   *  back to `timestamp`. */
  generatedAt?: string;
  conversationIds: string[];
  rollup: Rollup;
  /** Plan-step keys the user has ticked. Keyed by content hash, so ticking
   *  survives regenerating the same day as long as the step's text is stable. */
  planDoneKeys?: string[];
  /** When `planDoneKeys` last changed — same reasoning as `doneKeysUpdatedAt`. */
  planDoneUpdatedAt?: string;
}

const ANALYSES_KEY = "omi-adhd-analyses";
const ROLLUPS_KEY = "omi-adhd-rollups";
const WEEKLY_ROLLUPS_KEY = "omi-adhd-weekly-rollups";

// ── low-level ──

function readMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, T> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        result[k] = v as T;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeMapOnce<T>(key: string, map: Record<string, T>): void {
  localStorage.setItem(key, JSON.stringify(map));
  // Mirror to the durable store so the other device sees it. Debounced and
  // fire-and-forget — localStorage already holds the write.
  if (isSyncedNamespace(key)) schedulePush(key);
  // Keep the PWA icon badge in step with unacknowledged commitments the
  // moment they change, not just on next app open.
  if (key === ANALYSES_KEY) syncAppBadge(Object.values(map) as StoredAdhdAnalysis[]);
}

function writeMap<T>(key: string, map: Record<string, T>): void {
  try {
    writeMapOnce(key, map);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      // Drop the oldest half of entries (by timestamp) and retry once, rather
      // than silently losing the analysis/rollup the user just ran.
      const entries = Object.entries(map) as [string, T & { timestamp?: string }][];
      entries.sort((a, b) => (a[1].timestamp ?? "").localeCompare(b[1].timestamp ?? ""));
      const keep = entries.slice(Math.ceil(entries.length / 2));
      const pruned = Object.fromEntries(keep) as Record<string, T>;
      try {
        writeMapOnce(key, pruned);
        console.error(`localStorage quota exceeded writing ${key}; pruned oldest entries to fit`);
      } catch {
        console.error(`localStorage quota exceeded writing ${key} even after pruning — write lost`);
      }
    } else {
      console.error(`localStorage write failed for ${key}`, e);
    }
  }
}

// ── ADHD analyses ──

export function getAdhdAnalysis(id: string): StoredAdhdAnalysis | null {
  const map = readMap<StoredAdhdAnalysis>(ANALYSES_KEY);
  return map[id] ?? null;
}

export function getAdhdAnalyzedIds(): Set<string> {
  return new Set(Object.keys(readMap<StoredAdhdAnalysis>(ANALYSES_KEY)));
}

/**
 * conversationId → the analysis's one-line summary.
 *
 * Omi returns an empty `structured.title` for most recordings, so the
 * conversation list rendered every row as "Untitled" and the only thing
 * separating one from another was its timestamp. The ADHD pass already
 * produces a human sentence about each conversation; this exposes it as a map
 * so the list can be titled by what was said rather than by what Omi failed to
 * name. Built once by the caller and passed down — never read per row.
 */
export function getAdhdSummaries(): Map<string, string> {
  const out = new Map<string, string>();
  for (const a of Object.values(readMap<StoredAdhdAnalysis>(ANALYSES_KEY))) {
    const s = a.analysis?.summary?.trim();
    if (s) out.set(a.conversationId, s);
  }
  return out;
}

/** Every stored ADHD analysis. The open-promises ledger reads across all of
 *  them, since a commitment's home is the person it is owed to, not the one
 *  conversation it happened to be spoken in. */
export function getAllAdhdAnalyses(): StoredAdhdAnalysis[] {
  return Object.values(readMap<StoredAdhdAnalysis>(ANALYSES_KEY));
}

export function saveAdhdAnalysis(record: {
  conversationId: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
}): StoredAdhdAnalysis {
  const map = readMap<StoredAdhdAnalysis>(ANALYSES_KEY);
  const prev = map[record.conversationId];

  // Preserve done-state for commitments that still exist after re-analysis.
  const liveKeys = new Set(record.analysis.commitments.map((c) => c.key));
  const prevDoneKeys = Array.isArray(prev?.doneKeys) ? prev.doneKeys : [];
  const doneKeys = prevDoneKeys.filter((k) => liveKeys.has(k));

  const stored: StoredAdhdAnalysis = {
    conversationId: record.conversationId,
    timestamp: new Date().toISOString(),
    title: record.title,
    date: record.date,
    analysis: record.analysis,
    doneKeys,
  };
  map[record.conversationId] = stored;
  writeMap(ANALYSES_KEY, map);
  return stored;
}

export function toggleCommitmentDone(id: string, key: string): string[] {
  const map = readMap<StoredAdhdAnalysis>(ANALYSES_KEY);
  const stored = map[id];
  if (!stored) return [];
  const set = new Set(Array.isArray(stored.doneKeys) ? stored.doneKeys : []);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  stored.doneKeys = Array.from(set);
  // Stamp the tick itself, not the analysis. Without this the merge had only
  // identical analysis timestamps to compare and resolved the tie to the
  // server, so a tick was reverted whenever the debounced push had not landed.
  stored.doneKeysUpdatedAt = new Date().toISOString();
  writeMap(ANALYSES_KEY, map);
  return stored.doneKeys;
}

export function togglePlanStepDone(day: string, key: string): string[] {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  const stored = map[day];
  if (!stored) return [];
  const set = new Set(Array.isArray(stored.planDoneKeys) ? stored.planDoneKeys : []);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  stored.planDoneKeys = Array.from(set);
  stored.planDoneUpdatedAt = new Date().toISOString();
  writeMap(ROLLUPS_KEY, map);
  return stored.planDoneKeys;
}

// ── rollups ──

export function getRollup(day: string): StoredRollup | null {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  return map[day] ?? null;
}

export function getRollupDays(): string[] {
  return Object.keys(readMap<StoredRollup>(ROLLUPS_KEY)).sort().reverse();
}

export function saveRollup(record: {
  day: string;
  conversationIds: string[];
  rollup: Rollup;
}): StoredRollup {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  // Carry ticked plan steps across a regeneration. The key is a hash of the
  // step's text, so a step the model rewords is correctly treated as new
  // while an unchanged one keeps its state — the same contract commitments
  // already have. Keys with no surviving step are pruned rather than kept
  // forever, since the done-count is rendered against the new step list.
  const surviving = new Set((record.rollup.plan_steps ?? []).map((st) => st.key));
  const carried = (map[record.day]?.planDoneKeys ?? []).filter((k) => surviving.has(k));
  const now = new Date().toISOString();
  const stored: StoredRollup = {
    day: record.day,
    timestamp: now,
    generatedAt: now,
    conversationIds: record.conversationIds,
    rollup: record.rollup,
    // Carry the tick clock with the ticks, or restored ticks would lose the
    // stamp that lets them win a merge.
    ...(carried.length
      ? { planDoneKeys: carried, planDoneUpdatedAt: map[record.day]?.planDoneUpdatedAt ?? new Date().toISOString() }
      : {}),
  };
  map[record.day] = stored;
  writeMap(ROLLUPS_KEY, map);
  return stored;
}

/** Most recent stored rollup for a day strictly earlier than `day`. */
/** Write a previously-saved rollup back verbatim, timestamp included.
 *  Regenerating a day replaced its rollup with no recovery path — rollups keep
 *  no version history, so the confirm dialog was the only thing between the
 *  user and losing a day-close permanently. */
export function restoreRollup(stored: StoredRollup): void {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  // Restoring is a NEW write, so it needs a fresh merge clock: the regeneration
  // it undoes already pushed a newer record to the server, and replaying the
  // old record with its old timestamp would simply lose the next merge and the
  // undo would silently revert. The rollup's real generation time is preserved
  // separately so the export keeps reporting the truth.
  map[stored.day] = {
    ...stored,
    generatedAt: stored.generatedAt ?? stored.timestamp,
    timestamp: new Date().toISOString(),
  };
  writeMap(ROLLUPS_KEY, map);
}

export function getPreviousRollup(day: string): StoredRollup | null {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  const earlier = Object.keys(map).filter((d) => d < day).sort();
  const prevDay = earlier[earlier.length - 1];
  return prevDay ? map[prevDay] : null;
}

// ── weekly rollups ──

export interface StoredWeeklyRollup {
  weekStart: string; // YYYY-MM-DD, the Monday
  timestamp: string;
  dayCount: number;
  rollup: WeeklyRollup;
}

export function getWeeklyRollup(weekStart: string): StoredWeeklyRollup | null {
  const map = readMap<StoredWeeklyRollup>(WEEKLY_ROLLUPS_KEY);
  return map[weekStart] ?? null;
}

export function saveWeeklyRollup(record: {
  weekStart: string;
  dayCount: number;
  rollup: WeeklyRollup;
}): StoredWeeklyRollup {
  const map = readMap<StoredWeeklyRollup>(WEEKLY_ROLLUPS_KEY);
  const stored: StoredWeeklyRollup = {
    weekStart: record.weekStart,
    timestamp: new Date().toISOString(),
    dayCount: record.dayCount,
    rollup: record.rollup,
  };
  map[record.weekStart] = stored;
  writeMap(WEEKLY_ROLLUPS_KEY, map);
  return stored;
}
