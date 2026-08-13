"use client";

import { schedulePush } from "./sync";

export interface StoredAnalysis {
  id: string;
  conversationId: string;
  timestamp: string;
  title: string;
  category?: string;
  date?: string;
  rq1_documentary_record: string;
  rq2_everyday_practices: string;
  rq3_cskt_intersection: string;
  rq4_wildness_imaginary: string;
  conditions_check: string;
  rival_hypothesis_test: string;
  refutation_signals: string;
  forward_thinking: string;
  custom?: {
    prompt: string;
    result: string;
    timestamp: string;
  };
}

export interface AnalysisVersion {
  id: string;
  timestamp: string;
  analysis: Omit<StoredAnalysis, "id" | "timestamp" | "conversationId" | "custom">;
}

export interface StoredConversation {
  conversationId: string;
  current: StoredAnalysis;
  versions: AnalysisVersion[];
}

const STORAGE_KEY = "omi-thesis-analyses";
const MAX_VERSIONS = 3;

// ── Helpers ──

// Pre-2026-08-08 records were stored as a flat StoredAnalysis, not wrapped in
// { conversationId, current, versions }. Without this, getAll()'s `!!c.current`
// guard silently drops every analysis saved before that migration — and since
// every write (saveAnalysis, saveCustomAnalysis, deleteAnalysis) reads via
// getAll() then overwrites the whole key, the next write permanently erases
// them. Recognize the old shape and wrap it in-memory so it round-trips.
function isLegacyFlatAnalysis(c: unknown): c is StoredAnalysis {
  if (!c || typeof c !== "object") return false;
  const r = c as Record<string, unknown>;
  return (
    typeof r.conversationId === "string" &&
    typeof r.rq1_documentary_record === "string" &&
    !("current" in r)
  );
}

function getAll(): StoredConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    // Guard against corrupted storage (manual edits, partial writes)
    if (!Array.isArray(parsed)) return [];
    const migrated = parsed.map((c) =>
      isLegacyFlatAnalysis(c) ? { conversationId: c.conversationId, current: c, versions: [] } : c
    );
    return migrated.filter(
      (c): c is StoredConversation =>
        c && typeof c === "object" && typeof c.conversationId === "string" && !!c.current
    );
  } catch {
    return [];
  }
}

function saveAll(data: StoredConversation[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    schedulePush(STORAGE_KEY);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      // Prune oldest versions to free space
      const pruned = data.map((c) => ({ ...c, versions: c.versions.slice(0, 1) }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
        schedulePush(STORAGE_KEY);
      } catch {
        console.error("localStorage quota exceeded even after pruning");
      }
    }
  }
}

// ── Age / staleness ──

export function getAnalysisAge(timestamp: string): {
  label: string;
  days: number;
  isStale: boolean;
} {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  if (Number.isNaN(then)) {
    return { label: "at an unknown time", days: 0, isStale: false };
  }
  const ms = Math.max(0, now - then);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor(ms / (1000 * 60));

  let label: string;
  if (minutes < 1) label = "just now";
  else if (minutes < 60) label = `${minutes}m ago`;
  else if (hours < 24) label = `${hours}h ago`;
  else if (days === 1) label = "yesterday";
  else if (days < 7) label = `${days} days ago`;
  else if (days < 30) label = `${Math.floor(days / 7)} weeks ago`;
  else label = `${Math.floor(days / 30)} months ago`;

  return { label, days, isStale: days >= 7 };
}

// ── CRUD ──

export function getStoredAnalyses(): StoredAnalysis[] {
  return getAll().map((c) => c.current);
}

export function getStoredAnalysis(conversationId: string): StoredAnalysis | null {
  const all = getAll();
  const found = all.find((c) => c.conversationId === conversationId);
  return found?.current || null;
}

export function getAnalysisVersions(conversationId: string): AnalysisVersion[] {
  const all = getAll();
  const found = all.find((c) => c.conversationId === conversationId);
  return found?.versions || [];
}

export function saveAnalysis(
  analysis: Omit<StoredAnalysis, "id" | "timestamp">
): StoredAnalysis {
  const all = getAll();
  const existingIdx = all.findIndex(
    (c) => c.conversationId === analysis.conversationId
  );

  const stored: StoredAnalysis = {
    ...analysis,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    const existing = all[existingIdx];

    // Preserve custom analysis from current if new one doesn't have one
    if (!stored.custom && existing.current.custom) {
      stored.custom = existing.current.custom;
    }

    // Archive current as a version (keep last MAX_VERSIONS)
    const prevVersion: AnalysisVersion = {
      id: existing.current.id,
      timestamp: existing.current.timestamp,
      analysis: {
        title: existing.current.title,
        category: existing.current.category,
        date: existing.current.date,
        rq1_documentary_record: existing.current.rq1_documentary_record,
        rq2_everyday_practices: existing.current.rq2_everyday_practices,
        rq3_cskt_intersection: existing.current.rq3_cskt_intersection,
        rq4_wildness_imaginary: existing.current.rq4_wildness_imaginary,
        conditions_check: existing.current.conditions_check,
        rival_hypothesis_test: existing.current.rival_hypothesis_test,
        refutation_signals: existing.current.refutation_signals,
        forward_thinking: existing.current.forward_thinking,
      },
    };

    const versions = [prevVersion, ...(existing.versions || [])].slice(
      0,
      MAX_VERSIONS
    );

    all[existingIdx] = {
      conversationId: analysis.conversationId,
      current: stored,
      versions,
    };
  } else {
    all.unshift({
      conversationId: analysis.conversationId,
      current: stored,
      versions: [],
    });
  }

  saveAll(all);
  return stored;
}

export function saveCustomAnalysis(
  conversationId: string,
  custom: { prompt: string; result: string }
): void {
  const all = getAll();
  const existing = all.find((c) => c.conversationId === conversationId);
  if (existing) {
    existing.current.custom = {
      ...custom,
      timestamp: new Date().toISOString(),
    };
    saveAll(all);
  }
}

export function deleteAnalysis(conversationId: string): void {
  const all = getAll().filter((c) => c.conversationId !== conversationId);
  saveAll(all);
}

export function getAnalyzedIds(): Set<string> {
  return new Set(getAll().map((c) => c.conversationId));
}
