# Enrichment Pass + Junk Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** TRACE generates its own conversation titles/overviews (one cached LLM call each) and collapses noise recordings out of the home list, reversibly — replacing the Omi post-processing that disappears under custom STT (BasedHardware/omi#7690).

**Architecture:** Follows the existing lens pattern exactly: a prompt/coercion lib (`enrich.ts`, like `adhd.ts`), a stateless API route (`api/enrich`, like `api/analyze-adhd`), a client-owned localStorage map (`enrich-storage.ts`, like `adhd-storage.ts`) mirrored to Neon via the existing generic sync. Junk detection is two-tier: a word-count floor server-side (free), else the LLM's verdict returned with the title.

**Tech Stack:** Next.js 15 App Router, TypeScript, node:test (`npm test` runs `node --test "test/**/*.test.mts"` — node executes `.ts` imports via type stripping), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-03-enrichment-junk-filter-design.md`.
- No LLM calls on page load — enrichment runs only from the explicit "Name new (n)" button.
- `JUNK_WORD_FLOOR = 25` words; below it, junk is decided without an LLM call.
- Token efficiency is a first-class constraint: one enrich call per conversation ever (cached by id); the unnamed set excludes anything already named by an Omi title **or an ADHD gist**; enrich input is clamped to `ENRICH_CLAMP_CHARS = 4000` characters.
- A conversation with **no** enrichment record always renders normally (absence of a verdict is not a verdict); a malformed LLM reply coerces to `junk: false` (over-show, never hide).
- Usage label for the LLM call: `"enrich"`.
- localStorage namespace: `"omi-enrichments"`, added to `SYNCED_NAMESPACES`.
- UI copy follows the app's plain-language voice (no "processed", "classified"; say "Named", "Ignored", "Keep").
- Commit after every task; run `npm test` and `npx tsc --noEmit` before each commit.

---

### Task 1: Extract the generic localStorage map helpers

`adhd-storage.ts` owns `readMap`/`writeMap` (with quota-pruning retry). `enrich-storage.ts` needs the same helpers; duplicate quota code is worse than a small extraction.

**Files:**
- Create: `src/lib/map-storage.ts`
- Modify: `src/lib/adhd-storage.ts` (delete its local `readMap`/`writeMapOnce`/`writeMap`, import instead)

**Interfaces:**
- Produces: `readMap<T>(key: string): Record<string, T>` and `writeMap<T>(key: string, map: Record<string, T>, afterWrite?: (map: Record<string, T>) => void): void`. `afterWrite` runs after every **successful** localStorage write (including the pruned retry) — it carries adhd-storage's badge sync.

- [ ] **Step 1: Create `src/lib/map-storage.ts`**

Move the three functions from `adhd-storage.ts:57-108` verbatim, with two changes: `writeMapOnce`/`writeMap` gain the `afterWrite` parameter, and the `key === ANALYSES_KEY` badge special-case is removed (it becomes the caller's `afterWrite`).

```ts
"use client";

import { schedulePush } from "./sync";
import { isSyncedNamespace } from "./kv";

/**
 * Generic keyed-map localStorage persistence with sync mirroring and
 * quota-pruning, extracted from adhd-storage so every namespace store
 * shares one implementation instead of re-deriving the quota dance.
 */

export function readMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, T> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        result[k] = v as T;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeMapOnce<T>(
  key: string,
  map: Record<string, T>,
  afterWrite?: (map: Record<string, T>) => void
): void {
  localStorage.setItem(key, JSON.stringify(map));
  // Mirror to the durable store so the other device sees it. Debounced and
  // fire-and-forget — localStorage already holds the write.
  if (isSyncedNamespace(key)) schedulePush(key);
  afterWrite?.(map);
}

