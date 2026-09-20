"use client";

import { readMap, writeMap } from "./map-storage";
import type { AskSource } from "./ask";

/** A question asked of the corpus and the answer it got. Kept so the answer
 *  is a record, not a transient — and so re-asking costs nothing. */
export interface StoredInquiry {
  id: string;
  timestamp: string;
  question: string;
  answer: string;
  sources: AskSource[];
  passageCount: number;
  deleted?: boolean;
}

const KEY = "omi-thesis-inquiries";

export function getInquiries(): StoredInquiry[] {
  return Object.values(readMap<StoredInquiry>(KEY))
    .filter((i) => !i.deleted && typeof i.question === "string")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function saveInquiry(rec: Omit<StoredInquiry, "id" | "timestamp">): StoredInquiry {
  const map = readMap<StoredInquiry>(KEY);
  const stored: StoredInquiry = { ...rec, id: `inq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, timestamp: new Date().toISOString() };
  map[stored.id] = stored;
  writeMap(KEY, map);
  return stored;
}

/** Tombstone rather than remove, so the deletion wins the cross-device merge. */
export function deleteInquiry(id: string): StoredInquiry | null {
  const map = readMap<StoredInquiry>(KEY);
  const existing = map[id];
  if (!existing) return null;
  map[id] = { ...existing, deleted: true, timestamp: new Date().toISOString() };
  writeMap(KEY, map);
  return existing;
}

export function restoreInquiry(rec: StoredInquiry): void {
  const map = readMap<StoredInquiry>(KEY);
  map[rec.id] = { ...rec, deleted: false, timestamp: new Date().toISOString() };
  writeMap(KEY, map);
}
