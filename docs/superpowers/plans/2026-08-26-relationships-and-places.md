# Relationships & Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add typed relationships between people (with ego-web + whole-network visualizations) and first-class editable Places (list + detail pages + map integration) under the People tab.

**Architecture:** Two new localStorage namespaces (`omi-relationships`, `omi-places`) mirror the existing `omi-people` module exactly — id-keyed map, clipped fields, last-write-wins `timestamp`, quota-aware `writeMap`, Neon mirror via `schedulePush`. All pure logic (great-circle distance, nearest-place resolution, force-directed graph layout) lives in dependency-free modules that are unit-tested with `npx tsx`. Storage and React modules are verified with `tsc` + `eslint` + `next build` + browser walkthrough (the repo has no test runner and this feature doesn't justify adding one — see spec).

**Tech Stack:** Next.js (App Router, `next dev`), TypeScript, Tailwind v4 (tokens remapped in `globals.css`), Leaflet (already a dependency), localStorage + Neon Postgres mirror.

## Global Constraints

- Two-lens independence: this feature touches only the People/ADHD-adjacent surface. Do not modify thesis-analysis code. (spec principle 2)
- Single dark surface family; no light mode. (DESIGN.md)
- **One Ink Rule:** copper (`cyan-*` tokens, remapped) is the only "primary/active" color. Relationship *types* are distinguished by SVG **stroke style + text label, never by new accent hues.** Sage (`emerald`) = done/verified only; amber = custom-lens only. (DESIGN.md)
- **Flat Field Rule:** no shadows; depth is tonal (`night pasture → ink panel → ink panel raised`). (DESIGN.md)
- **Single Column Rule:** every screen is one column inside `max-w-3xl` (people list) / the page's existing container. No sidebars. (DESIGN.md)
- Every interactive element ≥44px tall/wide. Use `BUTTON_PRIMARY`, `BUTTON_GHOST`, `BUTTON_SECONDARY`, `BUTTON_SECONDARY_CARD`, `LINK_BACK` from `src/lib/ui.ts` — never retype control class strings. (established pattern)
- All muted text uses `text-slate-400` (Graphite) or lighter; `text-slate-500` (`#7a6b58`) is barred from text. (DESIGN.md Two Greys Rule)
- Field bounds clipped at storage: names ≤120, roles ≤60, notes ≤5000, relationship note ≤500. (spec)
- All storage writes go through the quota-aware `writeMap` contract: a failed write makes the mutator return `null`, and the UI surfaces it as a failed op. (people.ts pattern)
- Respect `prefers-reduced-motion` on any new animation. (DESIGN.md)
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

## File structure

- Create `src/lib/geo.ts` — pure: `distanceMeters(a, b)`. No app imports. (Task 1)
- Create `src/lib/places.ts` — `omi-places` storage CRUD. (Task 2)
- Modify `src/lib/kv.ts` — register both new namespaces in `SYNCED_NAMESPACES`. (Tasks 2 & 4)
- Create `src/lib/relationships.ts` — `omi-relationships` storage CRUD + integrity hooks. (Task 3)
- Modify `src/lib/people.ts` — call relationship integrity hooks from `deletePerson`/`mergePeople`. (Task 3)
- Create `src/lib/place-resolve.ts` — `resolvePlace`, `groupMeetingsByPlace` (composes places + geo + meetings). (Task 4)
- Create `src/components/RelationshipEditor.tsx` — add/edit relationship panel. (Task 5)
- Create `src/components/EgoWeb.tsx` — single-person relationship SVG. (Task 6)
- Modify `src/app/people/[id]/page.tsx` — mount Relationships section (chips + editor + ego web) and "Where we've met". (Tasks 5, 6, 11)
- Create `src/lib/graph-layout.ts` — pure force-directed layout. No app imports. (Task 7)
- Create `src/components/RelationshipGraph.tsx` — whole-network SVG with pan/zoom/filter. (Task 8)
- Modify `src/app/people/page.tsx` — extend `ViewMode` to `grid | web | map | places`; render Web + Places views. (Tasks 8, 9)
- Create `src/app/people/place/[id]/page.tsx` — place detail page. (Task 9)
- Create `src/app/people/place/[id]/error.tsx` — error boundary (mirror existing). (Task 9)
- Modify `src/components/MeetingMap.tsx` — support a `places` prop + a marker action callback. (Task 10)

Add relationship/type-encoding icons to `src/components/icons.tsx` only if a needed glyph is missing (check first; reuse `UsersIcon`, `MapPinIcon`, `XIcon`, `CheckIcon`, `TrashIcon` if present).

---

## Task 1: Geometry helper (`src/lib/geo.ts`)

**Files:**
- Create: `src/lib/geo.ts`
- Test: `scratch/geo.test.mts` (throwaway, deleted in final step)

**Interfaces:**
- Consumes: nothing.
- Produces: `interface LatLng { lat: number; lng: number }` and `export function distanceMeters(a: LatLng, b: LatLng): number` — great-circle distance in metres (haversine).

- [ ] **Step 1: Write the failing test**

Create `scratch/geo.test.mts`:

```ts
import { distanceMeters } from "../src/lib/geo.ts";

function approx(got: number, want: number, tolerance: number, label: string) {
  if (Math.abs(got - want) > tolerance) {
    throw new Error(`FAIL ${label}: got ${got}, want ${want} ±${tolerance}`);
  }
  console.log(`ok ${label}: ${got.toFixed(1)}m`);
}

// Same point → 0
approx(distanceMeters({ lat: 47.61, lng: -114.09 }, { lat: 47.61, lng: -114.09 }), 0, 0.5, "same point");
// ~111.32m per 0.001° of latitude at the equator-ish scale
approx(distanceMeters({ lat: 47.61, lng: -114.09 }, { lat: 47.611, lng: -114.09 }), 111.2, 2, "0.001 lat");
// Known: Ronan MT to St. Ignatius MT ~ 12.5km
approx(distanceMeters({ lat: 47.5303, lng: -114.1017 }, { lat: 47.3199, lng: -114.0997 }), 23400, 500, "Ronan→St.Ignatius");
console.log("ALL PASS");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scratch/geo.test.mts`
Expected: FAIL — `Cannot find module '../src/lib/geo.ts'` (file not created yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/geo.ts`:

```ts
// Pure geometry. Imports nothing from the app so it stays unit-testable with
// `npx tsx` outside the Next/browser runtime.

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle (haversine) distance between two points, in metres. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scratch/geo.test.mts`
Expected: `ALL PASS`.

- [ ] **Step 5: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/lib/geo.ts`
Expected: no output (clean).

- [ ] **Step 6: Delete the scratch test and commit**

```bash
rm -f scratch/geo.test.mts && rmdir scratch 2>/dev/null || true
git add src/lib/geo.ts
git commit -m "feat(geo): add haversine distanceMeters helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Places storage (`src/lib/places.ts`)

**Files:**
- Create: `src/lib/places.ts`
- Modify: `src/lib/kv.ts:96-104` (add `"omi-places"` to `SYNCED_NAMESPACES`)
- Test: browser + tsc (imports `./sync` → not tsx-runnable)

**Interfaces:**
- Consumes: `schedulePush` from `./sync`; the quota-aware `writeMap` pattern (copied, since `people.ts`'s is not exported).
- Produces:
  - `interface Place { id: string; name: string; lat: number; lng: number; notes: string; createdAt: string; timestamp: string }`
  - `getPlaces(): Place[]` (sorted by name)
  - `getPlace(id: string): Place | null`
  - `createPlace(init: { name: string; lat: number; lng: number; notes?: string }): Place | null`
  - `updatePlace(id: string, patch: Partial<Omit<Place, "id" | "createdAt" | "timestamp">>): Place | null`
  - `deletePlace(id: string): boolean`

- [ ] **Step 1: Register the namespace**

In `src/lib/kv.ts`, add `"omi-places"` to the `SYNCED_NAMESPACES` array (it is an object-map namespace, so do NOT add it to `ARRAY_NAMESPACES`):

```ts
export const SYNCED_NAMESPACES = [
  // ...existing entries...
  "omi-people",
  "omi-people-pending",
  "omi-places",
] as const;
```

- [ ] **Step 2: Write the implementation**

Create `src/lib/places.ts`. Mirror `people.ts`'s read/write/tombstone helpers (the pattern is deliberately duplicated because `people.ts` does not export them):

```ts
"use client";

import { schedulePush } from "./sync";
import type { LatLng } from "./geo";

const PLACES_NS = "omi-places";

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  notes: string;
  createdAt: string;
  timestamp: string;
}

const MAX_NAME = 120;
const MAX_NOTES = 5_000;

function clip(value: string | undefined, max: number): string {
  const v = (value ?? "").trim();
  return v.length <= max ? v : `${v.slice(0, max - 1).trimEnd()}…`;
}

interface Tombstone {
  deleted: true;
  timestamp: string;
}
function isTombstone(v: unknown): v is Tombstone {
  return !!v && typeof v === "object" && (v as Tombstone).deleted === true;
}
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
function pruneTombstones<T>(map: Record<string, T>): Record<string, T> {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  for (const [k, v] of Object.entries(map)) {
    if (isTombstone(v) && new Date((v as Tombstone).timestamp).getTime() < cutoff) delete map[k];
  }
  return map;
}

function isPlaceRecord(v: unknown): v is Place {
  return (
    !!v && typeof v === "object" && !isTombstone(v) &&
    typeof (v as Place).name === "string" &&
    typeof (v as Place).lat === "number" &&
    typeof (v as Place).lng === "number"
  );
}

function readMap(): Record<string, unknown> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PLACES_NS);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, unknown>): boolean {
  try {
    localStorage.setItem(PLACES_NS, JSON.stringify(map));
    schedulePush(PLACES_NS);
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`${PLACES_NS}: localStorage quota exceeded; write dropped`);
    } else {
      console.error(`${PLACES_NS} write failed`, e);
    }
    return false;
  }
}

