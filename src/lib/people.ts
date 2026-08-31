"use client";

import { schedulePush } from "./sync";
import { onPersonDeleted, onPeopleMerged } from "./relationships";

const PEOPLE_NS = "omi-people";
const PENDING_NS = "omi-people-pending";

export interface PersonFact {
  text: string;
  conversationId: string;
  date: string; // conversation created_at
}

export interface Meeting {
  conversationId: string;
  date: string;
  placeName?: string;
  lat?: number;
  lng?: number;
}

export interface Person {
  id: string;
  name: string;
  aliases: string[];
  photo?: string; // base64 data URL, ≤256px
  role?: string;
  notes: string;
  facts: PersonFact[];
  meetings: Meeting[];
  createdAt: string;
  timestamp: string; // last-write-wins key for sync merge
}

export interface PendingSuggestion {
  id: string;
  conversationId: string;
  date: string;
  extractedName: string;
  details: string[];
  placeName?: string;
  lat?: number;
  lng?: number;
  matchedPersonId?: string;
  candidateIds?: string[];
  timestamp: string;
}

/** Shape returned by /api/extract-people for one person. */
export interface ExtractedPerson {
  name: string;
  details: string[];
  place?: string;
}

// ── namespace read/write (mirrors storage.ts patterns) ──

function readMap<T>(ns: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ns);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Returns false when the write did not land. Callers must propagate that as a
 * failed operation rather than swallowing it: photos put this namespace within
 * reach of the quota, and the whole map re-serializes on every write, so a
 * dropped write is silent data loss on an edit the user watched "succeed".
 * The mutators below turn a false here into the same `null` they already
 * return for a missing person, so every existing null-check covers quota too.
 */
function writeMap<T>(ns: "omi-people" | "omi-people-pending", map: Record<string, T>): boolean {
  try {
    localStorage.setItem(ns, JSON.stringify(map));
    schedulePush(ns);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`${ns}: localStorage quota exceeded; write dropped`);
    } else {
      console.error(`${ns} write failed`, e);
    }
    return false;
  }
}

// ── Field bounds ──
//
// Every string below originates either from an LLM (which can return a whole
// sentence where the schema said "name") or from a free-text field. Capping at
// the point of storage keeps one malformed value from blowing out a card's
// layout, a map popup, or the namespace's quota — and means no renderer has to
// defend itself against a 50KB "name".
const MAX_NAME = 120;
const MAX_ROLE = 160;
const MAX_PLACE = 160;
const MAX_FACT = 500;
const MAX_NOTES = 5_000;
const MAX_FACTS_PER_PERSON = 200;
const MAX_ALIASES = 25;

function clip(value: string | undefined, max: number): string {
  const v = (value ?? "").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
}

// The people map holds two meta records alongside Person records, keyed with a
// "__" prefix so they can never collide with uuids.
const IGNORE_KEY = "__ignored";
const EXTRACTED_KEY = "__extracted";

interface MetaRecord {
  timestamp: string;
  values: string[];
}

// ── Tombstones ──
//
// Deleting by removing a key doesn't survive sync: mergeMaps in sync.ts unions
// keys, so a device that still holds the record resurrects it on the next
// pull. A deletion is therefore written as a record — a tombstone carrying
// only `deleted` and a fresh `timestamp` — which wins the existing per-record
// last-write-wins merge against the stale live copy and propagates the delete
// instead of losing it. No change to sync.ts is needed; readers here filter
// tombstones out.
interface Tombstone {
  deleted: true;
  timestamp: string;
}

function isTombstone(v: unknown): v is Tombstone {
  return !!v && typeof v === "object" && (v as Tombstone).deleted === true;
}

