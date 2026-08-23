# People Directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A persistent, editable "People" directory that auto-extracts names, details, and meeting places (incl. GPS + Leaflet maps) from Omi conversations, with a user-approval review queue for identity matching.

**Architecture:** New `people` + `people_pending` namespaces in the existing localStorage-first / Neon-mirrored KV store. A dedicated server route (`/api/extract-people`) does a small LLM pass over a transcript; a pure client-side matcher turns results into pending suggestions; nothing writes to a card without a user tap. Two new pages (`/people`, `/people/[id]`) plus a Leaflet map component.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind 4, `@neondatabase/serverless` (existing), `leaflet` + `@types/leaflet` (new). LLM via existing `chatCompletion` in `src/lib/analysis.ts`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-23-people-directory-design.md` — follow it on any ambiguity.
- No test harness exists; every task's verify cycle is `npx next lint` (or `npm run lint`) + `npx tsc --noEmit`, and the final task verifies in the browser preview. Never introduce a test framework.
- localStorage is the synchronous source of truth; the server mirror is optional durability (all namespace access follows `src/lib/storage.ts` / `src/lib/sync.ts` patterns, quota-guarded, silent on store-down).
- Dark, calm, low-cognitive-load styling: reuse the exact Tailwind idioms already in `src/app/page.tsx` (slate palette, `min-h-[44px]` touch targets, `focus-visible` relies on globals).
- Extraction failures must never block or perturb the thesis/ADHD lenses.
- The two new namespaces are keyed maps of records carrying `timestamp` (named `updatedAt` is NOT enough — sync merge reads `timestamp`), so per-record last-write-wins merge works unchanged.
- Photos: client-side downscale to max 256px JPEG (~quality 0.8) base64 data URL before storing.
- No auth, single user; exclude the user themself ("Ulysses", "Fr. Ulysses", speaker 0 / `is_user`) from extraction suggestions.

---

### Task 1: People data layer (`src/lib/people.ts`) + sync namespaces

**Files:**
- Create: `src/lib/people.ts`
- Modify: `src/lib/kv.ts:96-101` (add namespaces to `SYNCED_NAMESPACES`)

**Interfaces:**
- Consumes: `schedulePush` from `src/lib/sync.ts`.
- Produces (used by Tasks 4, 6, 7):
  - Types `Person`, `PersonFact`, `Meeting`, `PendingSuggestion`, `ExtractedPerson`
  - `getPeople(): Person[]`, `getPerson(id: string): Person | null`
  - `createPerson(init: { name: string; role?: string; notes?: string }): Person`
  - `updatePerson(id: string, patch: Partial<Omit<Person, "id" | "timestamp" | "createdAt">>): Person | null`
  - `deletePerson(id: string): void`
  - `mergePeople(sourceId: string, targetId: string): Person | null`
  - `appendToPerson(id: string, facts: PersonFact[], meeting: Meeting, alias?: string): Person | null`
  - `getPending(): PendingSuggestion[]`, `removePending(id: string): void`, `addPending(s: Omit<PendingSuggestion, "id" | "timestamp">): void`
  - `getIgnoredNames(): string[]`, `ignoreName(name: string): void`
  - `matchPerson(name: string, people: Person[]): { kind: "confident"; personId: string } | { kind: "ambiguous"; candidateIds: string[] } | { kind: "none" }`
  - `getExtractedConversationIds(): Set<string>`, `markConversationExtracted(id: string): void`

- [ ] **Step 1: Add namespaces to kv.ts**

In `src/lib/kv.ts`, extend the array (keep the comment above it):

```ts
export const SYNCED_NAMESPACES = [
  "omi-thesis-analyses",
  "omi-adhd-analyses",
  "omi-adhd-rollups",
  "omi-thesis-group-analyses",
  "omi-people",
  "omi-people-pending",
] as const;
```

Both new namespaces are keyed maps of `{ timestamp }` records, so `sync.ts` merge logic needs no change.

- [ ] **Step 2: Create `src/lib/people.ts`**

```ts
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
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (lint may report pre-existing warnings only).

