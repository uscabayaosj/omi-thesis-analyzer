# Full-Text Search — Thesis & Group Analyses — Design Spec (2026-08-24)

## Purpose

Finding a specific piece of evidence today means scrolling through
conversations by day. This adds a search over everything the thesis lens has
already produced — the 8 per-conversation dimensions and the 5 group-analysis
dimensions — so the user can find "every conversation touching water rights"
in one query instead of by memory.

## Approved decisions

- **Scope: analyses only, not transcripts.** Transcripts aren't stored
  durably today (fetched live from Omi, cached client-side as disposable —
  see `src/lib/kv.ts`'s comment on `SYNCED_NAMESPACES`); mirroring them to
  Neon would be a separate, larger effort. Out of scope for this feature.
- **Scope: thesis lens only, not ADHD Aid.** The two lenses stay
  independent per the app's product principles — this is a thesis-evidence
  tool, not a general search over everything the user has ever recorded.
- **Match mechanism: JS-side substring scan, not SQL `ILIKE`.** Both source
  namespaces (`omi-thesis-analyses`, `omi-thesis-group-analyses`) are
  mirrored to Neon as whole-document JSONB blobs (one row per namespace, not
  one row per analysis) — the existing `putNamespaceData`/`getNamespaceData`
  pattern in `src/lib/kv.ts`. Real `ILIKE` needs queryable rows; restructuring
  storage to get there is a much bigger change than this feature warrants at
  a single-user, personal-corpus scale. The API route reads the whole
  document (already how every other route reads these namespaces) and does
  a case-insensitive substring match in Node — functionally equivalent to
  `ILIKE '%term%'` at this data volume, with no schema change and no new
  index to maintain.
- **UI: a new dedicated `/search` page**, not an extension of the home
  page's existing search box (which filters conversation *titles* only,
  client-side, and is a different feature entirely — confirmed by reading
  `src/app/page.tsx`'s `searchQuery` logic).
- **Group results reuse the existing group-analysis page**, not a new
  detail view. `src/app/analyze-group/page.tsx` already resolves a
  `?ids=<comma-separated-ids>` query param against its stored groups (sorted
  by the same `groupKey()` function already in that file) and shows the
  existing cached result if found, rather than re-running the analysis —
  confirmed by reading the page's `idsParam`/`groupKey` logic. A search
  result for a group links straight to that URL; no new lookup-by-id route
  is needed.
- **Out of scope:** relevance ranking/stemming (plain substring match only),
  search history, saved searches, pagination (a personal corpus is small
  enough that a single results page is fine).

## Data read

- `omi-thesis-analyses`: a map, `Record<conversationId, StoredAnalysis>`
  (see `src/lib/storage.ts`'s `StoredAnalysis` interface — 8 RQ/dimension
  fields, plus optional `custom.result`, plus `title`/`date`/`timestamp`).
- `omi-thesis-group-analyses`: an **array** of `StoredGroupAnalysis` (not a
  map — confirmed from `src/app/analyze-group/page.tsx`'s `getStoredGroupAnalyses`),
  each with 5 `GroupAnalysis` fields, optional `custom.result`,
  `conversationIds`, `conversations` (title/date/emoji per member), and
  `timestamp`.

Both are read via the existing `getNamespaceData(sql, namespace)` from
`src/lib/kv.ts` — no new storage/schema work.

## Field labels

Reuse the same friendly labels already shown in the UI, so a search result
reads the same way the source page does:

Thesis (from `src/components/ThesisResults.tsx`):
`rq1_documentary_record` → "RQ1 — Documentary Record",
`rq2_everyday_practices` → "RQ2 — Everyday Practices",
`rq3_cskt_intersection` → "RQ3 — CSKT Intersection",
`rq4_wildness_imaginary` → "RQ4 — Wildness Imaginary",
`conditions_check` → "Orienting Conditions",
`rival_hypothesis_test` → "Rival Hypothesis Test",
`refutation_signals` → "Refutation Signals",
`forward_thinking` → "Forward Thinking",
`custom.result` → "Custom Question".

Group (from `src/app/analyze-group/page.tsx`'s field usage):
`cross_conversation_themes` → "Cross-Conversation Themes",
`contradictions_and_tensions` → "Contradictions & Tensions",
`evolution_and_patterns` → "Evolution & Patterns",
`synthesis` → "Synthesis",
`forward_thinking` → "Forward Thinking",
`custom.result` → "Custom Question".

## API

`GET /api/search?q=<term>`:

- Trims `q`; if empty, returns `{ configured: true, conversationResults: [], groupResults: [] }` immediately (no scan).
- If the Neon store isn't configured, returns `{ configured: false, conversationResults: [], groupResults: [] }` (HTTP 200, matching every other store-backed route's degrade posture).
- For each `StoredAnalysis` in the `omi-thesis-analyses` map: scan each of the 8 fields (+ `custom.result` if present) case-insensitively for `q`. For every field that matches, record `{ field: <internal key>, label: <friendly label>, snippet: <~120 chars centered on the first match> }`.
- If any field matched, emit one `ConversationSearchResult`: `{ conversationId, title, date, matches: SearchMatch[] }`.
- Same process for each `StoredGroupAnalysis` in the `omi-thesis-group-analyses` array, emitting `GroupSearchResult`: `{ conversationIds, conversationTitles, timestamp, matches: SearchMatch[] }` (`conversationIds` pre-sorted, matching the format `/analyze-group?ids=` already expects via `groupKey()`).
- Both result arrays sorted by match count descending, then by date/timestamp descending.
- No pagination or result cap — personal-corpus scale.

## UI

New page `src/app/search/page.tsx`:

- A single text input (debounced client-side, e.g. 300ms, before firing the
  request — avoids a request per keystroke) plus a "Search" affordance for
  immediate submission.
- Two sections, "Conversations" and "Groups", each rendering its results:
  title/date (or conversation list, for a group), and the matched field
  labels with their snippets underneath.
- A conversation result is a link to `/conversation/[id]`.
- A group result is a link to `/analyze-group?ids=<sorted,comma,separated,ids>`.
- Empty state before any query, no-results state after a query with zero
  matches, and the same not-configured message pattern used on `/usage`
  when `configured: false`.
- A nav link added to the home page alongside the existing Rollup/People/Usage links.
