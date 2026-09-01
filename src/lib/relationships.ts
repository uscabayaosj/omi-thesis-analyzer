"use client";

import { schedulePush } from "./sync";

const REL_NS = "omi-relationships";

export type RelationshipType = "kin" | "work" | "neighbor" | "introduced" | "other";

export const RELATIONSHIP_TYPES: RelationshipType[] = ["kin", "work", "neighbor", "introduced", "other"];

export const RELATIONSHIP_LABEL: Record<RelationshipType, string> = {
  kin: "Kin",
  work: "Work",
  neighbor: "Neighbor",
  introduced: "Introduced",
  other: "Other",
};

export interface Relationship {
  id: string;
  aId: string;
  bId: string;
  type: RelationshipType;
  aRole?: string;
  bRole?: string;
  note?: string;
  createdAt: string;
  timestamp: string;
}

const MAX_ROLE = 60;
const MAX_NOTE = 500;

function clip(value: string | undefined, max: number): string | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
}

interface Tombstone { deleted: true; timestamp: string }
function isTombstone(v: unknown): v is Tombstone {
  return !!v && typeof v === "object" && (v as Tombstone).deleted === true;
}
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function pruneTombstones(map: Record<string, unknown>): Record<string, unknown> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [k, v] of Object.entries(map)) {
    if (isTombstone(v) && new Date((v as Tombstone).timestamp).getTime() < cutoff) delete map[k];
  }
  return map;
}

function isRelRecord(v: unknown): v is Relationship {
  return (
    !!v && typeof v === "object" && !isTombstone(v) &&
    typeof (v as Relationship).aId === "string" &&
    typeof (v as Relationship).bId === "string" &&
    typeof (v as Relationship).type === "string"
  );
}

function readMap(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(REL_NS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(REL_NS, JSON.stringify(map));
    schedulePush(REL_NS);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`${REL_NS}: localStorage quota exceeded; write dropped`);
    } else {
      console.error(`${REL_NS} write failed`, e);
    }
    return false;
  }
}

export function getRelationships(): Relationship[] {
  return Object.values(readMap()).filter(isRelRecord);
}

export function getRelationshipsFor(personId: string): Relationship[] {
  return getRelationships().filter((r) => r.aId === personId || r.bId === personId);
}

/** The existing edge between the same unordered pair, if any. */
function findPair(rels: Relationship[], x: string, y: string): Relationship | undefined {
  return rels.find(
    (r) => (r.aId === x && r.bId === y) || (r.aId === y && r.bId === x)
  );
}

export function addRelationship(init: {
  aId: string; bId: string; type: RelationshipType; aRole?: string; bRole?: string; note?: string;
}): Relationship | null {
  if (!init.aId || !init.bId || init.aId === init.bId) return null;
  const map = pruneTombstones(readMap());
  const rels = Object.values(map).filter(isRelRecord);
  const now = new Date().toISOString();
  const existing = findPair(rels, init.aId, init.bId);
  if (existing) {
    // Upsert onto the existing pair, preserving its a/b orientation so roles
    // stay attached to the right side.
    const sameOrient = existing.aId === init.aId;
    const next: Relationship = {
      ...existing,
      type: init.type,
      aRole: clip(sameOrient ? init.aRole : init.bRole, MAX_ROLE),
      bRole: clip(sameOrient ? init.bRole : init.aRole, MAX_ROLE),
      note: clip(init.note, MAX_NOTE),
      timestamp: now,
    };
    map[existing.id] = next;
    return writeMap(map) ? next : null;
  }
  const rel: Relationship = {
    id: crypto.randomUUID(),
    aId: init.aId,
    bId: init.bId,
    type: init.type,
    aRole: clip(init.aRole, MAX_ROLE),
    bRole: clip(init.bRole, MAX_ROLE),
    note: clip(init.note, MAX_NOTE),
    createdAt: now,
    timestamp: now,
  };
  map[rel.id] = rel;
  return writeMap(map) ? rel : null;
}