- [ ] **Step 4: Commit**

```bash
git add src/lib/people.ts src/lib/kv.ts
git commit -m "feat(people): data layer, matcher, and synced namespaces"
```

---

### Task 2: Omi geolocation passthrough

**Files:**
- Modify: `src/lib/omi-api.ts:27-40` (Conversation interface)

**Interfaces:**
- Produces: `Conversation.geolocation?: OmiGeolocation` used by Tasks 4 and 6.

- [ ] **Step 1: Add the type**

In `src/lib/omi-api.ts`, above the `Conversation` interface add:

```ts
export interface OmiGeolocation {
  latitude?: number;
  longitude?: number;
  address?: string;
  location_name?: string;
  google_place_id?: string;
}
```

and inside `Conversation` add the field:

```ts
  geolocation?: OmiGeolocation | null;
```

The Omi API already returns this field when present; no fetch change is needed (routes return the whole conversation object). Tolerate absence everywhere — most conversations may lack it.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add src/lib/omi-api.ts
git commit -m "feat(people): surface Omi conversation geolocation"
```

---

### Task 3: Extraction route (`/api/extract-people`)

**Files:**
- Create: `src/lib/people-extract.ts` (server-side prompt + parsing)
- Create: `src/app/api/extract-people/route.ts`

**Interfaces:**
- Consumes: `chatCompletion`, `clampTranscript`, `extractJsonObject` from `src/lib/analysis.ts`; `getConversation`, `segmentsToText` from `src/lib/omi-api.ts`; `friendlyError` from `src/lib/api-error.ts`.
- Produces (Task 4): `POST /api/extract-people` body `{ conversationId: string }` → `{ conversation: Conversation, people: ExtractedPerson[] }` where `ExtractedPerson = { name: string; details: string[]; place?: string }`.

- [ ] **Step 1: Create `src/lib/people-extract.ts`**

```ts
import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";

export interface ExtractedPerson {
  name: string;
  details: string[];
  place?: string;
}

const SYSTEM_PROMPT = `You extract the people mentioned in or party to a recorded conversation, as a memory aid for the wearer of the recording device (the user). The user has difficulty remembering names.

Rules:
- Include named third parties AND named conversation partners. A name is required — never invent one, never include unnamed speakers ("the cashier"), and never include the user themself.
- Exclude public figures mentioned in passing (politicians, celebrities) unless the user personally interacted with them.
- details: 0-5 short, concrete, remember-worthy facts about that person from THIS conversation (role, relation to others, what they do, commitments involving them, distinguishing details). Neutral tone. No speculation.
- place: if the conversation makes clear WHERE the user encountered or will encounter this person (e.g. "here at the feed store", "at the Ronan church"), give that place name; omit otherwise.

Respond with JSON only:
{"people":[{"name":"Full Name As Heard","details":["...",""],"place":"..."}]}
An empty people array is a correct answer.`;

