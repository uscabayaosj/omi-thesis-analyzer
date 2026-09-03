"use client";

import { schedulePush } from "./sync";
import { isSyncedNamespace } from "./kv";

/**
 * Generic keyed-map localStorage persistence with sync mirroring and
 * quota-pruning, extracted from adhd-storage so every namespace store
 * shares one implementation instead of re-deriving the quota dance.
 */

export function readMap<T>(key: string): Record<string, T> {
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

function writeMapOnce<T>(
  key: string,
  map: Record<string, T>,
  afterWrite?: (map: Record<string, T>) => void
): void {
  localStorage.setItem(key, JSON.stringify(map));
  // Mirror to the durable store so the other device sees it. Debounced and
  // fire-and-forget — localStorage already holds the write.
  if (isSyncedNamespace(key)) schedulePush(key);
  afterWrite?.(map);
}

export function writeMap<T>(
  key: string,
  map: Record<string, T>,
  afterWrite?: (map: Record<string, T>) => void
): void {
  try {
    writeMapOnce(key, map, afterWrite);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      // Drop the oldest half of entries (by timestamp) and retry once, rather
      // than silently losing the record the user just paid to produce.
      const entries = Object.entries(map) as [string, T & { timestamp?: string }][];
      entries.sort((a, b) => (a[1].timestamp ?? "").localeCompare(b[1].timestamp ?? ""));
      const keep = entries.slice(Math.ceil(entries.length / 2));
      const pruned = Object.fromEntries(keep) as Record<string, T>;
      try {
        writeMapOnce(key, pruned, afterWrite);
        console.error(`localStorage quota exceeded writing ${key}; pruned oldest entries to fit`);
      } catch {
        console.error(`localStorage quota exceeded writing ${key} even after pruning — write lost`);
      }
    } else {
      console.error(`localStorage write failed for ${key}`, e);
    }
  }
}
