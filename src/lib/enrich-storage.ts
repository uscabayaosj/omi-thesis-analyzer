"use client";

import type { Enrichment } from "./enrich-core";
import { readMap, writeMap } from "./map-storage";

/**
 * Cached enrichment results, keyed by conversation id. Client-owned like every
 * other lens output: localStorage first, mirrored to the durable store by the
 * generic sync (the namespace is in SYNCED_NAMESPACES), merged per-record by
 * `timestamp` with `keep` resolved on its own clock.
 *
 * The cache is the token-efficiency guarantee: a conversation with a record
 * here is never enriched again unless the user explicitly re-runs it.
 */
export interface StoredEnrichment {
  conversationId: string;
  timestamp: string; // when produced; the record's merge clock
  wordCount: number;
  junk: boolean;
  junkReason?: string;
  /** Absent on records junked by the word floor — no LLM ever ran. */
  title?: string;
  overview?: string;
  /** User override: show this conversation despite the junk verdict. */
  keep?: boolean;
  /** Its own clock — a Keep must never be reverted by a re-run's newer record
   *  (same reasoning as doneKeysUpdatedAt; see merge.ts). */
  keepUpdatedAt?: string;
}

const ENRICHMENTS_KEY = "omi-enrichments";

export function getEnrichments(): Map<string, StoredEnrichment> {
  return new Map(Object.entries(readMap<StoredEnrichment>(ENRICHMENTS_KEY)));
}

export function saveEnrichment(record: {
  conversationId: string;
  wordCount: number;
  enrichment: Enrichment;
}): StoredEnrichment {
  const map = readMap<StoredEnrichment>(ENRICHMENTS_KEY);
  const prev = map[record.conversationId];
  const { junk, junk_reason, title, overview } = record.enrichment;
  const stored: StoredEnrichment = {
    conversationId: record.conversationId,
    timestamp: new Date().toISOString(),
    wordCount: record.wordCount,
    junk,
    ...(junk_reason ? { junkReason: junk_reason } : {}),
    ...(title ? { title } : {}),
    ...(overview ? { overview } : {}),
    // A re-run replaces the verdict but not the user's override.
    ...(prev?.keep !== undefined ? { keep: prev.keep, keepUpdatedAt: prev.keepUpdatedAt } : {}),
  };
  map[record.conversationId] = stored;
  writeMap(ENRICHMENTS_KEY, map);
  return stored;
}

export function toggleKeep(conversationId: string): boolean {
  const map = readMap<StoredEnrichment>(ENRICHMENTS_KEY);
  const stored = map[conversationId];
  if (!stored) return false;
  stored.keep = !stored.keep;
  stored.keepUpdatedAt = new Date().toISOString();
  writeMap(ENRICHMENTS_KEY, map);
  return stored.keep;
}
