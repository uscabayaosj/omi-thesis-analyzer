# People Directory — Design Spec (2026-08-23)

## Purpose

The user has difficulty remembering names. This feature automatically extracts
the names of people met/talked to (and where) from Omi conversation recordings,
and maintains a persistent, editable directory of person cards that grows and
updates from past and future conversations. It is a memory prosthetic in the
same spirit as the ADHD Aid lens, but lens-independent.

## Approved decisions

- **Photos:** client-side downscale to ~256px, stored as base64 in the existing
  localStorage + Neon JSONB mirror. No new blob infrastructure.
- **Extraction:** a dedicated lightweight LLM pass (`/api/extract-people`),
  independent of the two analysis lenses; ADHD-lens `people` output is also fed
  into the same suggestion pipeline when present.
- **Auto-run:** extraction runs automatically after either lens analyzes a
  conversation, plus a manual "Scan for people" button per conversation and a
  backfill action in the People tab. No server-side cron involvement.
- **Identity matching:** all extraction results become pending suggestions;
  nothing appends or merges without an explicit user tap (review queue).
- **Maps:** Leaflet + OpenStreetMap tiles for visualizing meeting locations.

## Data model

Two new synced namespaces in the existing KV store (extend `SYNCED_NAMESPACES`):

`people` — map of `Person`:

```ts
interface Person {
  id: string;                 // uuid
  name: string;               // canonical display name
  aliases: string[];          // alternative names/spellings resolving here
  photo?: string;             // base64 data URL, ~256px max dimension
  role?: string;              // short descriptor, user-editable
  notes: string;              // user-editable free text
  facts: PersonFact[];        // auto-derived details, each sourced
  meetings: Meeting[];        // encounters
  createdAt: string;
  updatedAt: string;
}
interface PersonFact { text: string; conversationId: string; date: string; }
interface Meeting {
  conversationId: string;
  date: string;               // conversation created_at
  placeName?: string;         // LLM-extracted from transcript
  lat?: number; lng?: number; // from Omi conversation geolocation
}
```

`people_pending` — map of `PendingSuggestion`:

```ts
interface PendingSuggestion {
  id: string;
  conversationId: string;
  date: string;
  extractedName: string;
  details: string[];          // candidate facts
  placeName?: string;
  lat?: number; lng?: number;
  matchedPersonId?: string;   // confident match, pre-linked
  candidates?: string[];      // ambiguous: person ids to choose among
}
```

Plus an ignore list (rejected names, stored inside the `people` namespace
metadata or a small key) so rejected names are not re-suggested.

## Geolocation

- Add `geolocation?: { latitude: number; longitude: number; address?: string;
  location_name?: string; google_place_id?: string }` to the `Conversation`
  interface in `src/lib/omi-api.ts`; pass it through the conversation fetch
  routes. Field shape verified against actual Omi API responses during
  implementation (tolerant parsing — missing geolocation is normal).
- Each meeting records the conversation's lat/lng when available; `placeName`
  comes from the transcript ("at the Ronan feed store") or Omi's address.

## Extraction pipeline

1. `POST /api/extract-people` — body: `{ conversationId }` or inline transcript.
   Server fetches transcript (reusing `omi-api.ts`), calls GPT-5.6-luna with a
   small dedicated prompt returning strict JSON:
   `{ people: [{ name, details: string[], place?: string }] }`.
   Tolerant parsing in the style of `adhd.ts`. Excludes the user themself.
2. Client-side, after either lens completes (and on manual scan/backfill), the
   result plus the conversation's geolocation flows into the **matcher**.
3. Matcher scores each extracted name against existing people (names + aliases):
   exact / case- and diacritic-insensitive / first-name-only / small edit
   distance. Outcomes: confident match (pre-linked), ambiguous (candidate list),
   or new person. All become `people_pending` entries; duplicates of an already-
   pending suggestion for the same conversation are collapsed.
4. Review queue UI: accept (append facts + meeting, or create person),
   reassign to a different person, or reject (adds to ignore list).
5. ADHD-lens `people` output for a conversation is converted into suggestions
   through the same matcher, deduplicated against LLM-extraction results.

Extraction failure is non-fatal: analysis still succeeds; a quiet retry
affordance appears on the conversation page.

## UI

- **/people** — new top-level "People" tab in the existing nav. Searchable card
  grid: photo (or initials avatar), name, role, last-met place + date. Banner
  when review-queue suggestions are pending. Toggle between grid and a Leaflet
  **map view** (marker per person at last-met location, popup → card).
  Backfill action: scan recent conversations that have never been extracted.
- **/people/[id]** — detail view: photo upload (file input, client-side canvas
  downscale to ~256px JPEG base64), inline editing of name/role/notes/aliases,
  facts list with source links to `/conversation/[id]`, meeting history, and a
  Leaflet map of that person's meetings (markers with date/place popups).
  "Merge into another person" action (moves facts/meetings/aliases, deletes the
  duplicate, with ConfirmDialog). Delete person (ConfirmDialog).
- Review queue lives on /people (and a compact prompt on the conversation page
  after extraction).
- Styling follows the existing dark, calm, low-cognitive-load treatment; touch
  targets and focus states per the existing globals.

## Leaflet specifics

- Add `leaflet` (+ `@types/leaflet`) dependency; CSS imported in the map
  component. Client-only component (`dynamic`/lazy — Leaflet touches `window`).
- OpenStreetMap tile layer with standard attribution. Offline: map simply fails
  to load tiles; card content remains fully usable.

## Sync & durability

`people` and `people_pending` join the existing namespace sync in
`src/lib/sync.ts` / `/api/store` exactly like the four current namespaces:
localStorage is the synchronous source of truth, Neon mirror adds cross-device
continuity, store-down degrades silently. Photo size is bounded by the
downscale; writes go through the existing quota-guarded storage helpers.

## Error handling

- Extraction/LLM errors: non-fatal, retryable, never block lens analysis.
- Missing geolocation: meeting recorded without coordinates.
- Photo too large / unreadable: friendly inline error, card unchanged.
- Store down: localStorage-only, as elsewhere.

## Testing / verification

No automated test harness exists in this repo. Verification = `npm run lint`,
`next build`, and driving the full flow in the browser preview: extract →
review queue → approve/reassign/reject → card updates → photo upload → map
renders → merge → delete. The matcher's scoring function is written as a pure
function in `src/lib/people.ts` so it can be unit-tested later if a harness is
added.

## Out of scope

- Face recognition or photo-based matching.
- Automatic merging without user approval.
- Server-side/cron extraction.
- Multi-user considerations (single-user by construction, per PRODUCT.md).
