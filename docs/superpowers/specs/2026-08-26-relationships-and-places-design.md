# Relationships & Places — Design

**Date:** 2026-08-26
**Status:** Approved pending user review

## Goal

Under the People tab: (1) set and visualize typed relationships between people, linking new or existing persons to existing persons; (2) add/edit/delete named places and visualize where people were met.

## Decisions made during brainstorming

- Relationships are **typed + noted**: `kin | work | neighbor | introduced | other`, with an optional free-text note.
- Relationships are **symmetric with optional per-side roles** (e.g. "father" ↔ "daughter"): one stored record per pair, rendered from either side.
- Linking happens on the **person detail page** (search existing person or create-and-link a new one in one step).
- Visualization: **ego web on each person's page + whole-network Web view on the People tab**, with a grouped chip list as the text fallback.
- Places: **first-class Place records with a Places list view and per-place pages**, integrated into the existing Map view (named markers link to place pages). Meetings resolve to places by proximity at read time.

## Data model

Two new localStorage namespaces, mirroring `omi-people`'s patterns exactly: a map keyed by id, clipped string fields, last-write-wins `timestamp` per record, quota-aware `writeMap` (a failed write returns `null` from the mutator), and `schedulePush(ns)` for the Neon mirror. Both namespaces are registered in `sync.ts` alongside the existing ones.

### `src/lib/relationships.ts` — namespace `omi-relationships`

```ts
type RelationshipType = "kin" | "work" | "neighbor" | "introduced" | "other";

interface Relationship {
  id: string;
  aId: string;          // person id (unordered pair; a/b assignment is arbitrary but stable)
  bId: string;
  type: RelationshipType;
  aRole?: string;       // e.g. "father" — a's role relative to b
  bRole?: string;       // e.g. "daughter"
  note?: string;        // e.g. "leases her east pasture"
  createdAt: string;
  timestamp: string;    // last-write-wins sync key
}
```

Field bounds: roles ≤ 60 chars, note ≤ 500 chars (clipped at storage, matching `people.ts` conventions).

API surface: `getRelationships()`, `getRelationshipsFor(personId)`, `addRelationship(...)`, `updateRelationship(id, patch)`, `deleteRelationship(id)`, plus two integrity hooks called from `people.ts`:

- **Person delete** → delete all edges touching that person.
- **`mergePeople(source, target)`** → rewire edges from source to target; drop resulting self-links; when a source edge duplicates an existing target edge (same other-person), keep the target's edge and drop the source's.

At most one relationship per unordered pair: `addRelationship` on an existing pair updates that record instead of creating a second edge.

### `src/lib/places.ts` — namespace `omi-places`

```ts
interface Place {
  id: string;
  name: string;         // ≤ 120 chars
  lat: number;
  lng: number;
  notes: string;        // ≤ 5000 chars
  createdAt: string;
  timestamp: string;
}
```

**Meetings are never mutated.** A meeting belongs to a place purely by proximity, resolved at read time: nearest place within **200 m** wins (equirectangular approximation is fine at this radius). Exposed as `resolvePlace(lat, lng): Place | null` and `groupMeetingsByPlace(meetings)`. Consequences, all intentional:

- Places are retroactive over the entire existing meeting history with no migration.
- Deleting a place simply un-names its meetings (they fall back to their raw Omi `placeName`).
- Moving a place's pin re-resolves everything automatically.

API surface: `getPlaces()`, `getPlace(id)`, `createPlace(...)`, `updatePlace(id, patch)`, `deletePlace(id)`.

## UI

### Person page: Relationships section

Order within the section: ego web (when ≥1 link), grouped chip list, "Add relationship" control.

- **Chip list** (text fallback, always rendered): chips grouped under type labels; each chip shows the other person's name plus their role or the note ("Mae · daughter"). Tapping a chip navigates to that person. Each chip has an edit affordance opening the same panel as "Add relationship", pre-filled, with a Remove action (confirm not required — a relationship is one tap to re-add and carries little data).
- **Add relationship panel** (inline, `enter-rise`, not a modal): a search field over existing people using `normalize`/`matchPerson`; when no match, the first option is "Create '<typed name>' and link" (creates via `createPerson`, then links). A 5-way type picker (segmented, reusing the filter-pill pattern). Role fields (two inputs, "their role / my role" phrasing per side) appear for `kin` and `introduced`; the note field is always available. Primary action uses `BUTTON_PRIMARY`; this is the section's one primary action.