export function getPlaces(): Place[] {
  return Object.values(readMap())
    .filter(isPlaceRecord)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getPlace(id: string): Place | null {
  const rec = readMap()[id];
  return isPlaceRecord(rec) ? rec : null;
}

function put(place: Place): boolean {
  const map = pruneTombstones(readMap());
  map[place.id] = place;
  return writeMap(map);
}

export function createPlace(init: { name: string; lat: number; lng: number; notes?: string }): Place | null {
  const name = clip(init.name, MAX_NAME);
  if (!name || !Number.isFinite(init.lat) || !Number.isFinite(init.lng)) return null;
  const now = new Date().toISOString();
  const place: Place = {
    id: crypto.randomUUID(),
    name,
    lat: init.lat,
    lng: init.lng,
    notes: clip(init.notes, MAX_NOTES),
    createdAt: now,
    timestamp: now,
  };
  return put(place) ? place : null;
}

export function updatePlace(
  id: string,
  patch: Partial<Omit<Place, "id" | "createdAt" | "timestamp">>
): Place | null {
  const existing = getPlace(id);
  if (!existing) return null;
  const next: Place = {
    ...existing,
    ...patch,
    name: clip(patch.name ?? existing.name, MAX_NAME),
    notes: clip(patch.notes ?? existing.notes, MAX_NOTES),
    id,
    createdAt: existing.createdAt,
    timestamp: new Date().toISOString(),
  };
  if (!next.name || !Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return null;
  return put(next) ? next : null;
}

export function deletePlace(id: string): boolean {
  const map = pruneTombstones(readMap());
  if (!(id in map)) return true;
  map[id] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  return writeMap(map);
}

// Re-export for downstream consumers that treat a Place as a LatLng.
export type { LatLng };
```

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/lib/places.ts src/lib/kv.ts`
Expected: clean.

- [ ] **Step 4: Browser smoke via console**

Start the dev server if not running (`preview_start name=omi-dev`), open the app, then in the browser console:

```js
const p = await import('/src/lib/places.ts').catch(() => null);
```

If module import isn't reachable from console, instead verify indirectly in Task 9's UI. For now, confirm no build error: run `npx next build` and expect it to compile (`✓ Compiled`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/places.ts src/lib/kv.ts
git commit -m "feat(places): add omi-places storage namespace and CRUD

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Relationships storage + person integrity hooks

**Files:**
- Create: `src/lib/relationships.ts`
- Modify: `src/lib/kv.ts` (add `"omi-relationships"` to `SYNCED_NAMESPACES`)
- Modify: `src/lib/people.ts` (call hooks from `deletePerson` and `mergePeople`)
- Test: tsc + browser (Task 5 exercises it)

**Interfaces:**
- Consumes: `schedulePush` from `./sync`.
- Produces:
  - `type RelationshipType = "kin" | "work" | "neighbor" | "introduced" | "other"`
  - `interface Relationship { id: string; aId: string; bId: string; type: RelationshipType; aRole?: string; bRole?: string; note?: string; createdAt: string; timestamp: string }`
  - `getRelationships(): Relationship[]`
  - `getRelationshipsFor(personId: string): Relationship[]`
  - `addRelationship(init: { aId: string; bId: string; type: RelationshipType; aRole?: string; bRole?: string; note?: string }): Relationship | null` — upserts the unordered pair.
  - `updateRelationship(id: string, patch: Partial<Pick<Relationship, "type" | "aRole" | "bRole" | "note">>): Relationship | null`
  - `deleteRelationship(id: string): boolean`
  - `onPersonDeleted(personId: string): void` — deletes all edges touching the person.
  - `onPeopleMerged(sourceId: string, targetId: string): void` — rewires source edges to target, dropping self-links and duplicates.
  - `otherId(rel: Relationship, selfId: string): string` — the id on the far side.
  - `roleFor(rel: Relationship, selfId: string): { selfRole?: string; otherRole?: string }` — resolves which stored role belongs to whom.

- [ ] **Step 1: Register the namespace**

In `src/lib/kv.ts`, add `"omi-relationships"` to `SYNCED_NAMESPACES` (object-map namespace; not an array namespace).

- [ ] **Step 2: Write the implementation**

Create `src/lib/relationships.ts`:

```ts
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
```

- [ ] **Step 3: Wire integrity hooks into `people.ts`**

In `src/lib/people.ts`, import the hooks at the top:

```ts
import { onPersonDeleted, onPeopleMerged } from "./relationships";
```

In `deletePerson`, after the successful tombstone write, call the hook. Change the return to capture success first:

```ts
export function deletePerson(id: string): boolean {
  const map = pruneTombstones(readMap<unknown>(PEOPLE_NS));
  if (!(id in map)) return true;
  map[id] = { deleted: true, timestamp: new Date().toISOString() } satisfies Tombstone;
  const ok = writeMap(PEOPLE_NS, map);
  if (ok) onPersonDeleted(id);
  return ok;
}
```

In `mergePeople`, after `if (merged) deletePerson(sourceId);`, rewire edges. Note `deletePerson(sourceId)` already fires `onPersonDeleted(sourceId)` — so call `onPeopleMerged` BEFORE the delete, so edges move to the target instead of being deleted with the source:

```ts
  if (merged) {
    onPeopleMerged(sourceId, targetId); // rewire before the source's delete-hook removes them
    deletePerson(sourceId);
  }
  return merged;
```

- [ ] **Step 4: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/lib/relationships.ts src/lib/people.ts src/lib/kv.ts`
Expected: clean.

- [ ] **Step 5: Build**

Run: `npx next build`
Expected: compiles clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/relationships.ts src/lib/people.ts src/lib/kv.ts
git commit -m "feat(relationships): add omi-relationships storage with person delete/merge hooks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Place resolution (`src/lib/place-resolve.ts`)

**Files:**
- Create: `src/lib/place-resolve.ts`
- Test: `scratch/resolve.test.mts` (throwaway) — the pure resolver is extracted so it IS tsx-testable.

**Interfaces:**
- Consumes: `distanceMeters`, `LatLng` from `./geo`; `Place` from `./places`; `Meeting` from `./people`.
- Produces:
  - `SNAP_RADIUS_M = 200`
  - `resolvePlaceFrom(point: LatLng, places: Place[]): Place | null` — nearest place within `SNAP_RADIUS_M`, else null. **Pure** (places passed in, not read from storage) so it's unit-testable.
  - `resolvePlace(point: LatLng): Place | null` — thin wrapper calling `getPlaces()`.
  - `interface PlaceGroup { place: Place | null; rawName?: string; meetings: Meeting[] }`
  - `groupMeetingsByPlace(meetings: Meeting[], places: Place[]): PlaceGroup[]` — pure; groups located meetings by resolved place, un-located/un-resolved ones under `place: null` keyed by `rawName` (the meeting's `placeName`).

- [ ] **Step 1: Write the failing test**

Create `scratch/resolve.test.mts`:

```ts
import { resolvePlaceFrom, groupMeetingsByPlace, SNAP_RADIUS_M } from "../src/lib/place-resolve.ts";
import type { Place } from "../src/lib/places.ts";
import type { Meeting } from "../src/lib/people.ts";

function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL ${label}`);
  console.log(`ok ${label}`);
}

const dryFork: Place = { id: "p1", name: "Dry Fork", lat: 47.61, lng: -114.09, notes: "", createdAt: "", timestamp: "" };
const places = [dryFork];

// Within 200m → resolves
ok(resolvePlaceFrom({ lat: 47.6109, lng: -114.09 }, places)?.id === "p1", "within radius resolves");
// ~1km away → null
ok(resolvePlaceFrom({ lat: 47.62, lng: -114.09 }, places) === null, "far point is null");
ok(SNAP_RADIUS_M === 200, "radius is 200m");

const meetings: Meeting[] = [
  { conversationId: "c1", date: "2026-01-01", lat: 47.6101, lng: -114.09, placeName: "near dry fork" },
  { conversationId: "c2", date: "2026-01-02", lat: 47.70, lng: -114.20, placeName: "Ronan" },
  { conversationId: "c3", date: "2026-01-03" }, // no coords
];
const groups = groupMeetingsByPlace(meetings, places);
ok(groups.some((g) => g.place?.id === "p1" && g.meetings.length === 1), "c1 grouped to Dry Fork");
ok(groups.some((g) => g.place === null && g.rawName === "Ronan"), "c2 unresolved by raw name");
console.log("ALL PASS");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scratch/resolve.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/place-resolve.ts`:

```ts
import { distanceMeters, type LatLng } from "./geo";
import { getPlaces, type Place } from "./places";
import type { Meeting } from "./people";

export const SNAP_RADIUS_M = 200;

/** Nearest place within SNAP_RADIUS_M of `point`, or null. Pure: caller
 *  supplies the place list, so this runs in tests and on the server. */
export function resolvePlaceFrom(point: LatLng, places: Place[]): Place | null {
  let best: Place | null = null;
  let bestDist = SNAP_RADIUS_M;
  for (const place of places) {
    const d = distanceMeters(point, place);
    if (d <= bestDist) {
      best = place;
      bestDist = d;
    }
  }
  return best;
}

/** Storage-backed convenience wrapper. */
export function resolvePlace(point: LatLng): Place | null {
  return resolvePlaceFrom(point, getPlaces());
}

export interface PlaceGroup {
  place: Place | null;
  rawName?: string; // set only when place is null
  meetings: Meeting[];
}

/** Group meetings by resolved place. Located meetings that snap to a place are
 *  grouped under it; everything else is grouped under `place: null`, keyed by
 *  the meeting's raw Omi `placeName` (or "Unknown location"). Pure. */
export function groupMeetingsByPlace(meetings: Meeting[], places: Place[]): PlaceGroup[] {
  const byPlace = new Map<string, PlaceGroup>();
  const byRaw = new Map<string, PlaceGroup>();

  for (const m of meetings) {
    const located = m.lat != null && m.lng != null;
    const place = located ? resolvePlaceFrom({ lat: m.lat!, lng: m.lng! }, places) : null;
    if (place) {
      const g = byPlace.get(place.id) ?? { place, meetings: [] };
      g.meetings.push(m);
      byPlace.set(place.id, g);
    } else {
      const raw = (m.placeName ?? "").trim() || "Unknown location";
      const g = byRaw.get(raw) ?? { place: null, rawName: raw, meetings: [] };
      g.meetings.push(m);
      byRaw.set(raw, g);
    }
  }

  const placeGroups = [...byPlace.values()].sort((a, b) => b.meetings.length - a.meetings.length);
  const rawGroups = [...byRaw.values()].sort((a, b) => b.meetings.length - a.meetings.length);
  return [...placeGroups, ...rawGroups]; // named places first
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scratch/resolve.test.mts`
Expected: `ALL PASS`.

- [ ] **Step 5: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/lib/place-resolve.ts`
Expected: clean.

- [ ] **Step 6: Delete scratch test and commit**

```bash
rm -f scratch/resolve.test.mts && rmdir scratch 2>/dev/null || true
git add src/lib/place-resolve.ts
git commit -m "feat(places): add proximity place resolution and meeting grouping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Relationship editor + chip list on the person page

**Files:**
- Create: `src/components/RelationshipEditor.tsx`
- Modify: `src/app/people/[id]/page.tsx` (mount a Relationships section)
- Test: browser walkthrough

**Interfaces:**
- Consumes: `getPeople`, `createPerson`, `matchPerson`, `normalize`, `type Person` from `@/lib/people`; `addRelationship`, `updateRelationship`, `deleteRelationship`, `getRelationshipsFor`, `otherId`, `roleFor`, `RELATIONSHIP_TYPES`, `RELATIONSHIP_LABEL`, `type Relationship`, `type RelationshipType` from `@/lib/relationships`; `BUTTON_PRIMARY`, `BUTTON_SECONDARY_CARD` from `@/lib/ui`.
- Produces: default export `RelationshipEditor` with props:
  ```ts
  interface RelationshipEditorProps {
    selfId: string;
    people: Person[];               // directory excluding self, for search
    editing?: Relationship;         // when set, panel is in edit mode
    onSaved: () => void;            // parent re-reads relationships
    onCancel: () => void;
  }
  ```

- [ ] **Step 1: Build the editor component**

Create `src/components/RelationshipEditor.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { createPerson, matchPerson, normalize, type Person } from "@/lib/people";
import {
  addRelationship, updateRelationship, otherId, roleFor,
  RELATIONSHIP_TYPES, RELATIONSHIP_LABEL,
  type Relationship, type RelationshipType,
} from "@/lib/relationships";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD } from "@/lib/ui";

interface RelationshipEditorProps {
  selfId: string;
  people: Person[];
  editing?: Relationship;
  onSaved: () => void;
  onCancel: () => void;
}

const ROLE_TYPES: RelationshipType[] = ["kin", "introduced"];

export default function RelationshipEditor({ selfId, people, editing, onSaved, onCancel }: RelationshipEditorProps) {
  const directory = useMemo(() => people.filter((p) => p.id !== selfId), [people, selfId]);

  const editingOtherId = editing ? otherId(editing, selfId) : undefined;
  const editingRoles = editing ? roleFor(editing, selfId) : { selfRole: undefined, otherRole: undefined };

  const [query, setQuery] = useState(
    editingOtherId ? directory.find((p) => p.id === editingOtherId)?.name ?? "" : ""
  );
  const [chosenId, setChosenId] = useState<string | undefined>(editingOtherId);
  const [type, setType] = useState<RelationshipType>(editing?.type ?? "kin");
  const [otherRole, setOtherRole] = useState(editingRoles.otherRole ?? "");
  const [selfRole, setSelfRole] = useState(editingRoles.selfRole ?? "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [error, setError] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = normalize(query);
    if (!q || chosenId) return [];
    return directory
      .filter((p) => [p.name, ...p.aliases].some((n) => normalize(n).includes(q)))
      .slice(0, 6);
  }, [query, chosenId, directory]);

  const showRoles = ROLE_TYPES.includes(type);
  const canCreate = query.trim().length > 0 && !chosenId && matches.length === 0;

  const save = () => {
    setError(null);
    let targetId = chosenId;
    if (!targetId) {
      if (!canCreate) {
        setError("Pick a person, or type a new name to create.");
        return;
      }
      const created = createPerson({ name: query.trim() });
      if (!created) {
        setError("Could not create that person (name empty or storage full).");
        return;
      }
      targetId = created.id;
    }
    if (editing) {
      // updateRelationship stores roles by a/b orientation, so map the
      // editor's self/other roles onto whichever side `selfId` occupies.
      const oriented = editing.aId === selfId
        ? { aRole: showRoles ? selfRole : undefined, bRole: showRoles ? otherRole : undefined }
        : { aRole: showRoles ? otherRole : undefined, bRole: showRoles ? selfRole : undefined };
      const ok = updateRelationship(editing.id, { type, note, ...oriented });
      if (!ok) { setError("Could not save the change."); return; }
    } else {
      const rel = addRelationship({
        aId: selfId, bId: targetId, type,
        aRole: showRoles ? selfRole : undefined,
        bRole: showRoles ? otherRole : undefined,
        note,
      });
      if (!rel) { setError("Could not save the relationship."); return; }
    }
    onSaved();
  };

  return (
    <div className="enter-rise card p-4 border-cyan-500/30 mt-3">
      <label className="block text-sm text-slate-400 mb-1">Person</label>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setChosenId(undefined); }}
        placeholder="Search a person, or type a new name…"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]"
        disabled={!!editing}
      />
      {matches.length > 0 && (
        <ul className="mt-1 space-y-1">
          {matches.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { setChosenId(p.id); setQuery(p.name); }}
                className="w-full text-left text-sm text-slate-200 px-3 py-2 min-h-[44px] rounded-lg hover:bg-slate-700 transition-colors"
              >
                {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <p className="text-xs text-slate-400 mt-1">
          No match — saving will create “{query.trim()}” and link them.
        </p>
      )}

      <div className="mt-3">
        <span className="block text-sm text-slate-400 mb-1">Type</span>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Relationship type">
          {RELATIONSHIP_TYPES.map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                type === t ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white"
              }`}
            >
              {RELATIONSHIP_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {showRoles && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm text-slate-400 mb-1">Their role</label>
            <input value={otherRole} onChange={(e) => setOtherRole(e.target.value)} placeholder="e.g. daughter"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">My role</label>
            <input value={selfRole} onChange={(e) => setSelfRole(e.target.value)} placeholder="e.g. father"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
          </div>
        </div>
      )}

      <div className="mt-3">
        <label className="block text-sm text-slate-400 mb-1">Note (optional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. leases her east pasture"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
      </div>

      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}

      <div className="flex gap-2 mt-4">
        <button onClick={save} className={`${BUTTON_PRIMARY} py-2 px-5`}>
          {editing ? "Save" : "Add relationship"}
        </button>
        <button onClick={onCancel} className={BUTTON_SECONDARY_CARD}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount the Relationships section in the person page**

In `src/app/people/[id]/page.tsx`, add imports:

```ts
import RelationshipEditor from "@/components/RelationshipEditor";
import {
  getRelationshipsFor, deleteRelationship, otherId, roleFor,
  RELATIONSHIP_TYPES, RELATIONSHIP_LABEL, type Relationship,
} from "@/lib/relationships";
```

Add state (near the other `useState`s):

```ts
const [rels, setRels] = useState<Relationship[]>([]);
const [addingRel, setAddingRel] = useState(false);
const [editingRel, setEditingRel] = useState<Relationship | null>(null);
```

Where the page reads the person (the effect that calls `getPerson(id)` / `setPeople(getPeople())`), also set relationships:

```ts
setRels(getRelationshipsFor(id));
```

Add a re-read helper and use it after editor save/delete:

```ts
const refreshRels = () => setRels(getRelationshipsFor(id));
```

Render a Relationships section after the Notes section (before Meetings). `people` is already loaded on this page as `people` state (the merge picker uses it); pass it to the editor. Group chips by type:

```tsx
<section className="card p-5 mt-4">
  <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Relationships</h2>

  {rels.length === 0 && !addingRel && (
    <p className="text-slate-400 text-sm">No relationships yet.</p>
  )}

  {RELATIONSHIP_TYPES.map((t) => {
    const ofType = rels.filter((r) => r.type === t);
    if (ofType.length === 0) return null;
    return (
      <div key={t} className="mb-3 last:mb-0">
        <p className="text-xs text-slate-400 mb-1.5">{RELATIONSHIP_LABEL[t]}</p>
        <div className="flex flex-wrap gap-2">
          {ofType.map((r) => {
            const oid = otherId(r, id);
            const other = people.find((p) => p.id === oid);
            const { otherRole } = roleFor(r, id);
            const detail = otherRole || r.note;
            return (
              <span key={r.id} className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-full pl-3 pr-1.5 py-1 text-sm text-slate-200">
                <button
                  onClick={() => router.push(`/people/${oid}`)}
                  className="hover:text-white transition-colors"
                >
                  {other?.name ?? "Unknown"}{detail ? <span className="text-slate-400"> · {detail}</span> : null}
                </button>
                <button
                  onClick={() => { setEditingRel(r); setAddingRel(false); }}
                  aria-label={`Edit relationship with ${other?.name ?? "person"}`}
                  className="min-h-[32px] min-w-[32px] flex items-center justify-center rounded-full text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  ⋯
                </button>
              </span>
            );
          })}
        </div>
      </div>
    );
  })}

  {editingRel && (
    <RelationshipEditor
      selfId={id}
      people={people}
      editing={editingRel}
      onSaved={() => { setEditingRel(null); refreshRels(); }}
      onCancel={() => setEditingRel(null)}
    />
  )}

  {addingRel && !editingRel && (
    <RelationshipEditor
      selfId={id}
      people={people}
      onSaved={() => { setAddingRel(false); refreshRels(); }}
      onCancel={() => setAddingRel(false)}
    />
  )}

  {!addingRel && !editingRel && (
    <button
      onClick={() => setAddingRel(true)}
      className={`${BUTTON_SECONDARY_CARD} mt-3`}
    >
      Add relationship
    </button>
  )}

  {editingRel && (
    <button
      onClick={() => { if (deleteRelationship(editingRel.id)) { setEditingRel(null); refreshRels(); } }}
      className="text-sm text-red-400 hover:text-red-300 mt-2 min-h-[44px] px-2"
    >
      Remove this relationship
    </button>
  )}
</section>
```

Ensure `BUTTON_SECONDARY_CARD` is in the page's `@/lib/ui` import (add if missing). Confirm `router` is available (the page already uses `useRouter`).

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/components/RelationshipEditor.tsx "src/app/people/[id]/page.tsx"`
Expected: clean. (If tsc flags the `as never` placeholder, you correctly deleted it per the Step 1 note.)

- [ ] **Step 4: Browser walkthrough**

Start dev server. Because Omi isn't configured in dev, create test data via console on a person page: run the People backfill isn't available, so instead open the app, create two people through the existing "Add person" UI on `/people`, open one, and:
1. Add relationship → search the other → pick type "Kin" → set roles → Add. Confirm a chip appears under "Kin".
2. Reload the page; confirm the chip persists (localStorage).
3. Click ⋯ → change type to "Neighbor" → Save; confirm it moves groups.
4. ⋯ → Remove; confirm it disappears.
5. Add relationship → type a brand-new name → confirm "will create … and link" hint → Add → confirm the new person exists at `/people` and the link shows.
6. Open the linked person's page; confirm the reciprocal chip shows there too.

Take a screenshot at mobile width (375px) showing the chip list.

- [ ] **Step 5: Commit**

```bash
git add src/components/RelationshipEditor.tsx "src/app/people/[id]/page.tsx"
git commit -m "feat(relationships): add relationship editor and chip list to person page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Ego web (`src/components/EgoWeb.tsx`)

**Files:**
- Create: `src/components/EgoWeb.tsx`
- Modify: `src/app/people/[id]/page.tsx` (render above the chip list)
- Test: browser

**Interfaces:**
- Consumes: `type Relationship`, `otherId`, `roleFor`, `RELATIONSHIP_LABEL` from `@/lib/relationships`; `type Person` from `@/lib/people`.
- Produces: default export `EgoWeb` with props:
  ```ts
  interface EgoWebProps {
    self: Person;
    rels: Relationship[];
    people: Person[];
    onNavigate: (personId: string) => void;
  }
  ```
  Renders nothing when `rels.length === 0`.

**Stroke encoding (shared with Task 8):** `kin` solid, `work` `4 3` dash, `neighbor` `8 4` dash, `introduced` `1 4` dotted, `other` `2 6` faint. Define once here and reuse in Task 8:

```ts
export const REL_DASH: Record<import("@/lib/relationships").RelationshipType, string> = {
  kin: "0", work: "4 3", neighbor: "8 4", introduced: "1 4", other: "2 6",
};
```

- [ ] **Step 1: Build the component**

Create `src/components/EgoWeb.tsx`:

```tsx
"use client";

import { otherId, roleFor, RELATIONSHIP_LABEL, type Relationship, type RelationshipType } from "@/lib/relationships";
import type { Person } from "@/lib/people";

export const REL_DASH: Record<RelationshipType, string> = {
  kin: "0", work: "4 3", neighbor: "8 4", introduced: "1 4", other: "2 6",
};

interface EgoWebProps {
  self: Person;
  rels: Relationship[];
  people: Person[];
  onNavigate: (personId: string) => void;
}

const W = 360;
const H = 240;
const CX = W / 2;
const CY = H / 2;

export default function EgoWeb({ self, rels, people, onNavigate }: EgoWebProps) {
  if (rels.length === 0) return null;
  const nameOf = (pid: string) => people.find((p) => p.id === pid)?.name ?? "Unknown";

  // One ring up to 8 neighbors; a second, larger ring beyond that.
  const nodes = rels.map((r, i) => {
    const oid = otherId(r, self.id);
    const ring = i < 8 ? 0 : 1;
    const inRing = ring === 0 ? Math.min(rels.length, 8) : rels.length - 8;
    const idx = ring === 0 ? i : i - 8;
    const radius = ring === 0 ? 92 : 116;
    const angle = (idx / inRing) * Math.PI * 2 - Math.PI / 2;
    return {
      rel: r, oid,
      x: CX + radius * Math.cos(angle),
      y: CY + radius * Math.sin(angle),
    };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-md mx-auto block" role="img"
      aria-label={`Relationship web for ${self.name}`}>
      {nodes.map((n) => (
        <line key={`e-${n.rel.id}`} x1={CX} y1={CY} x2={n.x} y2={n.y}
          stroke="#4d4133" strokeWidth={1.5} strokeDasharray={REL_DASH[n.rel.type]} />
      ))}
      {nodes.map((n) => {
        const { otherRole } = roleFor(n.rel, self.id);
        const label = otherRole || RELATIONSHIP_LABEL[n.rel.type];
        return (
          <text key={`l-${n.rel.id}`} x={(CX + n.x) / 2} y={(CY + n.y) / 2 - 3}
            textAnchor="middle" fill="#a89a88" fontSize={8}>{label}</text>
        );
      })}
      {nodes.map((n) => (
        <g key={`n-${n.rel.id}`} onClick={() => onNavigate(n.oid)} style={{ cursor: "pointer" }}
          role="button" aria-label={`Open ${nameOf(n.oid)}`}>
          <circle cx={n.x} cy={n.y} r={20} fill="#262019" stroke="#4d4133" />
          <text x={n.x} y={n.y + 3} textAnchor="middle" fill="#dcd2bf" fontSize={9}>
            {nameOf(n.oid).split(" ")[0].slice(0, 8)}
          </text>
        </g>
      ))}
      <circle cx={CX} cy={CY} r={26} fill="#b96d33" />
      <text x={CX} y={CY + 4} textAnchor="middle" fill="#14100d" fontSize={11} fontWeight={700}>
        {self.name.split(" ")[0].slice(0, 8)}
      </text>
    </svg>
  );
}
```

- [ ] **Step 2: Render it in the person page**

In `src/app/people/[id]/page.tsx`, import and render inside the Relationships `<section>`, above the chip groups, only when there are relationships:

```tsx
import EgoWeb from "@/components/EgoWeb";
// ...inside the section, before the type-group map:
{rels.length > 0 && person && (
  <div className="mb-4">
    <EgoWeb self={person} rels={rels} people={people} onNavigate={(pid) => router.push(`/people/${pid}`)} />
  </div>
)}
```

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/components/EgoWeb.tsx`
Expected: clean.

- [ ] **Step 4: Browser walkthrough**

On a person with ≥3 relationships of mixed types, confirm: the center node is copper with their name; neighbors sit on a ring with edge labels; edge stroke styles differ by type; tapping a neighbor navigates and the web re-centers on that person. Add a 9th+ relationship and confirm the second ring appears. Screenshot at 375px.

- [ ] **Step 5: Commit**

```bash
git add src/components/EgoWeb.tsx "src/app/people/[id]/page.tsx"
git commit -m "feat(relationships): add ego-web visualization to person page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Force-directed layout (`src/lib/graph-layout.ts`)

**Files:**
- Create: `src/lib/graph-layout.ts`
- Test: `scratch/layout.test.mts` (throwaway)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LayoutNode { id: string; x: number; y: number }`
  - `interface LayoutEdge { a: string; b: string }`
  - `computeLayout(ids: string[], edges: LayoutEdge[], opts?: { width?: number; height?: number; iterations?: number; seed?: number }): Map<string, { x: number; y: number }>` — deterministic (seeded), dependency-free force simulation. Seeds nodes on a circle (never coincident), applies pairwise repulsion + spring edges + weak centering, returns final positions.

- [ ] **Step 1: Write the failing test**

Create `scratch/layout.test.mts`:

```ts
import { computeLayout } from "../src/lib/graph-layout.ts";

function ok(cond: boolean, label: string) {
  if (!cond) throw new Error(`FAIL ${label}`);
  console.log(`ok ${label}`);
}

const ids = ["a", "b", "c", "d"];
const edges = [{ a: "a", b: "b" }, { a: "c", b: "d" }];
const pos = computeLayout(ids, edges, { width: 400, height: 300, iterations: 150, seed: 1 });

ok(pos.size === 4, "one position per node");
for (const id of ids) {
  const p = pos.get(id)!;
  ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${id} finite`);
}
// Determinism: same inputs → same output
const pos2 = computeLayout(ids, edges, { width: 400, height: 300, iterations: 150, seed: 1 });
ok(pos.get("a")!.x === pos2.get("a")!.x, "deterministic");
// Connected pair ends up closer than a repelled non-adjacent pair, roughly:
const dist = (p: string, q: string) => Math.hypot(pos.get(p)!.x - pos.get(q)!.x, pos.get(p)!.y - pos.get(q)!.y);
ok(dist("a", "b") < 400, "edge keeps a,b bounded");
// Degenerate: single node doesn't crash / NaN
const one = computeLayout(["x"], [], { seed: 1 });
ok(Number.isFinite(one.get("x")!.x), "single node finite");
console.log("ALL PASS");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx scratch/layout.test.mts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

Create `src/lib/graph-layout.ts`:

```ts
// Pure, dependency-free force-directed layout. Deterministic given a seed so
// the graph doesn't reshuffle on every render. Imports nothing from the app.

export interface LayoutNode { id: string; x: number; y: number }
export interface LayoutEdge { a: string; b: string }

// Small seeded PRNG (mulberry32) — avoids Math.random so layouts are stable.
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function computeLayout(
  ids: string[],
  edges: LayoutEdge[],
  opts: { width?: number; height?: number; iterations?: number; seed?: number } = {}
): Map<string, { x: number; y: number }> {
  const width = opts.width ?? 600;
  const height = opts.height ?? 400;
  const iterations = opts.iterations ?? 150;
  const rand = mulberry32(opts.seed ?? 1);
  const cx = width / 2;
  const cy = height / 2;

  // Seed on a circle so no two nodes are coincident (avoids NaN forces).
  const pos = new Map<string, { x: number; y: number }>();
  const R = Math.min(width, height) / 3;
  ids.forEach((id, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2;
    pos.set(id, {
      x: cx + R * Math.cos(a) + (rand() - 0.5) * 2,
      y: cy + R * Math.sin(a) + (rand() - 0.5) * 2,
    });
  });

  if (ids.length <= 1) return pos;

  const REPULSION = 4000;
  const SPRING = 0.02;
  const SPRING_LEN = 90;
  const CENTER_PULL = 0.008;

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { dx: number; dy: number }>();
    ids.forEach((id) => disp.set(id, { dx: 0, dy: 0 }));

    // Pairwise repulsion.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pi = pos.get(ids[i])!;
        const pj = pos.get(ids[j])!;
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = rand(); dy = rand(); d2 = dx * dx + dy * dy; }
        const force = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        disp.get(ids[i])!.dx += fx; disp.get(ids[i])!.dy += fy;
        disp.get(ids[j])!.dx -= fx; disp.get(ids[j])!.dy -= fy;
      }
    }

    // Spring edges.
    for (const e of edges) {
      const pa = pos.get(e.a); const pb = pos.get(e.b);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const force = SPRING * (d - SPRING_LEN);
      const fx = (dx / d) * force;
      const fy = (dy / d) * force;
      disp.get(e.a)!.dx += fx; disp.get(e.a)!.dy += fy;
      disp.get(e.b)!.dx -= fx; disp.get(e.b)!.dy -= fy;
    }

    // Weak centering + integrate with cooling.
    const cooling = 1 - iter / iterations;
    for (const id of ids) {
      const p = pos.get(id)!;
      const dp = disp.get(id)!;
      dp.dx += (cx - p.x) * CENTER_PULL;
      dp.dy += (cy - p.y) * CENTER_PULL;
      const step = 4 * cooling;
      const mag = Math.hypot(dp.dx, dp.dy) || 1;
      p.x += (dp.dx / mag) * Math.min(mag, step * 6);
      p.y += (dp.dy / mag) * Math.min(mag, step * 6);
    }
  }
  return pos;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx scratch/layout.test.mts`
Expected: `ALL PASS`.

- [ ] **Step 5: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/lib/graph-layout.ts`
Expected: clean.

