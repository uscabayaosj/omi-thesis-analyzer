"use client";

import type { AdhdAnalysis, Rollup } from "./adhd";
import { schedulePush } from "./sync";
import { isSyncedNamespace } from "./kv";

export interface StoredAdhdAnalysis {
  conversationId: string;
  timestamp: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
  /** Commitment keys the user has marked done. */
  doneKeys: string[];
}

export interface StoredRollup {
  day: string; // YYYY-MM-DD
  timestamp: string;
  conversationIds: string[];
  rollup: Rollup;
}

const ANALYSES_KEY = "omi-adhd-analyses";
const ROLLUPS_KEY = "omi-adhd-rollups";

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

function writeMap<T>(key: string, map: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
    // Mirror to the durable store so the other device sees it. Debounced and
    // fire-and-forget — localStorage already holds the write.
    if (isSyncedNamespace(key)) schedulePush(key);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`localStorage quota exceeded writing ${key}`);
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
  writeMap(ANALYSES_KEY, map);
  return stored.doneKeys;
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
  const stored: StoredRollup = {
    day: record.day,
    timestamp: new Date().toISOString(),
    conversationIds: record.conversationIds,
    rollup: record.rollup,
  };
  map[record.day] = stored;
  writeMap(ROLLUPS_KEY, map);
  return stored;
}

/** Most recent stored rollup for a day strictly earlier than `day`. */
export function getPreviousRollup(day: string): StoredRollup | null {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  const earlier = Object.keys(map).filter((d) => d < day).sort();
  const prevDay = earlier[earlier.length - 1];
  return prevDay ? map[prevDay] : null;
}