### Person page: ego web

An inline SVG: the viewed person as the center node (copper fill, near-black label per the existing active-fill rule), linked people spaced on a circle around them, one edge each with a mid-edge type/role label. Tapping a neighbor node navigates to that person's page (the web re-centers there). Pure trigonometry — no layout library. Above ~12 links, neighbors wrap onto a second, larger ring. Hidden when the person has no relationships.

### People tab: Web view

The view toggle becomes **Grid | Web | Map | Places** (same segmented control, icon + label; labels may drop to icons-only below `sm` if the row would wrap).

- Draws every person with ≥1 relationship as a node network; unlinked people are simply absent (an empty state explains how to link people when no relationships exist yet).
- Layout: a small hand-rolled force simulation (pairwise repulsion + spring edges + weak centering, ~150 iterations precomputed on data change, then static). No physics dependency.
- Interaction: drag to pan and pinch/wheel to zoom via the SVG `viewBox`; first tap on a node highlights it and its edges (others dim); second tap opens the person. Filter chips (All + the 5 types) show only edges of that type and the nodes they touch.
- **Type encoding is stroke style + label, not color**: solid (kin), dashed (work), long-dash (neighbor), dotted (introduced), faint solid (other), with the edge label carrying the word. DESIGN.md reserves sage and amber for single purposes and the One Ink Rule bars new accent hues; copper marks only the highlighted node. Node fills stay Ink Panel with graphite strokes.

### People tab: Places view

A stacked list of place cards: name (serif title), meeting count, distinct-people count, and a one-line notes preview. An "Add place" action opens a create panel: name, notes, and a pin picker — a list of recent distinct meeting coordinates (labeled with their raw Omi place names) to choose from, or manual lat/lng entry. Empty state explains that places name the locations already attached to meetings.

### Place page: `/people/place/[id]`

Mirrors the person-page pattern: back link (`LINK_BACK`), serif `h1`, then:

- Mini-map (existing `MeetingMap` component, single marker).
- "Met here": person chips with per-person meeting counts, tapping through to the person.
- Notes (inline edit, same interaction as person notes).
- Edit (rename, move pin by picking another meeting coordinate or manual entry, notes) and Delete. Delete uses `ConfirmDialog` and states the consequence: "Meetings keep their locations; they just lose this name."

### Map view integration

Named places render as labeled copper markers whose popups link to the place page. Meetings that resolve to a place are absorbed into that place's marker (its popup lists the people); unresolved meetings keep their current individual pins, whose popups gain a "Name this place" action that opens the place-create panel pre-filled with that coordinate and Omi place name.

### Person page: "Where we've met"

A list grouped through the same `groupMeetingsByPlace` resolution: named places first (with counts, linking to place pages), then unresolved locations under their raw Omi names. Read-only here — place CRUD lives on place pages.

## Error handling

- All writes use the existing quota-aware `writeMap` contract: `false` → the mutator returns `null` → the UI surfaces the failure (same convention as people edits today).
- Relationship records referencing a person id that no longer exists (possible only via a sync race) are skipped at read time and garbage-collected on the next write.
- The Web view guards against degenerate layouts (all nodes at one point) by seeding positions on a circle.

## Testing & verification

No test runner exists in the repo and this feature doesn't justify introducing one. Verification is: `tsc --noEmit`, `eslint`, `next build`, and a browser walkthrough covering — add/edit/remove a relationship (existing and create-and-link), person merge with edges on both sides, ego web navigation, Web view filtering and zoom on phone width, place create/rename/move-pin/delete, snap resolution against real meeting history, and sync round-trip of both new namespaces.

## Out of scope (deliberate)

- AI extraction of relationships from conversation transcripts (could be a later review-queue extension).
- Place categories/kinds — notes carry that nuance.
- Directed edges beyond per-side roles.
- Linking from the graph view or the review queue.