export function writeMap<T>(
  key: string,
  map: Record<string, T>,
  afterWrite?: (map: Record<string, T>) => void
): void {
  try {
    writeMapOnce(key, map, afterWrite);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      // Drop the oldest half of entries (by timestamp) and retry once, rather
      // than silently losing the record the user just paid to produce.
      const entries = Object.entries(map) as [string, T & { timestamp?: string }][];
      entries.sort((a, b) => (a[1].timestamp ?? "").localeCompare(b[1].timestamp ?? ""));
      const keep = entries.slice(Math.ceil(entries.length / 2));
      const pruned = Object.fromEntries(keep) as Record<string, T>;
      try {
        writeMapOnce(key, pruned, afterWrite);
        console.error(`localStorage quota exceeded writing ${key}; pruned oldest entries to fit`);
      } catch {
        console.error(`localStorage quota exceeded writing ${key} even after pruning — write lost`);
      }
    } else {
      console.error(`localStorage write failed for ${key}`, e);
    }
  }
}
```

- [ ] **Step 2: Refactor `adhd-storage.ts` to use it**

Delete its `readMap`, `writeMapOnce`, `writeMap` (lines 57–108) and the now-unused `schedulePush`/`isSyncedNamespace` imports. Add:

```ts
import { readMap, writeMap as writeMapGeneric } from "./map-storage";
```

and a local wrapper that preserves the badge behavior (keeps every existing call site unchanged):

```ts
/** Badge sync rides on ANALYSES_KEY writes only — everything else is a plain write. */
function writeMap<T>(key: string, map: Record<string, T>): void {
  writeMapGeneric(key, map, key === ANALYSES_KEY
    ? (m) => syncAppBadge(Object.values(m) as unknown as StoredAdhdAnalysis[])
    : undefined);
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npx eslint src/lib/map-storage.ts src/lib/adhd-storage.ts`
Expected: clean; existing tests pass (they don't touch storage).

- [ ] **Step 4: Commit**

```bash
git add src/lib/map-storage.ts src/lib/adhd-storage.ts
git commit -m "refactor(storage): extract generic localStorage map helpers"
```

---

### Task 2: `enrich.ts` — word count, floor, coercion (TDD)

**Files:**
- Create: `src/lib/enrich.ts`
- Test: `test/enrich.test.mts`

**Interfaces:**
- Consumes: `TranscriptSegment` from `./omi-api`; `chatCompletion`, `clampTranscript`, `extractJsonObject` from `./analysis`.
- Produces:
  - `interface Enrichment { junk: boolean; junk_reason: string; title: string; overview: string }`
  - `JUNK_WORD_FLOOR = 25`
  - `ENRICH_CLAMP_CHARS = 4000`
  - `countTranscriptWords(segments: TranscriptSegment[]): number`
  - `toEnrichment(raw: Record<string, unknown>): Enrichment`
  - `enrichConversation(transcript: string, date: string): Promise<Enrichment>`

- [ ] **Step 1: Write the failing tests**

Create `test/enrich.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { countTranscriptWords, toEnrichment, JUNK_WORD_FLOOR } from "../src/lib/enrich.ts";

test("countTranscriptWords sums words across segments", () => {
  assert.equal(countTranscriptWords([]), 0);
  assert.equal(countTranscriptWords([{ text: "hello there" }, { text: "ok" }]), 3);
});

test("countTranscriptWords ignores whitespace runs and empty segments", () => {
  assert.equal(countTranscriptWords([{ text: "  a\n b\tc  " }, { text: "   " }, { text: "" }]), 3);
});

// The floor is a contract with the enrich route: strictly-below is junk-for-free,
// at-or-above goes to the model. Pin the boundary so a refactor can't shift it.
test("the junk floor boundary is exact", () => {
  const words = (n: number) => [{ text: Array.from({ length: n }, (_, i) => `w${i}`).join(" ") }];
  assert.equal(countTranscriptWords(words(JUNK_WORD_FLOOR - 1)) < JUNK_WORD_FLOOR, true);
  assert.equal(countTranscriptWords(words(JUNK_WORD_FLOOR)) < JUNK_WORD_FLOOR, false);
});

test("toEnrichment passes a well-formed reply through", () => {
  assert.deepEqual(
    toEnrichment({ junk: true, junk_reason: "background TV", title: "t", overview: "o" }),
    { junk: true, junk_reason: "background TV", title: "t", overview: "o" }
  );
});

test("toEnrichment defaults junk to false on garbage — over-show, never hide", () => {
  assert.deepEqual(toEnrichment({}), { junk: false, junk_reason: "", title: "", overview: "" });
  assert.equal(toEnrichment({ junk: "yes" }).junk, false); // wrong type is not a verdict
  assert.equal(toEnrichment({ junk: true, junk_reason: 3 }).junk_reason, "");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot find module `../src/lib/enrich.ts`.

- [ ] **Step 3: Implement `src/lib/enrich.ts`**

```ts
import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";
import type { TranscriptSegment } from "./omi-api";

/**
 * The enrichment pass — TRACE's replacement for the Omi post-processing that
 * custom-STT conversations no longer receive (BasedHardware/omi#7690): a
 * title, a short overview, and a junk verdict, produced once per conversation
 * and cached by the caller.
 */

export interface Enrichment {
  /** True when the recording is noise with no recoverable subject matter. */
  junk: boolean;
  junk_reason: string;
  title: string;
  overview: string;
}

/** Below this many transcript words a recording is junk by definition and the
 *  route answers without spending an LLM call. Strictly-below is junk. */
export const JUNK_WORD_FLOOR = 25;

/** A name doesn't need the whole conversation. Input tokens are this feature's
 *  entire cost, so the pass reads only the opening — enough to name, summarize,
 *  and junk-classify (real junk is short; anything long enough to truncate here
 *  is by definition not junk). */
export const ENRICH_CLAMP_CHARS = 4000;

export function countTranscriptWords(segments: TranscriptSegment[]): number {
  let n = 0;
  for (const s of segments) {
    const t = s.text?.trim();
    if (t) n += t.split(/\s+/).length;
  }
  return n;
}

/** Never throws. `junk` must be literally `true` to count: a malformed reply
 *  can only over-show a conversation, never hide one. */
export function toEnrichment(raw: Record<string, unknown>): Enrichment {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return {
    junk: raw.junk === true,
    junk_reason: str(raw.junk_reason),
    title: str(raw.title),
    overview: str(raw.overview),
  };
}

const ENRICH_SYSTEM_PROMPT = `You name conversations captured by a wearable microphone. The transcript comes from speech-to-text and may have errors and imperfect speaker labels.

You MUST respond with valid JSON matching this exact schema:
{
  "junk": boolean,
  "junk_reason": "one short clause when junk is true, else \\"\\"",
  "title": "at most 8 words",
  "overview": "1-2 plain sentences"
}

Rules:
- junk is true ONLY when the recording is noise with no recoverable subject matter: TV/radio/background speech not involving the wearer, a few stray words, or speech-to-text garbage. A short but real exchange is NOT junk.
- title names the actual subject, concretely: "Fence repair plan with Dale", not "A conversation about ranching". No quotation marks, no trailing period.
- overview is 1-2 plain sentences on what was discussed and decided, written the way a trusted friend would describe it. No corporate language.
- When junk is true, still fill title and overview with your best short description of what the noise was.`;

export async function enrichConversation(transcript: string, date: string): Promise<Enrichment> {
  const content = await chatCompletion(
    [
      { role: "system", content: ENRICH_SYSTEM_PROMPT },
      { role: "user", content: `Conversation date: ${date}\n\nTranscript (may be truncated):\n${clampTranscript(transcript, ENRICH_CLAMP_CHARS)}` },
    ],
    true,
    "enrich"
  );
  return toEnrichment(extractJsonObject(content));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all new tests; existing tests unaffected).

- [ ] **Step 5: Commit**

```bash
git add src/lib/enrich.ts test/enrich.test.mts
git commit -m "feat(enrich): title/overview/junk pass — types, floor, prompt"
```

---

### Task 3: `keep` override survives the cross-device merge (TDD)

**Files:**
- Modify: `src/lib/merge.ts:54-58` (the `DONE_FIELDS` table)
- Test: `test/enrich.test.mts` (append)

**Interfaces:**
- Consumes: `mergeMaps` from `../src/lib/merge.ts`.
- Produces: merge behavior only — `keep`/`keepUpdatedAt` fields resolved by their own clock, like `doneKeys`.

- [ ] **Step 1: Write the failing test** (append to `test/enrich.test.mts`)

```ts
import { mergeMaps } from "../src/lib/merge.ts";

// A junk verdict re-produced on another device (newer record timestamp) must
// not revert this device's explicit Keep override — same contract as ticks.
test("a Keep override outlives a newer remote enrichment record", () => {
  const local = {
    c1: { conversationId: "c1", timestamp: "2026-09-01T00:00:00Z", junk: true, keep: true, keepUpdatedAt: "2026-09-03T00:00:00Z" },
  };
  const remote = {
    c1: { conversationId: "c1", timestamp: "2026-09-02T00:00:00Z", junk: true },
  };
  const merged = mergeMaps(local as never, remote as never);
  assert.equal(merged.c1.keep, true);
  assert.equal(merged.c1.timestamp, "2026-09-02T00:00:00Z"); // body still newest-wins
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `merged.c1.keep` is `undefined` (remote record won, no overlay).

- [ ] **Step 3: Add the field pair to `DONE_FIELDS`** in `src/lib/merge.ts`

```ts
const DONE_FIELDS: { keys: string; stamp: string }[] = [
  { keys: "doneKeys", stamp: "doneKeysUpdatedAt" },
  { keys: "planDoneKeys", stamp: "planDoneUpdatedAt" },
  { keys: "letGoKeys", stamp: "letGoUpdatedAt" },
  // Not a key list but the same contract: a user act carrying its own clock,
  // resolved independently so it is never reverted by an otherwise-newer record.
  { keys: "keep", stamp: "keepUpdatedAt" },
];
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, including the pre-existing merge tests in `test/sync-merge.test.mts` and `test/stable-compare.test.mts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/merge.ts test/enrich.test.mts
git commit -m "feat(merge): Keep override carries its own clock across devices"
```

---

### Task 4: `enrich-storage.ts` + synced namespace

**Files:**
- Create: `src/lib/enrich-storage.ts`
- Modify: `src/lib/kv.ts:96-107` (`SYNCED_NAMESPACES`)

**Interfaces:**
- Consumes: `readMap`/`writeMap` from `./map-storage` (Task 1); `Enrichment` from `./enrich` (Task 2).
- Produces:
  - `interface StoredEnrichment { conversationId: string; timestamp: string; wordCount: number; junk: boolean; junkReason?: string; title?: string; overview?: string; keep?: boolean; keepUpdatedAt?: string }`
  - `getEnrichments(): Map<string, StoredEnrichment>`
  - `saveEnrichment(record: { conversationId: string; wordCount: number; enrichment: Enrichment }): StoredEnrichment`
  - `toggleKeep(conversationId: string): boolean` (returns the new keep state)

- [ ] **Step 1: Create `src/lib/enrich-storage.ts`**

```ts
"use client";

import type { Enrichment } from "./enrich";
import { readMap, writeMap } from "./map-storage";

/**
 * Cached enrichment results, keyed by conversation id. Client-owned like every
 * other lens output: localStorage first, mirrored to the durable store by the
 * generic sync (the namespace is in SYNCED_NAMESPACES), merged per-record by
 * `timestamp` with `keep` resolved on its own clock.
 */
export interface StoredEnrichment {
  conversationId: string;
  timestamp: string; // when produced; the record's merge clock
  wordCount: number;
  junk: boolean;
  junkReason?: string;
  /** Absent on records junked by the word floor — no LLM ever ran. */
  title?: string;
  overview?: string;
  /** User override: show this conversation despite the junk verdict. */
  keep?: boolean;
  /** Its own clock — a Keep must never be reverted by a re-run's newer record
   *  (same reasoning as doneKeysUpdatedAt; see merge.ts). */
  keepUpdatedAt?: string;
}

const ENRICHMENTS_KEY = "omi-enrichments";

export function getEnrichments(): Map<string, StoredEnrichment> {
  return new Map(Object.entries(readMap<StoredEnrichment>(ENRICHMENTS_KEY)));
}

export function saveEnrichment(record: {
  conversationId: string;
  wordCount: number;
  enrichment: Enrichment;
}): StoredEnrichment {
  const map = readMap<StoredEnrichment>(ENRICHMENTS_KEY);
  const prev = map[record.conversationId];
  const { junk, junk_reason, title, overview } = record.enrichment;
  const stored: StoredEnrichment = {
    conversationId: record.conversationId,
    timestamp: new Date().toISOString(),
    wordCount: record.wordCount,
    junk,
    ...(junk_reason ? { junkReason: junk_reason } : {}),
    ...(title ? { title } : {}),
    ...(overview ? { overview } : {}),
    // A re-run replaces the verdict but not the user's override.
    ...(prev?.keep !== undefined ? { keep: prev.keep, keepUpdatedAt: prev.keepUpdatedAt } : {}),
  };
  map[record.conversationId] = stored;
  writeMap(ENRICHMENTS_KEY, map);
  return stored;
}

export function toggleKeep(conversationId: string): boolean {
  const map = readMap<StoredEnrichment>(ENRICHMENTS_KEY);
  const stored = map[conversationId];
  if (!stored) return false;
  stored.keep = !stored.keep;
  stored.keepUpdatedAt = new Date().toISOString();
  writeMap(ENRICHMENTS_KEY, map);
  return stored.keep;
}
```

- [ ] **Step 2: Add the namespace to `kv.ts`**

In `SYNCED_NAMESPACES`, after `"omi-adhd-weekly-rollups"`:

```ts
  "omi-enrichments",
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npx eslint src/lib/enrich-storage.ts src/lib/kv.ts`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/enrich-storage.ts src/lib/kv.ts
git commit -m "feat(enrich): synced client-side store with reversible Keep override"
```

---

### Task 5: `POST /api/enrich`

**Files:**
- Create: `src/app/api/enrich/route.ts`

**Interfaces:**
- Consumes: `getConversation`, `segmentsToText` from `@/lib/omi-api`; `enrichConversation`, `countTranscriptWords`, `JUNK_WORD_FLOOR` from `@/lib/enrich`; `friendlyError` from `@/lib/api-error`.
- Produces: `POST { conversationId } → 200 { enrichment: Enrichment, wordCount: number }` — the client saves it via `saveEnrichment`.

- [ ] **Step 1: Create the route** (mirrors `analyze-adhd/route.ts`)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { enrichConversation, countTranscriptWords, JUNK_WORD_FLOOR } from "@/lib/enrich";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Please select a conversation to name." },
        { status: 400 }
      );
    }

    const convo = await getConversation(conversationId);
    const segments = convo.transcript_segments ?? [];
    if (segments.length === 0) {
      return NextResponse.json(
        { error: "This conversation has no transcript to name." },
        { status: 404 }
      );
    }

    const wordCount = countTranscriptWords(segments);

    // Below the floor there is nothing to name: junk by definition, no LLM spent.
    if (wordCount < JUNK_WORD_FLOOR) {
      return NextResponse.json({
        enrichment: {
          junk: true,
          junk_reason: `Only ${wordCount} ${wordCount === 1 ? "word" : "words"} were caught`,
          title: "",
          overview: "",
        },
        wordCount,
      });
    }

    const enrichment = await enrichConversation(segmentsToText(segments), convo.created_at);
    return NextResponse.json({ enrichment, wordCount });
  } catch (err) {
    console.error("enrich failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint src/app/api/enrich/route.ts`
Expected: clean. (Behavioral verification happens against the dev server in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/enrich/route.ts
git commit -m "feat(enrich): API route — word-floor short-circuit, then the LLM pass"
```

---

### Task 6: Home list integration

**Files:**
- Modify: `src/app/page.tsx` — title chain, overview fallback, search, enrichment state, "Name new (n)" button, Ignored section.

All edits below are in `src/app/page.tsx`; line references are pre-edit.

- [ ] **Step 1: Imports and props**

Add to imports:

```ts
import { getEnrichments, saveEnrichment, toggleKeep, type StoredEnrichment } from "@/lib/enrich-storage";
import type { Enrichment } from "@/lib/enrich";
```

- [ ] **Step 2: Title chain and overview fallback**

Replace `conversationTitle` (line 260) — enrichment slots between the Omi title and the ADHD gist, and the doc comment grows one line:

```ts
function conversationTitle(convo: Conversation, enrichment?: StoredEnrichment, gist?: string): string {
  const omi = convo.structured?.title?.trim();
  if (omi) return omi;
  // The enrichment pass exists to name conversations; the gist is a summary
  // pressed into service. Purpose-built name first.
  if (enrichment?.title) return enrichment.title;
  if (gist) return gist;
  const when = formatDateTime(convo.created_at);
  const cat = convo.structured?.category?.trim();
  return cat ? `${when} · ${cat}` : when;
}
```

`ConversationRow` gains an `enrichment?: StoredEnrichment` prop (threaded like `gist`); its two `conversationTitle(convo, gist)` calls (lines 323, 349, 360, and the aria-label at 306) become `conversationTitle(convo, enrichment, gist)`. Both overview renders (lines 326–328 and 363–365) become a fallback chain:

```tsx
{(convo.structured?.overview || enrichment?.overview) && (
  <p className="text-slate-400 font-serif italic text-sm mt-1 line-clamp-1">
    {convo.structured?.overview || enrichment?.overview}
  </p>
)}
```

(line-clamp-1 in the select-mode branch, line-clamp-2 in the link branch, as today.)

- [ ] **Step 3: Enrichment state in `HomeInner`**

Beside the `gists` state (line 407):

```ts
const [enrichments, setEnrichments] = useState<Map<string, StoredEnrichment>>(() => getEnrichments());
```

In the `resync` handler (line 533), add:

```ts
setEnrichments(getEnrichments());
```

- [ ] **Step 4: Junk partition**

After the `filtered` computation (line 626–630), partition — a record is hidden only on an explicit unkept junk verdict:

```ts
const isHiddenJunk = useCallback(
  (cid: string) => {
    const e = enrichments.get(cid);
    return !!e && e.junk && !e.keep;
  },
  [enrichments]
);
const shown = filtered.filter((c) => !isHiddenJunk(c.id));
const ignored = filtered.filter((c) => isHiddenJunk(c.id));
```

Every downstream use of `filtered` for the MAIN list (the `filteredByDay` grouping at 635, the list render at 1255/1282, `allFilteredSelected` at 656, `selectAll` at 674, the "Everything here has been analyzed!" empty state at 1243) switches to `shown`. `visibleAnalyzedCount`/`visibleConversations.length` (line 624, 1006) also exclude hidden junk so "3/9 analyzed" doesn't count rows the list no longer shows:

```ts
const countable = visibleConversations.filter((c) => !isHiddenJunk(c.id));
const visibleAnalyzedCount = countable.filter((c) => isAnalyzedEither(c.id)).length;
```

(the scan row renders `{visibleAnalyzedCount}/{countable.length} analyzed`).

- [ ] **Step 5: "Name new (n)" batch**

State, beside the ADHD batch state (line 436–439):

```ts
const [naming, setNaming] = useState(false);
const [namingProgress, setNamingProgress] = useState({ done: 0, total: 0 });
const [namingFailed, setNamingFailed] = useState(0);
```

Unnamed = visible, no enrichment record, no Omi title, and no ADHD gist. The gist exclusion is a token-spend rule, not a display rule: a gisted conversation already has a name, and enriching it would re-send a transcript to produce one that exists.

```ts
const unnamed = useMemo(
  () =>
    visibleConversations.filter(
      (c) => !enrichments.has(c.id) && !c.structured?.title?.trim() && !gists.has(c.id)
    ),
  [visibleConversations, enrichments, gists]
);
```

Runner (same sequential shape as `executeBatchAdhd`, line 687):

```ts
const runNaming = useCallback(async () => {
  const ids = unnamed.map((c) => c.id);
  if (ids.length === 0) return;
  setNaming(true);
  setNamingProgress({ done: 0, total: ids.length });
  setNamingFailed(0);
  let failed = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      const data = await fetchJson<{ enrichment: Enrichment; wordCount: number }>("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: ids[i] }),
      });
      saveEnrichment({ conversationId: ids[i], wordCount: data.wordCount, enrichment: data.enrichment });
    } catch {
      failed++;
    }
    setNamingProgress({ done: i + 1, total: ids.length });
  }
  setNamingFailed(failed);
  setEnrichments(getEnrichments());
  setNaming(false);
}, [unnamed]);
```

Button — in the scan row (line 1038), rendered before the "Select & Analyze Group" button whenever `unnamed.length > 0 && !selectMode`:

```tsx
{!selectMode && unnamed.length > 0 && (
  <button
    onClick={runNaming}
    disabled={naming}
    aria-label={`Name ${unnamed.length} unnamed ${unnamed.length === 1 ? "conversation" : "conversations"}`}
    className={`${BUTTON_SECONDARY} flex-shrink-0`}
  >
    <SparklesIcon className="w-3.5 h-3.5" />
    {naming ? `Naming ${namingProgress.done}/${namingProgress.total}…` : `Name new (${unnamed.length})`}
  </button>
)}
```

Failure note, under the scan row (a count is enough here — a failed naming is retryable by pressing the button again, which re-targets exactly the still-unnamed rows):

```tsx
{!naming && namingFailed > 0 && (
  <p className="text-sm text-amber-300/90 mt-2" role="status">
    {namingFailed} {namingFailed === 1 ? "conversation" : "conversations"} could not be named — press Name new to retry.
  </p>
)}
```

- [ ] **Step 6: Ignored section**

After the main list `</div>` (line 1295), before the "What is Pioneer Sovereignty?" footnote:

```tsx
{ignored.length > 0 && (
  <details className="mt-4 group">
    <summary className="cursor-pointer list-none text-sm text-slate-400 hover:text-slate-300 transition-colors min-h-[44px] flex items-center gap-1.5">
      <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-90" />
      Ignored ({ignored.length}) — noise recordings, kept out of the way
    </summary>
    <ul className="pl-5 pt-1 space-y-2">
      {ignored.map((convo) => {
        const e = enrichments.get(convo.id);
        return (
          <li key={convo.id} className="flex items-center justify-between gap-3 text-sm">
            <Link href={`/conversation/${convo.id}`} className="min-w-0 text-slate-300 hover:text-white transition-colors">
              <span className="block truncate">
                {e?.title || formatDateTime(convo.created_at)}
              </span>
              <span className="block text-xs text-slate-500 truncate">
                {e?.junkReason || "Marked as noise"}{e ? ` · ${e.wordCount} ${e.wordCount === 1 ? "word" : "words"}` : ""}
              </span>
            </Link>
            <button
              onClick={() => {
                toggleKeep(convo.id);
                setEnrichments(getEnrichments());
              }}
              aria-label={`Keep "${e?.title || formatDateTime(convo.created_at)}" in the list`}
              className="flex-shrink-0 text-cyan-400 hover:underline min-h-[44px] px-2"
            >
              Keep
            </button>
          </li>
        );
      })}
    </ul>
  </details>
)}
```

A kept conversation re-enters the main list, where a junk row that was kept can be re-ignored from nowhere — acceptable for now? No: reversible both ways is the spec. Give `ConversationRow`'s link branch nothing new; instead, kept-junk rows show their reason line via the overview fallback (the overview is usually empty on junk), and re-ignoring is done by pressing **Keep** again in… the row is no longer in the Ignored list. So: kept junk rows STAY in the Ignored disclosure as well, with the button reading "Ignore again". Amend the partition in Step 4 — `ignored` includes ALL junk-flagged rows (kept or not); only `shown` filtering uses `keep`:

```ts
const shown = filtered.filter((c) => {
  const e = enrichments.get(c.id);
  return !(e?.junk && !e.keep);
});
const ignored = filtered.filter((c) => enrichments.get(c.id)?.junk);
```

and in the Ignored row, the button label reflects state:

```tsx
{enrichments.get(convo.id)?.keep ? "Ignore again" : "Keep"}
```

(aria-label likewise: `Keep … in the list` / `Ignore … again`.)

- [ ] **Step 7: Search covers enrichment titles**

In `searchResults` (line 611–619):

```ts
const searchResults = useMemo(() => {
  if (!isSearching) return [];
  const q = searchQuery.trim().toLowerCase();
  return conversations.filter((c) => {
    const e = enrichments.get(c.id);
    const title = c.structured?.title?.toLowerCase() ?? "";
    const overview = c.structured?.overview?.toLowerCase() ?? "";
    const eTitle = e?.title?.toLowerCase() ?? "";
    const eOverview = e?.overview?.toLowerCase() ?? "";
    return title.includes(q) || overview.includes(q) || eTitle.includes(q) || eOverview.includes(q);
  });
}, [conversations, searchQuery, isSearching, enrichments]);
```

- [ ] **Step 8: Thread the prop**

Both `ConversationRow` call sites (lines 1266–1277 and 1282–1293) gain:

```tsx
enrichment={enrichments.get(convo.id)}
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && npx eslint src/app/page.tsx && npm test`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(home): Name-new batch, enriched titles, Ignored section"
```

---

### Task 7: Detail page title fallback

**Files:**
- Modify: `src/app/conversation/[id]/page.tsx:732` (the h1) and its imports/state.

- [ ] **Step 1: Wire the enrichment title**

Add import:

```ts
import { getEnrichments } from "@/lib/enrich-storage";
```

Add state near the page's other lazy initializers (search for `useState(() =>` in the file and match the local pattern; the page is a client component):

```ts
const [enrichedTitle] = useState<string | undefined>(
  () => getEnrichments().get(id)?.title
);
```

(where `id` is the conversation id variable already in scope for storage reads — locate it by the existing `getAdhdAnalysis`/stored-analysis reads.)

Change line 732:

```tsx
{conversation.structured?.title || enrichedTitle || "Untitled"}
```

And line 781's map label likewise:

```ts
label: conversation.structured?.title || enrichedTitle || "This conversation",
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint "src/app/conversation/[id]/page.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/conversation/[id]/page.tsx"
git commit -m "feat(conversation): fall back to the enrichment title"
```

---

### Task 8: Full verification

- [ ] **Step 1: Full test + build**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: all pass; build completes.

- [ ] **Step 2: Browser verification** (dev server via the Browser pane, `.claude/launch.json`)

1. Home list renders; conversations with Omi titles unchanged.
2. "Name new (n)" appears when unnamed conversations exist; pressing it walks the batch, rows pick up titles/overviews without reload.
3. A short recording lands in "Ignored (n)"; expanding shows reason + word count; **Keep** restores it to the list; "Ignore again" re-hides it.
4. Search finds a conversation by its enrichment title.
5. `/usage` shows the `enrich` label after a run (needs DATABASE_URL configured; skip if not).

- [ ] **Step 3: Final commit** (if verification produced fixes)

```bash
git add -A && git commit -m "fix(enrich): verification fixes"
```
