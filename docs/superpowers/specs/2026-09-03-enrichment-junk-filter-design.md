# Enrichment Pass + Junk Filter — Design

**Date:** 2026-09-03
**Context:** Omi commit `3c998bf` (issue #7690) gates Omi-paid LLM post-processing for
custom-STT users. Once TRACE's user switches to a Deepgram BYOK key, conversations will
arrive from the Omi API with transcripts but no `structured.title`/`overview`, and
without Omi's discard detection — so every noise fragment (a cough, background TV)
arrives as a "completed" conversation. TRACE takes over both jobs.

## Goals

1. **Enrichment pass** — TRACE generates its own title + short overview per
   conversation, once, cached, on the user's OpenAI key.
2. **Junk filter** — noise recordings are detected and collapsed out of the home
   list, reversibly. Nothing vanishes silently.

Non-goals: replacing the thesis/ADHD lenses (they already exist), auto-enrichment on
page load (the repo just removed a write-on-load; LLM spend stays behind an explicit
user action), touching the Omi ingestion path.

## Architecture

Follows the established lens pattern exactly: prompt/types lib + API route +
localStorage map storage + synced namespace.

### 1. `src/lib/enrich.ts` — prompt + coercion

- `export interface Enrichment { junk: boolean; junk_reason: string; title: string; overview: string }`
- `enrichConversation(transcript, date): Promise<Enrichment>` — one
  `chatCompletion` call (JSON mode, usage label `"enrich"`). The prompt asks for:
  - `junk`: true when the transcript is noise — fragments with no recoverable
    subject matter (TV/radio/background speech, a few stray words, STT garbage).
    A short but real exchange is NOT junk.
  - `junk_reason`: one short clause when junk, else "".
  - `title`: ≤ 8 words, concrete, names the actual subject ("Fence repair plan
    with Dale", not "A conversation about ranching").
  - `overview`: 1–2 plain sentences.
- `countTranscriptWords(segments): number` — whitespace word count across segments.
- `JUNK_WORD_FLOOR = 25` — below this, junk without an LLM call.
- `toEnrichment(raw): Enrichment` — coercion that never throws, mirroring
  `toAdhdAnalysis` (missing fields → safe defaults; junk defaults to `false` so a
  malformed reply can only over-show, never hide a real conversation).

### 2. `src/app/api/enrich/route.ts` — the pass

`POST { conversationId }`, mirroring `analyze-adhd/route.ts`:

1. Fetch conversation with transcript (`getConversation`).
2. No transcript segments → 404 (same message pattern as analyze-adhd).
3. `wordCount < JUNK_WORD_FLOOR` → return
   `{ junk: true, junk_reason: "Too short to carry content", title: "", overview: "", wordCount }`
   — **no LLM call**.
4. Else `enrichConversation(...)` → return `{ ...enrichment, wordCount }`.

The route is stateless; the client stores the result (storage is client-owned in
this app — localStorage first, mirrored to Neon by the existing sync layer).

### 3. `src/lib/enrich-storage.ts` — storage

localStorage map `omi-enrichments`, keyed by conversationId:

```ts
interface StoredEnrichment {
  conversationId: string;
  timestamp: string;      // when produced; merge clock for the record
  wordCount: number;
  junk: boolean;          // heuristic or model verdict
  junkReason?: string;
  title?: string;         // absent for heuristic-junk records
  overview?: string;
  keep?: boolean;         // user override: show despite junk verdict
  keepUpdatedAt?: string; // its own clock (same reasoning as doneKeysUpdatedAt)
}
```

API mirrors `adhd-storage.ts`: `getEnrichment(id)`, `getEnrichments(): Map`,
`saveEnrichment(record)`, `toggleKeep(id)`. Reuses the same
`readMap`/`writeMap` quota-pruning helpers (exported from adhd-storage or
extracted — extraction preferred so neither file reaches into the other's
internals).

`omi-enrichments` is added to `SYNCED_NAMESPACES` in `kv.ts`. It's a keyed map
with per-record `timestamp`, so the generic `mergeMaps` merge works unchanged.
The `keep` flag needs its own clock so an override wins a cross-device merge —
handled the same way `doneKeysUpdatedAt` is (see `merge.ts` `resolveDoneFields`;
extend or mirror for `keepUpdatedAt`).

### 4. Home list integration (`src/app/page.tsx`)

- **Title chain** in `conversationTitle`: Omi title → enrichment title → ADHD
  gist → timestamp·category. (Enrichment before gist: it's a purpose-built name;
  the gist is a summary pressed into service.)
- **Overview fallback**: rows render `structured.overview`, else enrichment
  overview.
- **Search** (`title.includes(q)`…) also matches enrichment title + overview.
- **"Name new (n)" batch button**: shown when ≥ 1 visible conversation lacks an
  enrichment record. Runs `/api/enrich` sequentially over unenriched
  conversations (same loop shape as the ADHD batch, including per-item failure
  collection), saving each result. Junk-by-floor results cost nothing.
- **Ignored section**: conversations whose enrichment says `junk && !keep`
  are removed from the main list and collapsed into an "Ignored (n)"
  disclosure at the bottom. Each row shows the junk reason + word count, still
  links to the conversation page, and has a **Keep** button that flips the
  override (reversible both ways). Conversations with *no* enrichment record are
  always shown normally — absence of a verdict is not a verdict.

### 5. Conversation detail page

Title fallback only: where the page names the conversation, apply the same
chain (Omi → enrichment → fallback). No enrichment trigger on the detail page
in this iteration.

## Error handling

- Route errors go through the existing `friendlyError` mapping.
- Batch loop collects per-conversation failures and reports titles, same as the
  ADHD batch.
- Malformed LLM JSON → `extractJsonObject` throws → route 500s → row simply
  stays unenriched (retryable); coercion means a *parseable but wrong-shaped*
  reply degrades to non-junk with fallback strings.

## Testing

`test/enrich.test.mts` (node:test, matching existing tests):

- `countTranscriptWords`: empty segments, multi-segment, whitespace runs.
- Floor semantics: 24 words junk, 25 not (boundary pinned).
- `toEnrichment`: full valid object; missing/wrong-typed fields → defaults;
  junk defaults to false on garbage.
- Merge: a `keep` override with a newer `keepUpdatedAt` survives merging with a
  remote record that has a newer `timestamp` (guards the cross-device revert).

Manual verification via dev server: batch-name a page of conversations, confirm
titles/overviews render, junk collapses, Keep restores, search matches enriched
titles.

## Cost

One small JSON call per real conversation, once ever (cached by conversation id;
re-runs only if the user re-triggers). Heuristic junk costs zero. Logged under
the `"enrich"` label so the usage page itemizes it.