// Tombstones are tiny but shouldn't accumulate forever. Purged only after a
// long horizon: a device that hasn't synced since before the purge would
// resurrect the record, so the window errs far toward safety over tidiness.
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function pruneTombstones<T>(map: Record<string, T>): Record<string, T> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [k, v] of Object.entries(map)) {
    if (isTombstone(v) && new Date(v.timestamp).getTime() < cutoff) delete map[k];
  }
  return map;
}

function isPersonRecord(v: unknown): v is Person {
  return !!v && typeof v === "object" && typeof (v as Person).name === "string" && Array.isArray((v as Person).facts);
}

// ── Person CRUD ──

export function getPeople(): Person[] {
  return Object.entries(readMap<unknown>(PEOPLE_NS))
    .filter(([k, v]) => !k.startsWith("__") && isPersonRecord(v))
    .map(([, v]) => v as Person)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPerson(id: string): Person | null {
  const rec = readMap<unknown>(PEOPLE_NS)[id];
  return isPersonRecord(rec) ? rec : null;
}

function putPerson(person: Person): boolean {
  const map = pruneTombstones(readMap<unknown>(PEOPLE_NS));
  map[person.id] = person;
  return writeMap(PEOPLE_NS, map);
}

/** Bring every user- or LLM-supplied field within its bound before storage. */
function bound(person: Person): Person {
  return {
    ...person,
    name: clip(person.name, MAX_NAME),
    role: person.role ? clip(person.role, MAX_ROLE) : person.role,
    notes: clip(person.notes, MAX_NOTES),
    aliases: person.aliases
      .map((a) => clip(a, MAX_NAME))
      .filter(Boolean)
      .slice(0, MAX_ALIASES),
    // Oldest facts are the ones already read and absorbed; a runaway extraction
    // should cost the tail, not the newest thing learned about someone.
    facts: person.facts
      .slice(-MAX_FACTS_PER_PERSON)
      .map((f) => ({ ...f, text: clip(f.text, MAX_FACT) })),
    meetings: person.meetings.map((m) =>
      m.placeName ? { ...m, placeName: clip(m.placeName, MAX_PLACE) } : m
    ),
  };
}

/** Returns null if the name is empty once trimmed, or if the write failed. */
export function createPerson(init: { name: string; role?: string; notes?: string }): Person | null {
  const name = clip(init.name, MAX_NAME);
  if (!name) return null;
  const now = new Date().toISOString();
  const person: Person = bound({
    id: crypto.randomUUID(),
    name,
    aliases: [],
    role: init.role,
    notes: init.notes ?? "",
    facts: [],
    meetings: [],
    createdAt: now,
    timestamp: now,
  });
  return putPerson(person) ? person : null;
}

/** Returns null if the person is gone, the edit empties their name, or the
 *  write failed — callers treat all three the same way: the edit did not land. */
export function updatePerson(
  id: string,
  patch: Partial<Omit<Person, "id" | "timestamp" | "createdAt">>
): Person | null {
  const existing = getPerson(id);
  if (!existing) return null;
  const updated = bound({ ...existing, ...patch, id, timestamp: new Date().toISOString() });
  if (!updated.name) return null;
  return putPerson(updated) ? updated : null;
}

/** Writes a tombstone rather than removing the key, so the deletion wins the
 *  cross-device merge instead of being resurrected by a stale copy. Returns
 *  false when the write didn't land. */
export function deletePerson(id: string): boolean {
  const map = pruneTombstones(readMap<unknown>(PEOPLE_NS));
  if (!(id in map)) return true;
  map[id] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  const ok = writeMap(PEOPLE_NS, map);
  if (ok) onPersonDeleted(id);
  return ok;
}

export function appendToPerson(
  id: string,
  facts: PersonFact[],
  meeting: Meeting,
  alias?: string
): Person | null {
  const person = getPerson(id);
  if (!person) return null;
  const seen = new Set(person.facts.map((f) => f.text.toLowerCase()));
  const newFacts = facts.filter((f) => !seen.has(f.text.toLowerCase()));
  const hasMeeting = person.meetings.some((m) => m.conversationId === meeting.conversationId);
  const aliases =
    alias && alias.toLowerCase() !== person.name.toLowerCase() && !person.aliases.some((a) => a.toLowerCase() === alias.toLowerCase())
      ? [...person.aliases, alias]
      : person.aliases;
  return updatePerson(id, {
    facts: [...person.facts, ...newFacts],
    meetings: hasMeeting ? person.meetings : [...person.meetings, meeting],
    aliases,
  });
}

/** Move everything from source onto target, then delete source. */
export function mergePeople(sourceId: string, targetId: string): Person | null {
  const source = getPerson(sourceId);
  const target = getPerson(targetId);
  if (!source || !target || sourceId === targetId) return null;
  const factKeys = new Set(target.facts.map((f) => f.text.toLowerCase()));
  const meetingKeys = new Set(target.meetings.map((m) => m.conversationId));
  const aliasKeys = new Set([target.name.toLowerCase(), ...target.aliases.map((a) => a.toLowerCase())]);
  const merged = updatePerson(targetId, {
    facts: [...target.facts, ...source.facts.filter((f) => !factKeys.has(f.text.toLowerCase()))],
    meetings: [...target.meetings, ...source.meetings.filter((m) => !meetingKeys.has(m.conversationId))],
    aliases: [
      ...target.aliases,
      ...[source.name, ...source.aliases].filter((a) => !aliasKeys.has(a.toLowerCase())),
    ],
    notes: source.notes && source.notes !== target.notes ? `${target.notes}\n${source.notes}`.trim() : target.notes,
    photo: target.photo ?? source.photo,
  });
  // Best-effort: if this tombstone write fails the target already holds
  // everything, so the merge still "succeeded" — the leftover source is a
  // duplicate the user can delete again, not lost data.
  if (merged) {
    onPeopleMerged(sourceId, targetId); // rewire before the source's delete-hook removes them
    deletePerson(sourceId);
  }
  return merged;
}

// ── Pending suggestions ──

function isPendingRecord(v: unknown): v is PendingSuggestion {
  return (
    !!v && typeof v === "object" && !isTombstone(v) && typeof (v as PendingSuggestion).extractedName === "string"
  );
}

export function getPending(): PendingSuggestion[] {
  return Object.values(readMap<unknown>(PENDING_NS))
    .filter(isPendingRecord)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Ceiling on the queue itself: a backfill over a long history could otherwise
 *  enqueue thousands of cards, which is neither reviewable nor worth the quota. */
const MAX_PENDING = 300;
const MAX_DETAILS_PER_SUGGESTION = 8;

export function addPending(s: Omit<PendingSuggestion, "id" | "timestamp">): void {
  const name = clip(s.extractedName, MAX_NAME);
  if (!name) return;
  const map = pruneTombstones(readMap<PendingSuggestion>(PENDING_NS));
  const live = Object.values(map).filter(isPendingRecord);
  // Collapse duplicates: same conversation + same normalized name. Tombstones
  // don't count — a resolved suggestion shouldn't block a fresh force-rescan,
  // matching the old removed-key behavior.
  const dup = live.some(
    (p) => p.conversationId === s.conversationId && normalize(p.extractedName) === normalize(name)
  );
  if (dup) return;
  if (live.length >= MAX_PENDING) return;
  const id = crypto.randomUUID();
  map[id] = {
    ...s,
    extractedName: name,
    details: s.details
      .map((d) => clip(d, MAX_FACT))
      .filter(Boolean)
      .slice(0, MAX_DETAILS_PER_SUGGESTION),
    placeName: s.placeName ? clip(s.placeName, MAX_PLACE) : undefined,
    id,
    timestamp: new Date().toISOString(),
  };
  writeMap(PENDING_NS, map);
}

/** Tombstoned, not removed: a resolved suggestion must stay resolved on every
 *  device, not reappear in the review queue after the next sync. */
export function removePending(id: string): void {
  const map = pruneTombstones(readMap<PendingSuggestion | Tombstone>(PENDING_NS));
  if (!(id in map)) return;
  map[id] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  writeMap(PENDING_NS, map);
}

/** Put a removed suggestion back, id and all, so an undo restores the exact
 *  record rather than a lookalike with a new id. */
export function restorePending(s: PendingSuggestion): void {
  const map = pruneTombstones(readMap<PendingSuggestion | Tombstone>(PENDING_NS));
  map[s.id] = s;
  writeMap(PENDING_NS, map);
}

// ── Ignore list + extracted-conversation tracking (meta records) ──

function readMeta(key: string): string[] {
  const rec = readMap<unknown>(PEOPLE_NS)[key] as MetaRecord | undefined;
  return rec && Array.isArray(rec.values) ? rec.values : [];
}

function writeMeta(key: string, values: string[]): void {
  const map = readMap<unknown>(PEOPLE_NS);
  map[key] = { timestamp: new Date().toISOString(), values } satisfies MetaRecord;
  writeMap(PEOPLE_NS, map);
}

export function getIgnoredNames(): string[] {
  return readMeta(IGNORE_KEY);
}

export function ignoreName(name: string): void {
  const list = getIgnoredNames();
  const n = normalize(name);
  if (!list.some((x) => normalize(x) === n)) writeMeta(IGNORE_KEY, [...list, name]);
}

/** Undo of `ignoreName`. Matches on the same normalized form the add uses, so
 *  a name ignored in one casing is un-ignored in any. */
export function unignoreName(name: string): void {
  const n = normalize(name);
  const list = getIgnoredNames();
  const next = list.filter((x) => normalize(x) !== n);
  if (next.length !== list.length) writeMeta(IGNORE_KEY, next);
}

export function getExtractedConversationIds(): Set<string> {
  return new Set(readMeta(EXTRACTED_KEY));
}

export function markConversationExtracted(id: string): void {
  const ids = getExtractedConversationIds();
  if (ids.has(id)) return;
  // Cap the log so the meta record can't grow unboundedly.
  writeMeta(EXTRACTED_KEY, [...ids, id].slice(-500));
}

// ── Identity matcher (pure) ──

export function normalize(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}

function namesOf(p: Person): string[] {
  return [p.name, ...p.aliases].map(normalize);
}

/**
 * Score an extracted name against the directory.
 * - confident: exactly one person matches by full name/alias (normalized) or
 *   tiny edit distance (≤1 for names ≥5 chars).
 * - ambiguous: several full matches, OR the extracted name is a single token
 *   matching ≥1 person's first name.
 * - none: nothing plausible.
 */
export function matchPerson(
  name: string,
  people: Person[]
): { kind: "confident"; personId: string } | { kind: "ambiguous"; candidateIds: string[] } | { kind: "none" } {
  const n = normalize(name);
  if (!n) return { kind: "none" };

  const full = people.filter((p) => namesOf(p).includes(n));
  if (full.length === 1) return { kind: "confident", personId: full[0].id };
  if (full.length > 1) return { kind: "ambiguous", candidateIds: full.map((p) => p.id) };

  const fuzzy = people.filter((p) =>
    namesOf(p).some((cand) => n.length >= 5 && cand.length >= 5 && editDistance(n, cand) <= 1)
  );
  if (fuzzy.length === 1) return { kind: "confident", personId: fuzzy[0].id };
  if (fuzzy.length > 1) return { kind: "ambiguous", candidateIds: fuzzy.map((p) => p.id) };

  if (!n.includes(" ")) {
    const firstName = people.filter((p) =>
      namesOf(p).some((cand) => cand.split(" ")[0] === n)
    );
    if (firstName.length >= 1)
      return { kind: "ambiguous", candidateIds: firstName.map((p) => p.id) };
  }
  return { kind: "none" };
}