export function updateRelationship(
  id: string,
  patch: Partial<Pick<Relationship, "type" | "aRole" | "bRole" | "note">>
): Relationship | null {
  const map = pruneTombstones(readMap());
  const existing = map[id];
  if (!isRelRecord(existing)) return null;
  const next: Relationship = {
    ...existing,
    type: patch.type ?? existing.type,
    aRole: "aRole" in patch ? clip(patch.aRole, MAX_ROLE) : existing.aRole,
    bRole: "bRole" in patch ? clip(patch.bRole, MAX_ROLE) : existing.bRole,
    note: "note" in patch ? clip(patch.note, MAX_NOTE) : existing.note,
    timestamp: new Date().toISOString(),
  };
  map[id] = next;
  return writeMap(map) ? next : null;
}

export function deleteRelationship(id: string): boolean {
  const map = pruneTombstones(readMap());
  if (!(id in map)) return true;
  map[id] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  return writeMap(map);
}

/** Delete every edge touching a person. Best-effort (called after the person
 *  is already gone); a failed write leaves orphan edges that read-time filters
 *  in the UI skip anyway. */
/**
 * Put a removed relationship back.
 *
 * Restamped, not replayed verbatim: `deleteRelationship` leaves a tombstone
 * stamped *now* and pushes it, so writing the original record back with its
 * original timestamp would lose the next merge to that tombstone and the undo
 * would silently revert — the same failure that made ticked promises reappear
 * unchecked. `timestamp` here is an internal merge clock and is never shown.
 */
export function restoreRelationship(rel: Relationship): boolean {
  const map = pruneTombstones(readMap());
  map[rel.id] = { ...rel, timestamp: new Date().toISOString() };
  return writeMap(map);
}

export function onPersonDeleted(personId: string): void {
  const map = pruneTombstones(readMap());
  let changed = false;
  const now = new Date().toISOString();
  for (const [id, v] of Object.entries(map)) {
    if (isRelRecord(v) && (v.aId === personId || v.bId === personId)) {
      map[id] = { deleted: true, timestamp: now };
      changed = true;
    }
  }
  if (changed) writeMap(map);
}

/** Rewire edges from source → target. Drop self-links and duplicates
 *  (an edge that would collide with an existing target edge to the same
 *  other-person is tombstoned in favor of the target's). */
export function onPeopleMerged(sourceId: string, targetId: string): void {
  const map = pruneTombstones(readMap());
  const rels = Object.values(map).filter(isRelRecord);
  const now = new Date().toISOString();
  let changed = false;
  for (const rel of rels) {
    if (rel.aId !== sourceId && rel.bId !== sourceId) continue;
    const other = rel.aId === sourceId ? rel.bId : rel.aId;
    // Self-link after rewire → drop.
    if (other === targetId) {
      map[rel.id] = { deleted: true, timestamp: now };
      changed = true;
      continue;
    }
    // Would duplicate an existing target↔other edge → drop the source's.
    const dup = rels.find(
      (r) => r.id !== rel.id && !isTombstone(r) &&
        ((r.aId === targetId && r.bId === other) || (r.aId === other && r.bId === targetId))
    );
    if (dup) {
      map[rel.id] = { deleted: true, timestamp: now };
      changed = true;
      continue;
    }
    // Rewire in place, keeping role orientation.
    const rewired: Relationship =
      rel.aId === sourceId
        ? { ...rel, aId: targetId, timestamp: now }
        : { ...rel, bId: targetId, timestamp: now };
    map[rel.id] = rewired;
    changed = true;
  }
  if (changed) writeMap(map);
}

export function otherId(rel: Relationship, selfId: string): string {
  return rel.aId === selfId ? rel.bId : rel.aId;
}

export function roleFor(rel: Relationship, selfId: string): { selfRole?: string; otherRole?: string } {
  return rel.aId === selfId
    ? { selfRole: rel.aRole, otherRole: rel.bRole }
    : { selfRole: rel.bRole, otherRole: rel.aRole };
}