- [ ] **Step 6: Delete scratch and commit**

```bash
rm -f scratch/layout.test.mts && rmdir scratch 2>/dev/null || true
git add src/lib/graph-layout.ts
git commit -m "feat(graph): add deterministic force-directed layout helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 8: Web view (`src/components/RelationshipGraph.tsx` + People tab)

**Files:**
- Create: `src/components/RelationshipGraph.tsx`
- Modify: `src/app/people/page.tsx` (extend `ViewMode`, add Web toggle + render)
- Test: browser

**Interfaces:**
- Consumes: `computeLayout`, `type LayoutEdge` from `@/lib/graph-layout`; `getRelationships`, `RELATIONSHIP_TYPES`, `RELATIONSHIP_LABEL`, `type Relationship`, `type RelationshipType` from `@/lib/relationships`; `REL_DASH` from `@/components/EgoWeb`; `type Person` from `@/lib/people`.
- Produces: default export `RelationshipGraph`:
  ```ts
  interface RelationshipGraphProps {
    people: Person[];
    onOpen: (personId: string) => void;
  }
  ```

- [ ] **Step 1: Build the component**

Create `src/components/RelationshipGraph.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import { computeLayout } from "@/lib/graph-layout";
import {
  getRelationships, RELATIONSHIP_TYPES, RELATIONSHIP_LABEL,
  type Relationship, type RelationshipType,
} from "@/lib/relationships";
import { REL_DASH } from "@/components/EgoWeb";
import type { Person } from "@/lib/people";

