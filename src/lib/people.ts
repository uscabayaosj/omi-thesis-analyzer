"use client";

import { schedulePush } from "./sync";

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

function writeMap<T>(ns: "omi-people" | "omi-people-pending", map: Record<string, T>): void {
  try {
    localStorage.setItem(ns, JSON.stringify(map));
    schedulePush(ns);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`${ns}: localStorage quota exceeded; write dropped`);
    } else {
      console.error(`${ns} write failed`, e);
    }
  }
}

// The people map holds two meta records alongside Person records, keyed with a
// "__" prefix so they can never collide with uuids.
const IGNORE_KEY = "__ignored";
const EXTRACTED_KEY = "__extracted";

interface MetaRecord {
  timestamp: string;
  values: string[];
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

function putPerson(person: Person): void {
  const map = readMap<unknown>(PEOPLE_NS);
  map[person.id] = person;
  writeMap(PEOPLE_NS, map);
}

export function createPerson(init: { name: string; role?: string; notes?: string }): Person {
  const now = new Date().toISOString();
  const person: Person = {
    id: crypto.randomUUID(),
    name: init.name.trim(),
    aliases: [],
    role: init.role,
    notes: init.notes ?? "",
    facts: [],
    meetings: [],
    createdAt: now,
    timestamp: now,
  };
  putPerson(person);
  return person;
}

export function updatePerson(
  id: string,
  patch: Partial<Omit<Person, "id" | "timestamp" | "createdAt">>
): Person | null {
  const existing = getPerson(id);
  if (!existing) return null;
  const updated: Person = { ...existing, ...patch, id, timestamp: new Date().toISOString() };
  putPerson(updated);
  return updated;
}

export function deletePerson(id: string): void {
  const map = readMap<unknown>(PEOPLE_NS);
  delete map[id];
  writeMap(PEOPLE_NS, map);
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
  if (merged) deletePerson(sourceId);
  return merged;
}

// ── Pending suggestions ──

export function getPending(): PendingSuggestion[] {
  return Object.values(readMap<PendingSuggestion>(PENDING_NS)).sort((a, b) =>
    b.date.localeCompare(a.date)
  );
}

export function addPending(s: Omit<PendingSuggestion, "id" | "timestamp">): void {
  const map = readMap<PendingSuggestion>(PENDING_NS);
  // Collapse duplicates: same conversation + same normalized name.
  const dup = Object.values(map).some(
    (p) => p.conversationId === s.conversationId && normalize(p.extractedName) === normalize(s.extractedName)
  );
  if (dup) return;
  const id = crypto.randomUUID();
  map[id] = { ...s, id, timestamp: new Date().toISOString() };
  writeMap(PENDING_NS, map);
}

export function removePending(id: string): void {
  const map = readMap<PendingSuggestion>(PENDING_NS);
  delete map[id];
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