export async function extractPeople(transcript: string, title: string, date: string): Promise<ExtractedPerson[]> {
  const content = await chatCompletion(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Conversation title: "${title}"\nConversation date: ${date}\n\nTranscript:\n${clampTranscript(transcript)}`,
      },
    ],
    true
  );
  const raw = extractJsonObject(content);
  const list = Array.isArray(raw.people) ? raw.people : [];
  return list
    .map((p): ExtractedPerson | null => {
      if (!p || typeof p !== "object") return null;
      const r = p as Record<string, unknown>;
      if (typeof r.name !== "string" || !r.name.trim()) return null;
      return {
        name: r.name.trim(),
        details: Array.isArray(r.details) ? r.details.filter((d): d is string => typeof d === "string" && !!d.trim()) : [],
        place: typeof r.place === "string" && r.place.trim() ? r.place.trim() : undefined,
      };
    })
    .filter((p): p is ExtractedPerson => p !== null);
}
```

Note: `chatCompletion`, `clampTranscript`, and `extractJsonObject` must be exported from `src/lib/analysis.ts` — they already are (see `analysis.ts:229,276,283`). If any lacks `export`, add it.

- [ ] **Step 2: Create `src/app/api/extract-people/route.ts`**

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { extractPeople } from "@/lib/people-extract";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();
    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json({ error: "Please select a conversation to scan." }, { status: 400 });
    }
    const convo = await getConversation(conversationId);
    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json({ error: "This conversation has no transcript to scan." }, { status: 404 });
    }
    const people = await extractPeople(
      segmentsToText(convo.transcript_segments),
      convo.structured?.title || "Untitled Conversation",
      convo.created_at
    );
    return NextResponse.json({ conversation: convo, people });
  } catch (err) {
    console.error("extract-people failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add src/lib/people-extract.ts src/app/api/extract-people/route.ts
git commit -m "feat(people): dedicated people-extraction API route"
```

---

### Task 4: Client suggestion pipeline + hooks into analyze flows

**Files:**
- Create: `src/lib/people-pipeline.ts`
- Modify: `src/app/conversation/[id]/page.tsx` (after-analysis hook at the `/api/analyze` ~line 291 and `/api/analyze-adhd` ~line 377 success paths; add a "Scan for people" button near the analyze actions)

**Interfaces:**
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`; Task 1's `matchPerson`, `addPending`, `getPeople`, `getIgnoredNames`, `normalize`, `markConversationExtracted`, `getExtractedConversationIds`; Task 3's route; `Conversation` incl. `geolocation`.
- Produces (Tasks 6, 7): `runExtraction(conversationId: string, opts?: { force?: boolean }): Promise<{ suggested: number } | { error: string }>`.

- [ ] **Step 1: Create `src/lib/people-pipeline.ts`**

```ts
"use client";

import { fetchJson } from "@/lib/fetch-json";
import type { Conversation } from "@/lib/omi-api";
import {
  addPending,
  getExtractedConversationIds,
  getIgnoredNames,
  getPeople,
  markConversationExtracted,
  matchPerson,
  normalize,
  type ExtractedPerson,
} from "@/lib/people";

/**
 * Run the extraction pass for one conversation and convert results into
 * pending suggestions. Safe to call after any lens completes — failures are
 * returned, never thrown, so analysis flows can ignore them.
 */
export async function runExtraction(
  conversationId: string,
  opts?: { force?: boolean }
): Promise<{ suggested: number } | { error: string }> {
  if (!opts?.force && getExtractedConversationIds().has(conversationId)) {
    return { suggested: 0 };
  }
  let data: { conversation: Conversation; people: ExtractedPerson[] };
  try {
    data = await fetchJson("/api/extract-people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Extraction failed." };
  }

  const geo = data.conversation.geolocation ?? undefined;
  const date = data.conversation.created_at;
  const ignored = new Set(getIgnoredNames().map(normalize));
  const people = getPeople();
  let suggested = 0;

  for (const ex of data.people) {
    if (ignored.has(normalize(ex.name))) continue;
    const match = matchPerson(ex.name, people);
    addPending({
      conversationId,
      date,
      extractedName: ex.name,
      details: ex.details,
      placeName: ex.place ?? geo?.location_name ?? geo?.address ?? undefined,
      lat: geo?.latitude,
      lng: geo?.longitude,
      matchedPersonId: match.kind === "confident" ? match.personId : undefined,
      candidateIds: match.kind === "ambiguous" ? match.candidateIds : undefined,
    });
    suggested++;
  }
  markConversationExtracted(conversationId);
  return { suggested };
}
```

- [ ] **Step 2: Hook into the conversation page**

In `src/app/conversation/[id]/page.tsx`:
1. `import { runExtraction } from "@/lib/people-pipeline";`
2. In the success paths of both the thesis analyze handler (after the `fetchJson` at ~line 291 resolves and results are saved) and the ADHD handler (~line 377), add a fire-and-forget call:
   ```ts
   void runExtraction(conversationId).catch(() => {});
   ```
   Place it after the existing save-to-storage call so a pipeline failure can never affect the lens result.
3. Add a "Scan for people" button in the actions area (same styling as the existing secondary buttons, e.g. `min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800`). Handler:
   ```ts
   const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
   async function scanForPeople() {
     setScanState("scanning");
     const res = await runExtraction(conversationId, { force: true });
     setScanState("error" in res ? "error" : "done");
   }
   ```
   Render feedback inline: scanning → "Scanning…", done → link "Review suggestions →" to `/people`, error → quiet "Scan failed — tap to retry" that re-invokes `scanForPeople`.

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add src/lib/people-pipeline.ts "src/app/conversation/[id]/page.tsx"
git commit -m "feat(people): suggestion pipeline wired into both analysis lenses"
```

---

### Task 5: Leaflet map component

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/components/MeetingMap.tsx`

**Interfaces:**
- Produces (Tasks 6, 7): `<MeetingMap markers={Marker[]} className?: string />` where `Marker = { lat: number; lng: number; label: string; sublabel?: string; href?: string }`.

- [ ] **Step 1: Install**

Run: `npm install leaflet && npm install -D @types/leaflet`
Expected: both added to package.json.

- [ ] **Step 2: Create `src/components/MeetingMap.tsx`**

Client-only; Leaflet touches `window`, so the map initializes in an effect (no SSR issue since the component only renders markup until mounted). Default marker icons 404 under bundlers, so use small inline `divIcon`s.

```tsx
"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapMarker {
  lat: number;
  lng: number;
  label: string;
  sublabel?: string;
  href?: string;
}

export default function MeetingMap({ markers, className }: { markers: MapMarker[]; className?: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || markers.length === 0) return;
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      const map = L.map(containerRef.current, { scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);
      const icon = L.divIcon({
        className: "",
        html: '<div style="width:14px;height:14px;border-radius:9999px;background:#22d3ee;border:2px solid #0f172a;box-shadow:0 0 0 2px #22d3ee66"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      });
      const bounds = L.latLngBounds([]);
      for (const m of markers) {
        const marker = L.marker([m.lat, m.lng], { icon }).addTo(map);
        const title = m.href
          ? `<a href="${m.href}" style="color:#22d3ee">${m.label}</a>`
          : `<strong>${m.label}</strong>`;
        marker.bindPopup(`${title}${m.sublabel ? `<br/><span>${m.sublabel}</span>` : ""}`);
        bounds.extend([m.lat, m.lng]);
      }
      map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [markers]);

  if (markers.length === 0) return null;
  return (
    <div
      ref={containerRef}
      className={`rounded-xl overflow-hidden border border-slate-800 h-64 ${className ?? ""}`}
      role="region"
      aria-label="Map of meeting locations"
    />
  );
}
```

Note: marker `label`/`sublabel` are LLM/Omi-derived strings injected into popup HTML — escape them first. Add at the top of the file and use for `m.label` and `m.sublabel`:

```ts
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
```

(`m.href` is always an app-internal `/conversation/...` path built by our own code, never external input.)

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

```bash
git add package.json package-lock.json src/components/MeetingMap.tsx
git commit -m "feat(people): Leaflet meeting-map component"
```

---

### Task 6: People tab page (`/people`)

**Files:**
- Create: `src/app/people/page.tsx`
- Create: `src/app/people/error.tsx` (copy the pattern from `src/app/analyze-group/error.tsx`)
- Modify: `src/app/page.tsx:681-688` (add a "People" link beside the existing "Daily Rollup" link, using `UsersIcon` — add the icon to `src/components/icons.tsx` if absent, following that file's existing 24×24 stroke style)

**Interfaces:**
- Consumes: Task 1 CRUD + pending API, Task 4 `runExtraction`, Task 5 `MeetingMap`, `pullAndMerge` from `src/lib/sync.ts`, `getStoredAnalyses`/conversation cache for backfill candidate ids (use `getAnalyzedIds()` from `src/lib/storage.ts` plus ADHD equivalents from `src/lib/adhd-storage.ts`).
- Produces: routes `/people` linked from home; navigates to `/people/[id]` (Task 7).

- [ ] **Step 1: Build the page**

`"use client"` page with this structure (follow `src/app/page.tsx` styling idioms exactly — `max-w-3xl mx-auto px-4 py-8`, slate palette, back-link to `/`):

1. **State + load:** on mount `pullAndMerge().then(() => refresh())`; `refresh()` reads `getPeople()` and `getPending()` into state.
2. **Review queue** (rendered above the grid when `pending.length > 0`): a card per suggestion showing `extractedName`, its `details`, place/date. Actions per outcome:
   - `matchedPersonId` set → primary button "Add to {person.name}" → `appendToPerson(matchedPersonId, factsFrom(s), meetingFrom(s), s.extractedName)`; secondary "Someone else…" opens a select of all people + "New person"; tertiary "Ignore" → `ignoreName(s.extractedName)`.
   - `candidateIds` set → "Same person as…?" with one button per candidate (name + last meeting place/date as disambiguator) + "New person" + "Ignore".
   - neither → "New person" (creates then appends) + "Add to existing…" select + "Ignore".
   Every action ends with `removePending(s.id)` then `refresh()`. Helpers:
   ```ts
   const factsFrom = (s: PendingSuggestion): PersonFact[] =>
     s.details.map((text) => ({ text, conversationId: s.conversationId, date: s.date }));
   const meetingFrom = (s: PendingSuggestion): Meeting => ({
     conversationId: s.conversationId, date: s.date,
     placeName: s.placeName, lat: s.lat, lng: s.lng,
   });
   const acceptAsNew = (s: PendingSuggestion) => {
     const p = createPerson({ name: s.extractedName });
     appendToPerson(p.id, factsFrom(s), meetingFrom(s));
     removePending(s.id); refresh();
   };
   ```
3. **Toolbar:** search input (filters by name/alias/role, case-insensitive), a Grid/Map toggle, an "Add person" button (inline name prompt → `createPerson` → navigate to detail), and a "Scan past conversations" backfill button.
4. **Grid view:** cards linking to `/people/[id]`: photo (or initials avatar — first letters of first/last name on a `bg-slate-800` circle), name, role, "Last met {place ?? "—"} · {age label via getAnalysisAge(meeting.date).label}".
5. **Map view:** `<MeetingMap markers={...} />` built from each person's most recent meeting that has lat/lng: `{ lat, lng, label: person.name, sublabel: place + date, href: "/people/" + person.id }`. Empty-state text when nobody has coordinates.
6. **Backfill:** iterate analyzed conversation ids not in `getExtractedConversationIds()` (union of thesis `getAnalyzedIds()` and the ADHD store's analyzed ids — check `src/lib/adhd-storage.ts` for its accessor and use it), sequentially `await runExtraction(id)`, with a progress line "Scanning 3 of 12…" and a cancel button (a `useRef<boolean>` flag checked between iterations). Refresh at the end.

- [ ] **Step 2: Add the nav link**

In `src/app/page.tsx` next to the Daily Rollup link (line ~681), same classes:

```tsx
<Link
  href="/people"
  className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
>
  <UsersIcon className="w-4 h-4 flex-shrink-0" />
  People
</Link>
```

- [ ] **Step 3: Verify + commit**

Run: `npx tsc --noEmit && npm run lint && npx next build`
Expected: build succeeds, `/people` in the route list.

```bash
git add src/app/people src/app/page.tsx src/components/icons.tsx
git commit -m "feat(people): People tab with review queue, grid/map views, backfill"
```

---

### Task 7: Person detail page (`/people/[id]`)

**Files:**
- Create: `src/app/people/[id]/page.tsx`
- Create: `src/app/people/[id]/error.tsx` (same pattern as other error files)

**Interfaces:**
- Consumes: Task 1 (`getPerson`, `updatePerson`, `deletePerson`, `mergePeople`, `getPeople`), Task 5 `MeetingMap`, `ConfirmDialog` from `src/components/ConfirmDialog.tsx`, `getAnalysisAge` from `src/lib/storage.ts`.
- Produces: terminal page; links back to `/people` and out to `/conversation/[id]`.

- [ ] **Step 1: Build the page**

`"use client"`; read `id` via `useParams()`. Sections:

1. **Header:** photo (or initials avatar) with an overlaid "Change photo" file input; editable name (inline text input toggled by an Edit button, saved via `updatePerson`). Photo pipeline:
   ```ts
   async function onPhotoSelected(file: File) {
     if (!file.type.startsWith("image/")) { setPhotoError("That file isn't an image."); return; }
     try {
       const url = URL.createObjectURL(file);
       const img = new Image();
       await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("unreadable")); img.src = url; });
       URL.revokeObjectURL(url);
       const scale = Math.min(1, 256 / Math.max(img.width, img.height));
       const canvas = document.createElement("canvas");
       canvas.width = Math.round(img.width * scale);
       canvas.height = Math.round(img.height * scale);
       canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
       const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
       updatePerson(id, { photo: dataUrl });
       refresh();
     } catch {
       setPhotoError("Couldn't read that photo — try a different one.");
     }
   }
   ```
   Also a "Remove photo" action (`updatePerson(id, { photo: undefined })`).
2. **Role / notes / aliases:** inline-editable (input for role, textarea for notes, chip list with add/remove for aliases), each save → `updatePerson`.
3. **Facts:** list of `facts` with per-fact source link `→ /conversation/{f.conversationId}` and date; per-fact delete (small × button, updates via `updatePerson(id, { facts: without(f) })`).
4. **Meetings:** chronological list — date (via `getAnalysisAge` label + absolute), placeName, link to conversation; below it `<MeetingMap markers={meetingsWithCoords} />` (label = placeName ?? formatted date, sublabel = date, href = conversation link).
5. **Danger zone:** "Merge into another person…" (select of other people → ConfirmDialog "Move everything from {A} into {B}? {A} will be deleted." → `mergePeople(id, targetId)` → navigate to target) and "Delete person" (ConfirmDialog → `deletePerson` → navigate to `/people`).
6. **Not found:** if `getPerson(id)` is null after `pullAndMerge()`, show a quiet "This person no longer exists" with a back link.

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm run lint && npx next build`
Expected: clean; `/people/[id]` in route list.

```bash
git add "src/app/people/[id]"
git commit -m "feat(people): person detail card — photos, editing, merge, map"
```

---

### Task 8: End-to-end browser verification

**Files:** none (verification only; fix regressions found).

- [ ] **Step 1: Start dev server** via preview tooling (never Bash) and open `/`.
- [ ] **Step 2: Walk the flow:**
  1. `/people` renders empty state; "Add person" creates a card; edit name/role/notes/aliases; upload a photo (verify it appears downscaled and survives reload).
  2. Open a conversation, run an analysis (or press "Scan for people"); confirm suggestions appear in `/people` review queue; accept one into the existing person (facts + meeting appended, alias captured), reject another (re-scan with force must NOT resurface it).
  3. Ambiguity: create two people "Levi Cross" and "Levi Hart", force-scan a conversation mentioning "Levi" → chooser lists both.
  4. Map: person with coordinates shows Leaflet map on detail and in the tab's map view; popups link correctly.
  5. Merge two people; verify facts/meetings/aliases combined and source deleted. Delete a person.
  6. Reload with DevTools offline: page still renders from localStorage; map tiles fail gracefully.
- [ ] **Step 3: Console/network check** — no errors in console beyond blocked tile requests when offline; `/api/store` PUTs fire for `omi-people` namespaces after edits.
- [ ] **Step 4: Final commit** of any fixes:

```bash
git add -A && git commit -m "fix(people): polish from end-to-end verification"
```