interface RelationshipGraphProps {
  people: Person[];
  onOpen: (personId: string) => void;
}

const W = 600;
const H = 460;

export default function RelationshipGraph({ people, onOpen }: RelationshipGraphProps) {
  const [filter, setFilter] = useState<RelationshipType | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const allRels = useMemo(() => getRelationships(), []);
  const rels = useMemo(
    () => (filter === "all" ? allRels : allRels.filter((r) => r.type === filter)),
    [allRels, filter]
  );

  const nameOf = useMemo(() => {
    const m = new Map(people.map((p) => [p.id, p.name] as const));
    return (id: string) => m.get(id) ?? "Unknown";
  }, [people]);

  // Only people that appear in at least one (filtered) edge, and that still exist.
  const ids = useMemo(() => {
    const alive = new Set(people.map((p) => p.id));
    const s = new Set<string>();
    for (const r of rels) {
      if (alive.has(r.aId) && alive.has(r.bId)) { s.add(r.aId); s.add(r.bId); }
    }
    return [...s];
  }, [rels, people]);

  const edges = useMemo(
    () => rels.filter((r) => ids.includes(r.aId) && ids.includes(r.bId)).map((r) => ({ a: r.aId, b: r.bId, rel: r })),
    [rels, ids]
  );

  const pos = useMemo(
    () => computeLayout(ids, edges.map((e) => ({ a: e.a, b: e.b })), { width: W, height: H, seed: 1 }),
    [ids, edges]
  );

  if (ids.length === 0) {
    return (
      <div className="card p-8 text-center">
        <p className="text-slate-300">No relationships to show yet.</p>
        <p className="text-slate-400 text-sm mt-2">Open a person and add a relationship to build the web.</p>
      </div>
    );
  }

  const isDim = (pid: string) => selected != null && pid !== selected &&
    !edges.some((e) => (e.a === selected && e.b === pid) || (e.b === selected && e.a === pid));

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-3" role="radiogroup" aria-label="Filter by relationship type">
        {(["all", ...RELATIONSHIP_TYPES] as const).map((t) => (
          <button key={t} role="radio" aria-checked={filter === t}
            onClick={() => setFilter(t)}
            className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
              filter === t ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300 hover:text-white"
            }`}>
            {t === "all" ? "All" : RELATIONSHIP_LABEL[t as RelationshipType]}
          </button>
        ))}
      </div>

      <div className="card p-2 overflow-hidden">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ touchAction: "pan-y" }}
          role="group" aria-label="Relationship network">
          {edges.map((e) => {
            const pa = pos.get(e.a)!; const pb = pos.get(e.b)!;
            const dim = selected != null && e.a !== selected && e.b !== selected;
            return (
              <line key={e.rel.id} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke="#4d4133" strokeOpacity={dim ? 0.25 : 1} strokeWidth={1.4}
                strokeDasharray={REL_DASH[e.rel.type]} />
            );
          })}
          {ids.map((pid) => {
            const p = pos.get(pid)!;
            const dim = isDim(pid);
            const isSel = pid === selected;
            return (
              <g key={pid} style={{ cursor: "pointer" }} opacity={dim ? 0.35 : 1}
                onClick={() => (isSel ? onOpen(pid) : setSelected(pid))}
                role="button" aria-label={isSel ? `Open ${nameOf(pid)}` : `Highlight ${nameOf(pid)}`}>
                <circle cx={p.x} cy={p.y} r={18} fill={isSel ? "#b96d33" : "#262019"} stroke="#4d4133" />
                <text x={p.x} y={p.y + 3} textAnchor="middle" fontSize={9}
                  fill={isSel ? "#14100d" : "#dcd2bf"}>{nameOf(pid).split(" ")[0].slice(0, 8)}</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-slate-400 mt-2 text-center">
        Tap a person to highlight their links; tap again to open.
      </p>
    </div>
  );
}
```

> Zoom/pan note: the spec asks for pinch/pan. A full gesture handler is optional polish; the `viewBox` scales the graph to fit any width, and the graph is bounded by the layout's centering so it stays on-canvas. If, during the browser check, a dense graph is cramped on mobile, add wheel/pinch by making `viewBox` state and adjusting it on `onWheel`/two-pointer `onPointerMove`. Keep it out of the first pass unless the check shows it's needed.

- [ ] **Step 2: Extend the People page view toggle**

In `src/app/people/page.tsx`:

Change the type and toggle. Current: `type ViewMode = "grid" | "map";`. New:

```ts
type ViewMode = "grid" | "web" | "map" | "places";
```

Import the graph and relationships-count:

```ts
import RelationshipGraph from "@/components/RelationshipGraph";
```

In the view-toggle control (the `role="group" aria-label="View mode"` block with Grid/Map buttons), add a Web button between Grid and Map, matching the existing button styling (the `min-h-[36px]` segmented buttons). Use `UsersIcon` (already imported) or a suitable existing icon:

```tsx
<button
  onClick={() => setView("web")}
  className={`flex items-center gap-1.5 text-sm min-h-[36px] px-3 py-1.5 rounded-md transition-colors ${
    view === "web" ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"
  }`}
  aria-pressed={view === "web"}
>
  <UsersIcon className="w-4 h-4" />
  Web
</button>
```

Render the Web view where the Grid/Map views are conditionally rendered:

```tsx
{view === "web" && (
  <RelationshipGraph people={filteredPeople} onOpen={(pid) => router.push(`/people/${pid}`)} />
)}
```

(`router` is already available on this page via `useRouter`.)

- [ ] **Step 3: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint src/components/RelationshipGraph.tsx src/app/people/page.tsx`
Expected: clean.

- [ ] **Step 4: Browser walkthrough**

With several linked people: switch to Web view. Confirm nodes render, clusters form, tapping a node dims others and highlights its edges, tapping again opens the person, filter chips reduce the graph by type, and the empty state shows when no links exist (filter to a type with no edges). Screenshot at 375px and desktop.

- [ ] **Step 5: Commit**

```bash
git add src/components/RelationshipGraph.tsx src/app/people/page.tsx
git commit -m "feat(relationships): add whole-network Web view to People tab

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 9: Places view + place detail page

**Files:**
- Create: `src/app/people/place/[id]/page.tsx`
- Create: `src/app/people/place/[id]/error.tsx` (mirror `src/app/people/[id]/error.tsx`)
- Modify: `src/app/people/page.tsx` (Places view: list + "Add place" panel)
- Test: browser

**Interfaces:**
- Consumes: `getPlaces`, `getPlace`, `createPlace`, `updatePlace`, `deletePlace`, `type Place` from `@/lib/places`; `groupMeetingsByPlace`, `type PlaceGroup` from `@/lib/place-resolve`; `getPeople`, `type Person`, `type Meeting` from `@/lib/people`; `MeetingMap` from `@/components/MeetingMap`; `ConfirmDialog`; `BUTTON_PRIMARY`, `BUTTON_SECONDARY_CARD`, `LINK_BACK` from `@/lib/ui`.
- Produces: a `/people/place/[id]` route; a Places list view.

Helper both consumers need — collect distinct located meetings from all people (for pin picking and place "met here"):

```ts
// Given all people, return { lat, lng, rawName, personId, date } for every located meeting.
interface LocatedMeeting { lat: number; lng: number; rawName?: string; personId: string; personName: string; date: string }
```

- [ ] **Step 1: Places list view in the People page**

In `src/app/people/page.tsx`, add state and a Places button (mirroring the Web button from Task 8) plus the render branch.

Add imports:

```ts
import Link from "next/link";
import { getPlaces, createPlace, type Place } from "@/lib/places";
import { groupMeetingsByPlace } from "@/lib/place-resolve";
```

Add state:

```ts
const [places, setPlaces] = useState<Place[]>([]);
const [addingPlace, setAddingPlace] = useState(false);
```

In the load effect (`refresh`), also `setPlaces(getPlaces())`.

Compute located meetings across everyone (for counts + pin picking):

```ts
const locatedMeetings = useMemo(() => {
  const out: { lat: number; lng: number; rawName?: string; personId: string; personName: string; date: string }[] = [];
  for (const p of people) {
    for (const m of p.meetings) {
      if (m.lat != null && m.lng != null) {
        out.push({ lat: m.lat, lng: m.lng, rawName: m.placeName, personId: p.id, personName: p.name, date: m.date });
      }
    }
  }
  return out;
}, [people]);

const placeStats = useMemo(() => {
  // meetings & distinct-people counts per place, via resolution
  const meetings = people.flatMap((p) => p.meetings.map((m) => ({ ...m, personId: p.id })));
  const groups = groupMeetingsByPlace(meetings as never, places);
  const stat = new Map<string, { meetings: number; people: number }>();
  for (const g of groups) {
    if (!g.place) continue;
    const persons = new Set((g.meetings as { personId?: string }[]).map((m) => m.personId));
    stat.set(g.place.id, { meetings: g.meetings.length, people: persons.size });
  }
  return stat;
}, [people, places]);
```

> Note: `Meeting` has no `personId`; the cast threads it through for counting only. If tsc rejects the cast, define a local `type MeetingWithPerson = Meeting & { personId: string }` and use it for `meetings`/`groups`.

Add a Places toggle button (after the Map button), same styling, using `MapPinIcon` (import if not present — check `icons.tsx`).

Render branch:

```tsx
{view === "places" && (
  <div>
    <div className="flex justify-end mb-3">
      <button onClick={() => setAddingPlace(true)} className={BUTTON_SECONDARY_CARD}>Add place</button>
    </div>

    {addingPlace && (
      <AddPlacePanel
        locatedMeetings={locatedMeetings}
        onCancel={() => setAddingPlace(false)}
        onCreated={() => { setAddingPlace(false); setPlaces(getPlaces()); }}
      />
    )}

    {places.length === 0 && !addingPlace && (
      <div className="card p-8 text-center">
        <p className="text-slate-300">No places yet.</p>
        <p className="text-slate-400 text-sm mt-2">Name a location you’ve met people at to start.</p>
      </div>
    )}

    <div className="space-y-3">
      {places.map((pl) => {
        const s = placeStats.get(pl.id);
        return (
          <Link key={pl.id} href={`/people/place/${pl.id}`} className="card p-5 block hover:border-cyan-500/50 transition-colors">
            <h2 className="font-serif text-lg text-white">{pl.name}</h2>
            <p className="text-slate-400 text-sm mt-1">
              {s ? `${s.meetings} meeting${s.meetings === 1 ? "" : "s"} · ${s.people} ${s.people === 1 ? "person" : "people"}` : "No meetings yet"}
            </p>
            {pl.notes && <p className="text-slate-400 text-sm mt-1 line-clamp-1">{pl.notes}</p>}
          </Link>
        );
      })}
    </div>
  </div>
)}
```

Define `AddPlacePanel` as a small component at the bottom of the same file (it's page-specific, so co-locating is fine):

```tsx
function AddPlacePanel({
  locatedMeetings, onCancel, onCreated,
}: {
  locatedMeetings: { lat: number; lng: number; rawName?: string; personName: string; date: string }[];
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Distinct coordinates (rounded) so the picker isn't one row per meeting.
  const options = useMemo(() => {
    const seen = new Map<string, { lat: number; lng: number; label: string }>();
    for (const m of locatedMeetings) {
      const key = `${m.lat.toFixed(4)},${m.lng.toFixed(4)}`;
      if (!seen.has(key)) seen.set(key, { lat: m.lat, lng: m.lng, label: m.rawName || `${m.lat.toFixed(3)}, ${m.lng.toFixed(3)}` });
    }
    return [...seen.values()].slice(0, 30);
  }, [locatedMeetings]);

  const save = () => {
    setError(null);
    const lat = coord?.lat ?? parseFloat(manualLat);
    const lng = coord?.lng ?? parseFloat(manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setError("Pick a location or enter coordinates."); return; }
    if (!createPlace({ name, lat, lng, notes })) { setError("Could not create the place (name empty or storage full)."); return; }
    onCreated();
  };

  return (
    <div className="enter-rise card p-4 mb-3">
      <label className="block text-sm text-slate-400 mb-1">Name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dry Fork Ranch"
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />

      <p className="text-sm text-slate-400 mt-3 mb-1">Pin</p>
      {options.length > 0 ? (
        <div className="space-y-1 max-h-40 overflow-auto">
          {options.map((o) => (
            <button key={`${o.lat},${o.lng}`} onClick={() => { setCoord(o); setManualLat(""); setManualLng(""); }}
              className={`w-full text-left text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors ${
                coord?.lat === o.lat && coord?.lng === o.lng ? "bg-cyan-950/40 border border-cyan-500/50 text-cyan-200" : "text-slate-300 hover:bg-slate-700"
              }`}>
              {o.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No meeting locations found — enter coordinates below.</p>
      )}
      <div className="grid grid-cols-2 gap-2 mt-2">
        <input value={manualLat} onChange={(e) => { setManualLat(e.target.value); setCoord(null); }} placeholder="lat"
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
        <input value={manualLng} onChange={(e) => { setManualLng(e.target.value); setCoord(null); }} placeholder="lng"
          className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
      </div>

      <label className="block text-sm text-slate-400 mb-1 mt-3">Notes (optional)</label>
      <input value={notes} onChange={(e) => setNotes(e.target.value)}
        className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none min-h-[44px]" />

      {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
      <div className="flex gap-2 mt-4">
        <button onClick={save} className={`${BUTTON_PRIMARY} py-2 px-5`}>Create place</button>
        <button onClick={onCancel} className={BUTTON_SECONDARY_CARD}>Cancel</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the place detail page**

Create `src/app/people/place/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getPlace, updatePlace, deletePlace, type Place } from "@/lib/places";
import { getPeople, type Person } from "@/lib/people";
import { groupMeetingsByPlace } from "@/lib/place-resolve";
import MeetingMap, { type MapMarker } from "@/components/MeetingMap";
import ConfirmDialog from "@/components/ConfirmDialog";
import { pullAndMerge } from "@/lib/sync";
import { BUTTON_PRIMARY, BUTTON_SECONDARY_CARD, LINK_BACK } from "@/lib/ui";

export default function PlaceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [place, setPlace] = useState<Place | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    pullAndMerge().then(() => {
      if (cancelled) return;
      setPlace(getPlace(id));
      setPeople(getPeople());
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [id]);

  // People met here, with counts, via resolution against this one place.
  const metHere = useMemo(() => {
    if (!place) return [];
    const rows: { person: Person; count: number }[] = [];
    for (const p of people) {
      const groups = groupMeetingsByPlace(p.meetings, [place]);
      const g = groups.find((x) => x.place?.id === place.id);
      if (g) rows.push({ person: p, count: g.meetings.length });
    }
    return rows.sort((a, b) => b.count - a.count);
  }, [people, place]);

  if (loading) {
    return <main className="max-w-3xl mx-auto px-4 py-8"><div className="skeleton h-24 w-full" /></main>;
  }
  if (!place) {
    return (
      <main className="max-w-3xl mx-auto px-4 py-8 text-center">
        <h1 className="font-bold text-white mb-2">This place no longer exists</h1>
        <Link href="/people" className={BUTTON_SECONDARY_CARD}>All people</Link>
      </main>
    );
  }

  const marker: MapMarker = { lat: place.lat, lng: place.lng, label: place.name };

  const saveEdit = () => {
    setError(null);
    if (!updatePlace(id, { name: nameDraft, notes: notesDraft })) { setError("Could not save."); return; }
    setPlace(getPlace(id));
    setEditing(false);
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/people" className={LINK_BACK}>← People</Link>

      {!editing ? (
        <div className="flex items-start justify-between gap-3 mb-4">
          <h1 className="font-bold text-white">{place.name}</h1>
          <button onClick={() => { setNameDraft(place.name); setNotesDraft(place.notes); setEditing(true); }}
            className="text-sm text-cyan-400 hover:text-cyan-300 min-h-[44px] px-2">Edit</button>
        </div>
      ) : (
        <div className="card p-4 mb-4">
          <label className="block text-sm text-slate-400 mb-1">Name</label>
          <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none min-h-[44px]" />
          <label className="block text-sm text-slate-400 mb-1 mt-3">Notes</label>
          <textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} rows={4}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none resize-none" />
          {error && <p className="text-sm text-red-400 mt-2" role="alert">{error}</p>}
          <div className="flex gap-2 mt-3">
            <button onClick={saveEdit} className={`${BUTTON_PRIMARY} py-2 px-5`}>Save</button>
            <button onClick={() => setEditing(false)} className={BUTTON_SECONDARY_CARD}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card p-2 mb-4">
        <MeetingMap markers={[marker]} className="h-48 w-full rounded-lg overflow-hidden" />
      </div>

      <section className="card p-5 mb-4">
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Met here</h2>
        {metHere.length === 0 ? (
          <p className="text-slate-400 text-sm">No meetings resolve to this place yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {metHere.map(({ person, count }) => (
              <Link key={person.id} href={`/people/${person.id}`}
                className="inline-flex items-center gap-1.5 bg-slate-800 border border-slate-700 rounded-full px-3 py-1 text-sm text-slate-200 hover:border-cyan-500/50 transition-colors">
                {person.name}<span className="text-slate-400">· {count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {place.notes && !editing && (
        <section className="card p-5 mb-4">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-2">Notes</h2>
          <p className="text-slate-300 text-sm whitespace-pre-wrap">{place.notes}</p>
        </section>
      )}

      <button onClick={() => setShowDelete(true)} className="text-sm text-red-400 hover:text-red-300 min-h-[44px] px-2">
        Delete this place
      </button>

      {showDelete && (
        <ConfirmDialog
          title={`Delete “${place.name}”?`}
          body="Meetings keep their locations; they just lose this name."
          confirmLabel="Delete"
          onConfirm={() => { if (deletePlace(id)) router.push("/people"); }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Create the error boundary**

Create `src/app/people/place/[id]/error.tsx` by copying `src/app/people/[id]/error.tsx` verbatim (same structure — it's route-generic). Read the existing file first and replicate it exactly at the new path.

- [ ] **Step 4: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint "src/app/people/place/[id]/page.tsx" "src/app/people/place/[id]/error.tsx" src/app/people/page.tsx`
Expected: clean. Resolve any `Meeting & { personId }` cast issues per the Step 1 note.

- [ ] **Step 5: Browser walkthrough**

In Places view: Add place → pick a coordinate (if the dev data has meetings with coords) or type manual lat/lng → name it → Create. Confirm the card appears with counts. Open it → confirm mini-map renders the pin, "Met here" lists people whose meetings fall within 200m, Edit renames/notes, Delete returns to People with the place gone and meetings intact. Screenshot the place page at 375px.

- [ ] **Step 6: Commit**

```bash
git add src/app/people/page.tsx "src/app/people/place/[id]/page.tsx" "src/app/people/place/[id]/error.tsx"
git commit -m "feat(places): add Places list view and place detail page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 10: Map view integration (named place markers + "Name this place")

**Files:**
- Modify: `src/components/MeetingMap.tsx` (accept a distinct `places` prop and an action callback)
- Modify: `src/app/people/page.tsx` (pass places to the Map view; wire "Name this place")
- Test: browser

**Interfaces:**
- `MeetingMap` gains optional props (backward compatible — existing callers unaffected):
  ```ts
  interface PlaceMarker { id: string; lat: number; lng: number; name: string; peopleLabel?: string }
  interface MeetingMapProps {
    markers: MapMarker[];
    places?: PlaceMarker[];         // rendered as labeled copper markers linking to /people/place/[id]
    onNameLocation?: (lat: number, lng: number, rawName?: string) => void; // adds a "Name this place" popup action to meeting markers
    className?: string;
  }
  ```

- [ ] **Step 1: Read the current MeetingMap**

Read `src/components/MeetingMap.tsx` fully. It builds `L.divIcon` markers from `markers` and binds popups. You'll add: (a) a second marker set for `places` with a distinct copper icon and a popup whose link goes to `/people/place/${id}`; (b) when `onNameLocation` is provided, append a button to each meeting marker's popup that calls it.

- [ ] **Step 2: Extend MeetingMap**

Add the types and render places. Leaflet popups are HTML strings; wire the "Name this place" button via an event delegation on `map` popupopen, since inline handlers in popup HTML can't call React closures directly. Concretely:

```ts
export interface PlaceMarker { id: string; lat: number; lng: number; name: string; peopleLabel?: string }

// in props:
places?: PlaceMarker[];
onNameLocation?: (lat: number, lng: number, rawName?: string) => void;
```

Inside the map-build effect, after adding meeting markers:

```ts
// Named places: copper pin + label, popup links to the place page.
const placeIcon = L.divIcon({
  className: "",
  html: `<div style="width:14px;height:14px;border-radius:4px;background:#b96d33;border:2px solid #14100d"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});
for (const pl of places ?? []) {
  const m = L.marker([pl.lat, pl.lng], { icon: placeIcon }).addTo(map);
  m.bindPopup(
    `<a href="/people/place/${esc(pl.id)}" style="color:#d99a5e;font-weight:600">${esc(pl.name)}</a>` +
    (pl.peopleLabel ? `<br><span style="color:#a89a88;font-size:12px">${esc(pl.peopleLabel)}</span>` : "")
  );
}
```

For "Name this place", when building each meeting marker's popup HTML, if `onNameLocation` is set append a button carrying data attributes, then handle clicks via one delegated listener:

```ts
// when building a meeting marker's popup content string, append:
// (only if onNameLocation provided)
const nameBtn = onNameLocation
  ? `<button data-name-loc="1" data-lat="${marker.lat}" data-lng="${marker.lng}" data-raw="${esc(marker.sublabel ?? "")}" style="margin-top:6px;color:#d99a5e;background:none;border:none;cursor:pointer;font-size:12px">Name this place</button>`
  : "";
// include nameBtn in the bindPopup HTML

// once, after creating the map:
map.on("popupopen", (e) => {
  const el = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>("[data-name-loc]");
  if (el && onNameLocation) {
    el.onclick = () => onNameLocation(parseFloat(el.dataset.lat!), parseFloat(el.dataset.lng!), el.dataset.raw || undefined);
  }
});
```

Add `places` and `onNameLocation` to the effect's dependency array. Keep the `markers.length === 0` early-return guard tolerant of places-only maps: change it to `if (!containerRef.current || (markers.length === 0 && (places?.length ?? 0) === 0)) return;`.

- [ ] **Step 3: Wire the People Map view**

In `src/app/people/page.tsx`, build place markers and pass them, plus the name-location handler that opens the AddPlacePanel prefilled. Simplest wiring: a state `prefillCoord` that, when set, switches to `places` view with the panel open and the coordinate seeded.

```ts
const placeMarkers = useMemo(
  () => places.map((pl) => {
    const s = placeStats.get(pl.id);
    return { id: pl.id, lat: pl.lat, lng: pl.lng, name: pl.name,
      peopleLabel: s ? `${s.people} ${s.people === 1 ? "person" : "people"} · ${s.meetings} meeting${s.meetings === 1 ? "" : "s"}` : undefined };
  }),
  [places, placeStats]
);
```

In the Map view render, pass the new props:

```tsx
{view === "map" && (
  <MeetingMap
    markers={mapMarkers}
    places={placeMarkers}
    onNameLocation={(lat, lng, raw) => { setPrefill({ lat, lng, raw }); setAddingPlace(true); setView("places"); }}
    className="h-[60vh] w-full rounded-xl overflow-hidden"
  />
)}
```

Add `const [prefill, setPrefill] = useState<{ lat: number; lng: number; raw?: string } | null>(null);` and pass `prefill` into `AddPlacePanel` as an optional initial coordinate (extend the panel's props with `initial?: { lat: number; lng: number; raw?: string }`, seed `coord`/`name` from it in `useState` initializers, and clear it in `onCreated`/`onCancel`).

- [ ] **Step 4: Typecheck, lint, build**

Run: `npx tsc --noEmit && npx eslint src/components/MeetingMap.tsx src/app/people/page.tsx && npx next build`
Expected: clean compile.

- [ ] **Step 5: Browser walkthrough**

In Map view with at least one place and one located meeting: confirm the copper place marker renders with its label popup linking to the place page; confirm a meeting marker's popup shows "Name this place", and clicking it switches to Places view with the Add panel open and the coordinate preselected. Create the place and confirm it now appears as a copper marker. Screenshot.

- [ ] **Step 6: Commit**

```bash
git add src/components/MeetingMap.tsx src/app/people/page.tsx
git commit -m "feat(places): render named places on the map with name-this-location action

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 11: "Where we've met" on the person page

**Files:**
- Modify: `src/app/people/[id]/page.tsx`
- Test: browser

**Interfaces:**
- Consumes: `groupMeetingsByPlace` from `@/lib/place-resolve`; `getPlaces` from `@/lib/places`.

- [ ] **Step 1: Render the section**

In `src/app/people/[id]/page.tsx`, import:

```ts
import { getPlaces } from "@/lib/places";
import { groupMeetingsByPlace } from "@/lib/place-resolve";
import Link from "next/link"; // if not already imported
```

Compute grouped meetings for this person (memoized on `person`):

```ts
const placeGroups = useMemo(
  () => (person ? groupMeetingsByPlace(person.meetings, getPlaces()) : []),
  [person]
);
```

Render a read-only section near the existing Meetings/map area:

```tsx
{placeGroups.length > 0 && (
  <section className="card p-5 mt-4">
    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">Where we’ve met</h2>
    <ul className="space-y-2">
      {placeGroups.map((g, i) => (
        <li key={g.place?.id ?? `raw-${i}`} className="flex items-center justify-between text-sm">
          {g.place ? (
            <Link href={`/people/place/${g.place.id}`} className="text-slate-200 hover:text-white transition-colors">
              {g.place.name}
            </Link>
          ) : (
            <span className="text-slate-300">{g.rawName}</span>
          )}
          <span className="text-slate-400">{g.meetings.length}×</span>
        </li>
      ))}
    </ul>
  </section>
)}
```

- [ ] **Step 2: Typecheck & lint**

Run: `npx tsc --noEmit && npx eslint "src/app/people/[id]/page.tsx"`
Expected: clean.

- [ ] **Step 3: Browser walkthrough**

On a person with located meetings, some snapping to a named place: confirm named places appear first (linking to the place page), raw Omi names after, each with a meeting count. Screenshot at 375px.

- [ ] **Step 4: Commit**

```bash
git add "src/app/people/[id]/page.tsx"
git commit -m "feat(places): add 'Where we've met' section to person page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 12: Full-feature verification & polish

**Files:** none new — verification pass.

- [ ] **Step 1: Full build**

Run: `npx tsc --noEmit && npx eslint src && npx next build`
Expected: all clean; every route compiles including `/people/place/[id]`.

- [ ] **Step 2: Design detector**

Run: `node /Users/ulyssescabayao/.agents/skills/impeccable/scripts/detect.mjs --json src/components/RelationshipEditor.tsx src/components/EgoWeb.tsx src/components/RelationshipGraph.tsx src/components/MeetingMap.tsx "src/app/people/place/[id]/page.tsx" src/app/people/page.tsx "src/app/people/[id]/page.tsx"`
Expected: `[]`. If it flags SVG type-encoding strokes or the copper node fill, verify each is a real pair and waive with an inline `// impeccable-disable-line` + measured note (matching the codebase convention), never a global disable.

- [ ] **Step 3: Sync round-trip check**

In the browser, add a relationship and a place, then in DevTools Application → Local Storage confirm `omi-relationships` and `omi-places` keys exist with the records. Confirm no console errors from `schedulePush` (it no-ops when the store isn't configured).

- [ ] **Step 4: Cross-cutting walkthrough at 375px (mobile) and desktop**

Verify end to end: create two people → link them (kin, with roles) → ego web shows on both → Web view shows the edge → merge a third person into one and confirm edges survive on the target (add a link to the third first) → delete a person and confirm their edges vanish from the Web view → create a place from a meeting pin → person's "Where we've met" links to it → delete the place and confirm meetings keep their raw names. Capture a mobile screenshot of the Web view and the place page.

- [ ] **Step 5: Final commit (if any waivers/polish were added)**

```bash
git add -A
git commit -m "chore(people): design-detector waivers and polish for relationships & places

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes (addressed)

- **Spec coverage:** typed+noted relationships (Task 3/5) ✓; symmetric with per-side roles (Task 3 `aRole`/`bRole`, `roleFor`) ✓; link existing-or-create-new on person page (Task 5) ✓; ego web (Task 6) ✓; whole-network Web view with type filter + tap-highlight-then-open (Task 8) ✓; stroke-not-color type encoding (Task 6 `REL_DASH`, reused Task 8) ✓; places CRUD (Tasks 2, 9) ✓; Places list + place pages (Task 9) ✓; map integration with named markers + "name this place" (Task 10) ✓; proximity snap at 200m, read-time, meetings never mutated (Task 4) ✓; "Where we've met" (Task 11) ✓; person delete/merge edge integrity (Task 3) ✓; quota-aware writes (Tasks 2, 3) ✓; sync registration (Tasks 2, 3) ✓; out-of-scope items excluded ✓.
- **Type consistency:** `Place`, `Relationship`, `RelationshipType`, `LatLng`, `PlaceGroup`, `LayoutEdge`, `REL_DASH`, `otherId`/`roleFor` signatures are defined once and consumed with matching shapes downstream. `distanceMeters(a,b)` used consistently. `computeLayout` signature matches its test and its Task 8 caller.
- **Placeholder scan:** clean — no TBDs, no "add error handling", every code step shows complete code. Task 5's `save()` shows the single correct role-orientation call.
