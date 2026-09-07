# Unrecognized Voice Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the "Unrecognized voice" review card answerable — show what the voice said and who else was there, let the user hear it, and collapse one recurring voice into one decision.

**Architecture:** Three phases behind one card component. Phase 1 is client-only: a pure evidence builder over the transcript the card already points at, plus a shared per-conversation fetch cache. Phase 2 adds a route that slices one speaker's audio out of the archive and caches the clip as a private Blob. Phase 3 persists the speaker embedding the capture pipeline already computes, adds an opt-in batched backfill for the pre-enrollment backlog, and groups cards by voice.

**Tech Stack:** Next.js App Router (see `AGENTS.md` — read `node_modules/next/dist/docs/` before writing route code), TypeScript, Tailwind, `@vercel/blob`, `@huggingface/transformers` (WavLM-SV), Postgres via `src/lib/kv.ts`'s `getStore()`, tests via `node --test` on `.test.mts` files.

**Spec:** `docs/superpowers/specs/2026-09-07-unrecognized-voice-review-design.md`

## Global Constraints

- **No LLM call anywhere in this work.** Every fact on the card comes from data already stored.
- **No expensive work on page load.** No audio assembly, decode, or embedding may run without an explicit user tap. No preloading of clips.
- **Degrade, never block.** A failed evidence fetch, a missing clip, or an unavailable store leaves the card's picker/Add/Ignore fully working.
- **Tests are pure-function only.** This repo has no localStorage stub, no route-invocation harness, and no `sql`/model mocking in `test/`. Do not add that machinery. Route handlers, `identifySpeakers`, and localStorage mutators are verified by `npm run build` plus the manual checks listed per phase. A local `globalThis.fetch` stub inside one test file is *not* that machinery and is explicitly permitted (Task 2 uses one).
- **Local dev has no store.** `getStore()` refuses `DATABASE_URL` outside prod builds, so every new route returns 503 in dev and every control that depends on one must not render.
- **Existing card behaviour is frozen.** Accept/Add/Ignore semantics, error copy, and the 44px minimum tap targets stay exactly as they are.
- **Threshold env vars:** `CAPTURE_VOICE_MATCH_THRESHOLD` default `0.8` (existing), `CAPTURE_VOICE_GROUP_THRESHOLD` default `0.85` (new).
- **Clip cap:** ~15s of speech, path `speaker-clips/{conversationId}/{speakerId}.wav`, `access: "private"`, `addRandomSuffix: false`.
- **Commit style:** conventional prefix, and every commit ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/voice-evidence.ts` (create) | Pure `buildVoiceEvidence` + the shared per-conversation fetch cache. No React. |
| `src/components/VoicePendingCard.tsx` (create) | The card, moved out of the 1337-line page. Owns evidence rendering, the play control, and group members. |
| `src/app/people/page.tsx` (modify) | Loses the card's JSX; keeps the handlers and gains the grouping button + sibling sweep. |
| `src/lib/capture/clip.ts` (create) | Pure `capSpeakerSegments` — how much of a speaker to put in a preview clip. |
| `src/app/api/capture/speaker-audio/route.ts` (create) | GET one speaker's WAV, Blob-cached. |
| `src/lib/capture/cluster.ts` (create) | Pure `clusterEmbeddings` — greedy single-link over cosine. |
| `src/app/api/capture/cluster-voices/route.ts` (create) | Batched backfill + grouping. |
| `src/app/api/capture/rematch-voices/route.ts` (create) | Post-enrollment sibling sweep. |
| `src/lib/capture/store.ts` (modify) | `voice_clusters` DDL + its three accessors. |
| `src/lib/capture/pipeline.ts` (modify) | Export `readBlob`; return unmatched embeddings; write them in `transcribeSession`. |
| `src/lib/people.ts` (modify) | `voiceGroupId` field + batched `setVoiceGroups`. |

---

## Phase 1 — the card shows its evidence

### Task 1: Pure evidence builder

**Files:**
- Create: `src/lib/voice-evidence.ts`
- Test: `test/voice-evidence.test.mts`

**Interfaces:**
- Consumes: `Conversation`, `TranscriptSegment` from `src/lib/conversation-types.ts`.
- Produces: `interface VoiceEvidence { title: string; quotes: string[]; othersPresent: string[]; lineCount: number; speechSeconds: number; canPlay: boolean }` and `buildVoiceEvidence(conversation: Conversation, speakerId: number): VoiceEvidence`.

- [ ] **Step 1: Write the failing tests**

Create `test/voice-evidence.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVoiceEvidence } from "../src/lib/voice-evidence.ts";
import type { Conversation } from "../src/lib/conversation-types.ts";

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  created_at: "2026-09-07T06:40:00.000Z",
  source: "trace",
  structured: { title: "Field visit", overview: "" },
  transcript_segments: [
    { text: "yeah", speaker_id: 2, start: 0, end: 0.5 },
    { text: "So we moved the herd up past the old fence line last week.", speaker_id: 2, start: 1, end: 5 },
    { text: "Right, and how did that go?", speaker_id: 1, speaker_name: "Ana", start: 5, end: 7 },
    { text: "Better than the year before, honestly, once the water was running again.", speaker_id: 2, start: 7, end: 11 },
    { text: "mm-hm", speaker_id: 2, start: 11, end: 11.5 },
    { text: "Good.", speaker_id: 0, speaker_name: "Marco", start: 12, end: 12.5 },
  ],
  ...over,
});

test("quotes the speaker's longest lines, in the order they were spoken", () => {
  const e = buildVoiceEvidence(conv(), 2);
  assert.equal(e.quotes.length, 3);
  assert.ok(e.quotes[0].startsWith("So we moved the herd"));
  assert.ok(e.quotes[1].startsWith("Better than the year before"));
  // "mm-hm" (5 chars) beats "yeah" (4), and is spoken last of the three —
  // so this pins both the longest-first selection and the chronological output.
  assert.equal(e.quotes[2], "mm-hm");
});

test("counts only the target speaker's lines and speech time", () => {
  const e = buildVoiceEvidence(conv(), 2);
  assert.equal(e.lineCount, 4);
  assert.ok(Math.abs(e.speechSeconds - 9) < 1e-9);
});

test("lists the other named speakers, deduped, excluding the target", () => {
  const e = buildVoiceEvidence(conv(), 2);
  assert.deepEqual(e.othersPresent, ["Ana", "Marco"]);
});

test("omits unnamed speakers from othersPresent", () => {
  const e = buildVoiceEvidence(
    conv({
      transcript_segments: [
        { text: "one", speaker_id: 2, start: 0, end: 1 },
        { text: "two", speaker_id: 3, start: 1, end: 2 },
      ],
    }),
    2
  );
  assert.deepEqual(e.othersPresent, []);
});

test("truncates a long quote on a word boundary", () => {
  const long = "word ".repeat(60).trim();
  const e = buildVoiceEvidence(
    conv({ transcript_segments: [{ text: long, speaker_id: 2, start: 0, end: 1 }] }),
    2
  );
  assert.ok(e.quotes[0].length <= 141, "truncated to the cap plus the ellipsis");
  assert.ok(e.quotes[0].endsWith("…"));
  assert.ok(!e.quotes[0].includes("wor…"), "must not cut mid-word");
});

test("speechSeconds is 0 when segments carry no timings", () => {
  const e = buildVoiceEvidence(
    conv({ transcript_segments: [{ text: "hello there", speaker_id: 2 }] }),
    2
  );
  assert.equal(e.speechSeconds, 0);
  assert.equal(e.lineCount, 1);
});

test("skips blank segments when choosing quotes", () => {
  const e = buildVoiceEvidence(
    conv({
      transcript_segments: [
        { text: "   ", speaker_id: 2, start: 0, end: 1 },
        { text: "real line", speaker_id: 2, start: 1, end: 2 },
      ],
    }),
    2
  );
  assert.deepEqual(e.quotes, ["real line"]);
});

test("uses the structured title when there is one", () => {
  assert.equal(buildVoiceEvidence(conv(), 2).title, "Field visit");
});

test("falls back to a title derived from the conversation's timestamp", () => {
  const morning = buildVoiceEvidence(
    conv({ structured: undefined, created_at: "2026-09-07T06:40:00.000Z" }),
    2
  );
  const evening = buildVoiceEvidence(
    conv({ structured: undefined, created_at: "2026-09-10T19:05:00.000Z" }),
    2
  );
  assert.notEqual(morning.title, "");
  assert.notEqual(morning.title, "Field visit");
  // The real assertion: the fallback is a function of created_at, not a
  // constant. Locale-independent, so it holds wherever this suite runs.
  assert.notEqual(morning.title, evening.title);
});

test("an unparseable timestamp still yields a usable title", () => {
  assert.equal(
    buildVoiceEvidence(conv({ structured: undefined, created_at: "not a date" }), 2).title,
    "Untitled conversation"
  );
});

test("canPlay is true only for TRACE-captured conversations", () => {
  assert.equal(buildVoiceEvidence(conv(), 2).canPlay, true);
  assert.equal(buildVoiceEvidence(conv({ source: "omi" }), 2).canPlay, false);
  assert.equal(buildVoiceEvidence(conv({ source: undefined }), 2).canPlay, false);
});

test("a speaker with no segments yields an empty but valid evidence block", () => {
  const e = buildVoiceEvidence(conv(), 9);
  assert.deepEqual(e.quotes, []);
  assert.equal(e.lineCount, 0);
  assert.equal(e.speechSeconds, 0);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/voice-evidence.test.mts`
Expected: FAIL — cannot resolve `../src/lib/voice-evidence.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/voice-evidence.ts`:

```ts
"use client";

import type { Conversation, TranscriptSegment } from "./conversation-types";

/** Everything the review card needs to let a person answer "who is this?",
 *  derived entirely from the conversation the suggestion already points at.
 *  No LLM, no new API — the transcript already knows all of it. */
export interface VoiceEvidence {
  title: string;
  /** ≤3 of this speaker's longest lines, shown in the order spoken. */
  quotes: string[];
  /** Distinct names of the speakers who *were* recognized here. */
  othersPresent: string[];
  lineCount: number;
  /** 0 when the transcript carries no per-segment timings (Omi imports). */
  speechSeconds: number;
  /** Omi-imported conversations have no archived audio and never will. */
  canPlay: boolean;
}

const MAX_QUOTES = 3;
const MAX_QUOTE_CHARS = 140;

/** Cuts on a word boundary: "wor…" reads as a typo, not an elision. Falls back
 *  to a hard cut only when the first 140 characters contain no late space. */
function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const body = space > max / 2 ? cut.slice(0, space) : cut;
  return `${body.trimEnd()}…`;
}

function speakerOf(s: TranscriptSegment): number {
  return s.speaker_id ?? 0;
}

function fallbackTitle(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "Untitled conversation";
  return d.toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function buildVoiceEvidence(conversation: Conversation, speakerId: number): VoiceEvidence {
  const segments = conversation.transcript_segments ?? [];
  const mine = segments.filter((s) => speakerOf(s) === speakerId);

  // Longest-first, because the opening lines of a diarized cluster are
  // disproportionately "yeah" / "mm-hm" — onset noise that identifies nobody.
  // Re-sorted to spoken order afterwards so the block still reads as speech.
  const quotes = mine
    .map((s, i) => ({ i, text: s.text.trim() }))
    .filter((q) => q.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, MAX_QUOTES)
    .sort((a, b) => a.i - b.i)
    .map((q) => truncate(q.text, MAX_QUOTE_CHARS));

  const others: string[] = [];
  for (const s of segments) {
    if (speakerOf(s) === speakerId) continue;
    const name = s.speaker_name?.trim();
    if (name && !others.includes(name)) others.push(name);
  }

  const speechSeconds = mine.reduce((total, s) => {
    return typeof s.start === "number" && typeof s.end === "number" && s.end > s.start
      ? total + (s.end - s.start)
      : total;
  }, 0);

  return {
    title: conversation.structured?.title?.trim() || fallbackTitle(conversation.created_at),
    quotes,
    othersPresent: others,
    lineCount: mine.length,
    speechSeconds,
    canPlay: conversation.source === "trace",
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/voice-evidence.test.mts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice-evidence.ts test/voice-evidence.test.mts
git commit -m "feat(people): derive review evidence from a conversation transcript

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Shared per-conversation fetch cache

**Files:**
- Modify: `src/lib/voice-evidence.ts` (append)
- Test: `test/voice-evidence-cache.test.mts`

**Interfaces:**
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`; `Conversation`.
- Produces: `loadConversationCached(id: string): Promise<Conversation>` and `resetConversationCache(): void` (test-only reset).

- [ ] **Step 1: Write the failing tests**

Create `test/voice-evidence-cache.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConversationCached, resetConversationCache } from "../src/lib/voice-evidence.ts";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  let calls = 0;
  globalThis.fetch = (async (input: string) => {
    calls++;
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => calls;
}

test("many cards on one conversation make a single request", async () => {
  resetConversationCache();
  const calls = stubFetch(() => ({ status: 200, body: { id: "c1", created_at: "2026-09-07T00:00:00.000Z" } }));
  try {
    const [a, b, c] = await Promise.all([
      loadConversationCached("c1"),
      loadConversationCached("c1"),
      loadConversationCached("c1"),
    ]);
    assert.equal(a.id, "c1");
    assert.equal(b.id, "c1");
    assert.equal(c.id, "c1");
    assert.equal(calls(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("distinct conversations each get their own request", async () => {
  resetConversationCache();
  const calls = stubFetch((url) => ({
    status: 200,
    body: { id: url.split("/").pop(), created_at: "2026-09-07T00:00:00.000Z" },
  }));
  try {
    await Promise.all([loadConversationCached("c1"), loadConversationCached("c2")]);
    assert.equal(calls(), 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failure is evicted so a later card can retry", async () => {
  resetConversationCache();
  let fail = true;
  const calls = stubFetch(() =>
    fail
      ? { status: 500, body: { error: "boom" } }
      : { status: 200, body: { id: "c1", created_at: "2026-09-07T00:00:00.000Z" } }
  );
  try {
    await assert.rejects(loadConversationCached("c1"), /boom/);
    fail = false;
    const ok = await loadConversationCached("c1");
    assert.equal(ok.id, "c1");
    assert.equal(calls(), 2, "the rejected promise must not be cached");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/voice-evidence-cache.test.mts`
Expected: FAIL — `loadConversationCached` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/voice-evidence.ts`:

```ts
import { fetchJson } from "./fetch-json";

/** One in-flight request per conversation, shared by every card that needs it.
 *  A 44-card queue can span far fewer conversations, and grouping makes several
 *  cards share one outright. The route is `immutable, max-age=86400` for a
 *  finished conversation, so a resolved entry is kept for the page's lifetime;
 *  a rejected one is evicted so the next card can retry. */
const conversationCache = new Map<string, Promise<Conversation>>();

export function loadConversationCached(id: string): Promise<Conversation> {
  const hit = conversationCache.get(id);
  if (hit) return hit;
  const p = fetchJson<Conversation>(`/api/conversations/${id}`);
  p.catch(() => conversationCache.delete(id));
  conversationCache.set(id, p);
  return p;
}

/** Test-only. Nothing in the app clears this — a page load is the reset. */
export function resetConversationCache(): void {
  conversationCache.clear();
}
```

Move the `import { fetchJson }` line up beside the existing `import type` at the top of the file.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/voice-evidence-cache.test.mts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/voice-evidence.ts test/voice-evidence-cache.test.mts
git commit -m "feat(people): share one conversation fetch across review cards

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Move `VoicePendingCard` into its own file

No behaviour change. The card is about to grow an evidence block, an audio control and group members; `src/app/people/page.tsx` is already 1337 lines and must not absorb them.

**Files:**
- Create: `src/components/VoicePendingCard.tsx`
- Modify: `src/app/people/page.tsx` (delete lines 1169-1246, add an import)

**Interfaces:**
- Consumes: `PendingSuggestion`, `Person` from `src/lib/people.ts`; `BUTTON_PRIMARY` from `src/lib/ui.ts`; `getAnalysisAge` from `src/lib/storage.ts`; `optionLabel` (currently a local helper in `page.tsx`).
- Produces: default-exported `VoicePendingCard` with exactly today's props — `{ suggestion, people, showError, errorMessage, newName, onNewNameChange, onAcceptExisting, onAcceptNew, onIgnore }`.

- [ ] **Step 1: Find `optionLabel` and move it**

Run: `grep -n "function optionLabel" -A 6 src/app/people/page.tsx`

It is used by both `PendingCard` and `VoicePendingCard`, so it moves to `src/lib/ui.ts` (exported) rather than being duplicated. Update `PendingCard`'s call site in `page.tsx` to import it from there.

- [ ] **Step 2: Create the component file**

Create `src/components/VoicePendingCard.tsx` containing the `"use client"` directive, the imports listed above, and the `VoicePendingCard` function copied verbatim from `src/app/people/page.tsx:1169-1246`, changed only to `export default function VoicePendingCard(...)`.

- [ ] **Step 3: Delete the original and import the new one**

Remove lines 1169-1246 from `src/app/people/page.tsx`. Add near the other component imports:

```ts
import VoicePendingCard from "@/components/VoicePendingCard";
```

Leave the `<VoicePendingCard ... />` call site at `src/app/people/page.tsx:631` untouched.

- [ ] **Step 4: Verify nothing changed**

Run: `npm run build && npx tsc --noEmit && npm run lint`
Expected: all three clean. No test changes — this is a move.

- [ ] **Step 5: Commit**

```bash
git add src/components/VoicePendingCard.tsx src/app/people/page.tsx src/lib/ui.ts
git commit -m "refactor(people): move VoicePendingCard out of the page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Render the evidence block

**Files:**
- Modify: `src/components/VoicePendingCard.tsx`

**Interfaces:**
- Consumes: `buildVoiceEvidence`, `loadConversationCached`, `VoiceEvidence` from Tasks 1-2.
- Produces: no new exports. Adds an internal `<VoiceEvidenceBlock conversationId speakerId />`, which Task 7 extends with the play button.

- [ ] **Step 1: Add the evidence block component**

In `src/components/VoicePendingCard.tsx`, above `VoicePendingCard`:

```tsx
function formatSpeech(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s of speech`;
  return `~${Math.round(seconds / 60)} min of speech`;
}

/**
 * The reason this card is answerable at all. Everything here comes from the
 * conversation the suggestion already points at — what this voice said, who
 * else was recognized in the room, and a way into the full transcript.
 *
 * Failure is silent by design: a card without evidence is exactly the card
 * that shipped before, and the picker below it still works. An error banner
 * for a missing enhancement would only be noise stacked on top of a question
 * the user can still answer.
 */
function VoiceEvidenceBlock({ conversationId, speakerId }: { conversationId: string; speakerId: number }) {
  const [evidence, setEvidence] = useState<VoiceEvidence | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadConversationCached(conversationId)
      .then((c) => live && setEvidence(buildVoiceEvidence(c, speakerId)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [conversationId, speakerId]);

  if (failed) return null;

  // Reserves the block's height so the picker does not jump under a thumb
  // already reaching for it.
  if (!evidence) return <div className="mb-3 h-24 rounded-lg bg-slate-800/40 animate-pulse" aria-hidden="true" />;

  return (
    <div className="mb-3 min-w-0">
      <Link
        href={`/conversation/${conversationId}`}
        className="text-sm text-cyan-400 hover:underline break-words"
      >
        {evidence.title}
      </Link>
      <p className="text-slate-400 text-xs mt-0.5">
        {evidence.lineCount} {evidence.lineCount === 1 ? "line" : "lines"}
        {evidence.speechSeconds > 0 && ` · ${formatSpeech(evidence.speechSeconds)}`}
      </p>

      {evidence.quotes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {evidence.quotes.map((q, i) => (
            <li key={i} className="text-sm text-slate-300 border-l-2 border-slate-700 pl-3 break-words">
              “{q}”
            </li>
          ))}
        </ul>
      )}

      <p className="text-slate-400 text-xs mt-2 break-words">
        {evidence.othersPresent.length > 0
          ? `Also here: ${evidence.othersPresent.join(", ")}`
          : "No one else was recognized in this conversation."}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Add the imports**

At the top of `src/components/VoicePendingCard.tsx`:

```ts
import { useEffect, useState } from "react";
import Link from "next/link";
import { buildVoiceEvidence, loadConversationCached, type VoiceEvidence } from "@/lib/voice-evidence";
```

- [ ] **Step 3: Render it in the card**

In `VoicePendingCard`, immediately after the closing `</div>` of the header block (the one holding "Unrecognized voice" and the age) and before the `{showError && ...}` block:

```tsx
<VoiceEvidenceBlock conversationId={s.conversationId} speakerId={s.speakerId ?? 0} />
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: clean; all existing tests still pass.

Manual check (`npm run dev`, `/people`): a voice card shows the conversation title as a link, a line/duration count, up to three quoted lines, and an "Also here" line. Clicking the title opens the conversation. With the network throttled to offline, the block disappears and the picker still works.

- [ ] **Step 5: Commit**

```bash
git add src/components/VoicePendingCard.tsx
git commit -m "feat(people): show what an unrecognized voice actually said

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 2 — play this voice

### Task 5: Clip capping helper

**Files:**
- Create: `src/lib/capture/clip.ts`
- Test: `test/capture-clip.test.mts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CLIP_MAX_MS = 15_000` and `capSpeakerSegments<T extends { start: number; end: number }>(segments: T[], maxMs?: number): T[]`.

- [ ] **Step 1: Write the failing tests**

Create `test/capture-clip.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { capSpeakerSegments, CLIP_MAX_MS } from "../src/lib/capture/clip.ts";

test("CLIP_MAX_MS is 15 seconds", () => {
  assert.equal(CLIP_MAX_MS, 15_000);
});

test("takes leading segments until the cap is reached", () => {
  const segs = [
    { start: 0, end: 4 },
    { start: 5, end: 9 },
    { start: 10, end: 20 },
    { start: 21, end: 25 },
  ];
  assert.deepEqual(capSpeakerSegments(segs, 10_000), segs.slice(0, 3));
});

test("stops exactly at the boundary without taking one more", () => {
  const segs = [
    { start: 0, end: 5 },
    { start: 5, end: 10 },
    { start: 10, end: 15 },
  ];
  assert.deepEqual(capSpeakerSegments(segs, 10_000), segs.slice(0, 2));
});

test("always returns at least one segment, even if it exceeds the cap", () => {
  const segs = [{ start: 0, end: 90 }];
  assert.deepEqual(capSpeakerSegments(segs, 15_000), segs);
});

test("an empty cluster caps to nothing", () => {
  assert.deepEqual(capSpeakerSegments([], 15_000), []);
});

test("ignores segments with no positive duration", () => {
  const segs = [
    { start: 0, end: 0 },
    { start: 1, end: 20 },
  ];
  assert.deepEqual(capSpeakerSegments(segs, 15_000), segs);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/capture-clip.test.mts`
Expected: FAIL — cannot resolve `../src/lib/capture/clip.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/capture/clip.ts`:

```ts
/** How much of a speaker goes into a preview clip. Recognition of a familiar
 *  voice is near-instant; 15s at 16kHz mono is ~480KB of WAV, small enough to
 *  serve inline and long enough to be sure. */
export const CLIP_MAX_MS = 15_000;

/**
 * The leading segments of one speaker's cluster, up to `maxMs` of speech.
 *
 * Leading, not longest: a clip is listened to, so it has to sound like someone
 * talking rather than three spliced highlights. Always returns at least one
 * segment — a single 90-second answer is still the only sample there is, and
 * returning nothing would render the speaker unplayable.
 */
export function capSpeakerSegments<T extends { start: number; end: number }>(
  segments: T[],
  maxMs: number = CLIP_MAX_MS
): T[] {
  const out: T[] = [];
  let total = 0;
  for (const seg of segments) {
    out.push(seg);
    total += Math.max(0, (seg.end - seg.start) * 1000);
    if (total >= maxMs) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/capture-clip.test.mts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture/clip.ts test/capture-clip.test.mts
git commit -m "feat(capture): cap a speaker preview clip at 15s of speech

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: The speaker-audio route

**Files:**
- Modify: `src/lib/capture/pipeline.ts:44` (export `readBlob`)
- Create: `src/app/api/capture/speaker-audio/route.ts`

**Interfaces:**
- Consumes: `readBlob`, `assembleSessionAudio` (`pipeline.ts`); `groupBySpeaker`, `extractSpeakerPcm` (`identify.ts`); `encodeWav` (`assemble.ts`); `capSpeakerSegments` (Task 5); `getSessionByConversationId`, `getConversationRow`, `ensureCaptureSchemaOnce` (`store.ts`); `getStore` (`kv.ts`); `friendlyError` (`api-error.ts`).
- Produces: `GET /api/capture/speaker-audio?conversationId=<string>&speakerId=<int>` → `audio/wav` bytes, or `{ error }` JSON.

- [ ] **Step 1: Read the routing docs**

Per `AGENTS.md`, this Next.js differs from training data. Read the route-handler guide under `node_modules/next/dist/docs/` before writing the file, and match the existing conventions in `src/app/api/capture/enroll-voice/route.ts`.

- [ ] **Step 2: Export `readBlob`**

In `src/lib/capture/pipeline.ts`, change line 44 from `async function readBlob(` to `export async function readBlob(`.

- [ ] **Step 3: Write the route**

Create `src/app/api/capture/speaker-audio/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getStore } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getSessionByConversationId, getConversationRow } from "@/lib/capture/store";
import { assembleSessionAudio, readBlob } from "@/lib/capture/pipeline";
import { groupBySpeaker, extractSpeakerPcm } from "@/lib/capture/identify";
import { encodeWav } from "@/lib/capture/assemble";
import { capSpeakerSegments } from "@/lib/capture/clip";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

const clipPath = (conversationId: string, speakerId: number) =>
  `speaker-clips/${conversationId}/${speakerId}.wav`;

function wav(bytes: Uint8Array): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.byteLength),
      // The clip is derived from an archived session that never changes.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/** Serves ~15s of one diarized speaker's audio, sliced back out of the
 *  archived session — the one signal that settles "who is this?" when the
 *  transcript context isn't enough (see the review card, and the spec at
 *  docs/superpowers/specs/2026-09-07-unrecognized-voice-review-design.md).
 *
 *  Unauthenticated on the same basis /api/capture/enroll-voice documents at
 *  length: called straight from the browser in a single-user app, reading only
 *  the user's own data. It is strictly narrower than that route — read-only,
 *  writing no namespace — but shares its one real exposure, unauthenticated
 *  *compute*: a Blob re-fetch plus an Opus decode of a whole session. Hence
 *  the same per-instance single-flight guard below, and hence the Blob cache,
 *  which makes every replay a stream rather than a second decode. */
let clipInFlight = false;

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const speakerRaw = req.nextUrl.searchParams.get("speakerId");
  const speakerId = Number(speakerRaw);
  if (!conversationId || speakerRaw === null || !Number.isInteger(speakerId)) {
    return NextResponse.json({ error: "expected conversationId and integer speakerId" }, { status: 400 });
  }

  const path = clipPath(conversationId, speakerId);

  // Cache hit skips the guard: a Blob read is not the thing being protected.
  try {
    return wav(await readBlob(path));
  } catch {
    // Miss. Fall through and build it.
  }

  if (clipInFlight) {
    return NextResponse.json({ error: "Another clip is loading — try again in a moment." }, { status: 429 });
  }
  clipInFlight = true;
  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const [session, conversation] = await Promise.all([
      getSessionByConversationId(sql, conversationId),
      getConversationRow(sql, conversationId),
    ]);
    if (!session || !conversation) {
      return NextResponse.json({ error: "No audio was kept for this conversation." }, { status: 404 });
    }

    const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];
    const clusters = groupBySpeaker(
      segments.filter((s) => s.speaker_id === speakerId).map((s) => ({ ...s, text: "" }))
    );
    const cluster = clusters[0];
    if (!cluster) {
      return NextResponse.json({ error: `no segments for speaker ${speakerId}` }, { status: 404 });
    }

    const { assembled } = await assembleSessionAudio(sql, session);
    const pcm = extractSpeakerPcm(assembled, session.startedAtMs, {
      ...cluster,
      segments: capSpeakerSegments(cluster.segments),
    });
    const bytes = encodeWav(pcm);

    // Best-effort: the user gets their audio either way, the next play just
    // pays for the decode again.
    try {
      await put(path, Buffer.from(bytes), {
        access: "private",
        addRandomSuffix: false,
        contentType: "audio/wav",
      });
    } catch (e) {
      console.error("speaker clip cache write failed:", e);
    }

    return wav(bytes);
  } catch (err) {
    console.error("speaker-audio failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  } finally {
    clipInFlight = false;
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

`SpeakerCluster` is `{ speakerId: number; segments: { start: number; end: number }[]; totalMs: number }` (`src/lib/capture/identify.ts:47`), so the spread above type-checks and `capSpeakerSegments`'s `{ start; end }` constraint is satisfied.

Local dev returns 503 (no store) — that is correct and expected. Real verification happens on a preview deploy in Task 7.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture/pipeline.ts src/app/api/capture/speaker-audio/route.ts
git commit -m "feat(capture): serve one speaker's audio, cached as a blob

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The play control

**Files:**
- Modify: `src/components/VoicePendingCard.tsx`
- Modify: `src/components/icons.tsx` (add `PlayIcon`, `PauseIcon` if absent)

**Interfaces:**
- Consumes: `VoiceEvidence.canPlay` (Task 1); the route from Task 6.
- Produces: no new exports.

- [ ] **Step 1: Add the icons**

Neither exists yet. Append both to `src/components/icons.tsx`, matching the
file's existing convention exactly (`IconProps`, 24×24 viewBox, `currentColor`
stroke at width 2, `aria-hidden`):

```tsx
export function PlayIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M7 4.5v15l12-7.5-12-7.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M9 4.5v15M15 4.5v15" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
```

Import them in `src/components/VoicePendingCard.tsx`:

```ts
import { PlayIcon, PauseIcon } from "@/components/icons";
```

- [ ] **Step 2: Add the player to `VoiceEvidenceBlock`**

Inside `VoiceEvidenceBlock`, after the existing state:

```tsx
const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
const [playing, setPlaying] = useState(false);
const [loadingClip, setLoadingClip] = useState(false);
const [clipError, setClipError] = useState<string | null>(null);

// Nothing preloads: 44 cards must never mean 44 session decodes. The element
// is created on the first tap and reused for every replay after it.
const togglePlay = () => {
  if (audio) {
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
    return;
  }
  setLoadingClip(true);
  setClipError(null);
  const el = new Audio(
    `/api/capture/speaker-audio?conversationId=${encodeURIComponent(conversationId)}&speakerId=${speakerId}`
  );
  el.addEventListener("canplay", () => setLoadingClip(false));
  el.addEventListener("play", () => setPlaying(true));
  el.addEventListener("pause", () => setPlaying(false));
  el.addEventListener("ended", () => setPlaying(false));
  el.addEventListener("error", () => {
    setLoadingClip(false);
    setPlaying(false);
    // The body is JSON when the route failed; the element cannot read it, so
    // this stays generic rather than guessing which failure it was.
    setClipError("Couldn’t load the audio for this voice.");
    setAudio(null);
  });
  setAudio(el);
  void el.play();
};

useEffect(() => () => audio?.pause(), [audio]);
```

Render it directly under the line/duration paragraph:

```tsx
{evidence.canPlay && (
  <div className="mt-2">
    <button
      onClick={togglePlay}
      disabled={loadingClip}
      aria-label={playing ? "Pause this voice" : "Play this voice"}
      className="inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg bg-slate-800 border border-slate-700 text-sm text-slate-200 hover:border-cyan-500/50 transition-colors disabled:opacity-50"
    >
      {playing ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
      {loadingClip ? "Loading…" : playing ? "Pause" : "Play this voice"}
    </button>
    {clipError && (
      <p className="text-red-400 text-xs mt-1 break-words" role="alert">
        {clipError}
      </p>
    )}
  </div>
)}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: clean.

Manual check on a preview deploy (not local dev — there is no store there): tap "Play this voice" on a TRACE-captured card. First tap shows "Loading…" then plays; the button toggles to Pause; a second tap replays instantly (network tab shows the cached-Blob response). An Omi-imported card shows no play button at all.

- [ ] **Step 4: Commit**

```bash
git add src/components/VoicePendingCard.tsx src/components/icons.tsx
git commit -m "feat(people): let a reviewer hear the unrecognized voice

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Phase 3 — collapse repeats

### Task 8: `voice_clusters` table and accessors

**Files:**
- Modify: `src/lib/capture/store.ts` (DDL near line 86; accessors near the conversation accessors)

**Interfaces:**
- Consumes: the existing `Sql`, `withTimeout` helpers in that file.
- Produces:
  - `interface VoiceClusterRow { conversationId: string; speakerId: number; embedding: number[] | null; groupId: string | null }`
  - `getVoiceClusters(sql: Sql, conversationIds: string[]): Promise<VoiceClusterRow[]>`
  - `upsertVoiceCluster(sql: Sql, r: VoiceClusterRow): Promise<void>`
  - `setVoiceClusterGroups(sql: Sql, groups: { conversationId: string; speakerId: number; groupId: string }[]): Promise<void>`

- [ ] **Step 1: Add the DDL**

In `ensureCaptureSchema`, after the `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unmatched_speakers JSONB` statement, add to the same array:

```ts
// Speaker embeddings for clusters that matched nobody, kept so the review
// queue can tell that N cards are one recurring person rather than N people
// (spec: 2026-09-07-unrecognized-voice-review-design.md). Not stored on the
// PendingSuggestion: 512 floats per card is ~9KB of JSON in a localStorage
// namespace that already carries photos and a quota guard.
sql`
  CREATE TABLE IF NOT EXISTS voice_clusters (
    conversation_id TEXT NOT NULL,
    speaker_id      INT  NOT NULL,
    embedding       JSONB,
    group_id        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, speaker_id)
  )`,
```

A null `embedding` means unembeddable — no session or no archived audio — which is why the column is nullable.

- [ ] **Step 2: Add the accessors**

```ts
// ── voice clusters ──

export interface VoiceClusterRow {
  conversationId: string;
  speakerId: number;
  /** null = unembeddable (session gone, or an Omi import with no audio). */
  embedding: number[] | null;
  groupId: string | null;
}

export async function getVoiceClusters(sql: Sql, conversationIds: string[]): Promise<VoiceClusterRow[]> {
  if (conversationIds.length === 0) return [];
  const rows = (await withTimeout(sql`
    SELECT conversation_id, speaker_id, embedding, group_id
    FROM voice_clusters WHERE conversation_id = ANY(${conversationIds})`)) as {
    conversation_id: string;
    speaker_id: number;
    embedding: number[] | null;
    group_id: string | null;
  }[];
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    speakerId: r.speaker_id,
    embedding: r.embedding,
    groupId: r.group_id,
  }));
}

export async function upsertVoiceCluster(sql: Sql, r: VoiceClusterRow): Promise<void> {
  await withTimeout(sql`
    INSERT INTO voice_clusters (conversation_id, speaker_id, embedding, group_id)
    VALUES (${r.conversationId}, ${r.speakerId},
            ${r.embedding === null ? null : JSON.stringify(r.embedding)}::jsonb, ${r.groupId})
    ON CONFLICT (conversation_id, speaker_id) DO UPDATE SET
      embedding = EXCLUDED.embedding, group_id = EXCLUDED.group_id`);
}

export async function setVoiceClusterGroups(
  sql: Sql,
  groups: { conversationId: string; speakerId: number; groupId: string }[]
): Promise<void> {
  for (const g of groups) {
    await withTimeout(sql`
      UPDATE voice_clusters SET group_id = ${g.groupId}
      WHERE conversation_id = ${g.conversationId} AND speaker_id = ${g.speakerId}`);
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/capture/store.ts
git commit -m "feat(capture): store speaker embeddings for unmatched clusters

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Record embeddings at capture time

Keeps the empty-gallery bail (`src/lib/capture/pipeline.ts:174`). The bail only fires while no person has a voiceprint, so this covers every session after the first enrollment; the backlog before it is Task 11's job.

**Files:**
- Modify: `src/lib/capture/pipeline.ts` (`identifySpeakers` ~156-202, `transcribeSession` ~204-225)

**Interfaces:**
- Consumes: `upsertVoiceCluster` (Task 8).
- Produces: `identifySpeakers` now returns `{ segments, unmatchedSpeakers, unmatchedEmbeddings: Map<number, number[]> }`.

- [ ] **Step 1: Return the embeddings instead of dropping them**

In `identifySpeakers`, widen the return type to include `unmatchedEmbeddings: Map<number, number[]>`. Both early returns yield an empty Map — including the empty-gallery bail, which stays exactly as it is:

```ts
  // Nobody is enrolled yet, so every cluster is unmatched by definition. Bail
  // before the model load and one inference per cluster — compute that cannot
  // change the answer. Deliberately kept even though it means these clusters
  // reach voice_clusters only via the backfill: it fires only until the first
  // voice is named, so the gap it leaves is a bounded, one-time backlog rather
  // than a standing cost on every session (see the spec's Decisions table).
  if (gallery.length === 0) {
    return { segments, unmatchedSpeakers: clusters.map((c) => c.speakerId), unmatchedEmbeddings: new Map() };
  }
```

In the per-cluster loop, record the embedding on the unmatched branch — it is already computed, so this is a write, not new compute:

```ts
      } else {
        unmatchedSpeakers.push(cluster.speakerId);
        unmatchedEmbeddings.set(cluster.speakerId, embedding);
      }
```

Declare `const unmatchedEmbeddings = new Map<number, number[]>();` beside `unmatchedSpeakers`, and add it to the final return.

- [ ] **Step 2: Persist them in `transcribeSession`**

`identifySpeakers` does not know the conversation id — it is minted in the returned row — so the write happens in `transcribeSession`, which has both. Replace the `const { segments: identified, unmatchedSpeakers } = await identifySpeakers(...)` line and the return with:

```ts
  const { segments: identified, unmatchedSpeakers, unmatchedEmbeddings } = await identifySpeakers(
    sql,
    segments,
    assembled,
    s.startedAtMs
  );
  const id = randomUUID();

  // Best-effort: a failed cluster write costs a backfill later, never the
  // transcript. Nothing downstream reads these during this call.
  for (const [speakerId, embedding] of unmatchedEmbeddings) {
    try {
      await store.upsertVoiceCluster(sql, { conversationId: id, speakerId, embedding, groupId: null });
    } catch (e) {
      console.error(`voice cluster write failed for speaker ${speakerId}:`, e);
    }
  }

  return {
    id,
    source: "trace",
    // …the rest of the existing object literal, unchanged, with `id: randomUUID()` removed
```

- [ ] **Step 3: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint && npm test`
Expected: clean; all existing capture tests pass.

No unit test here — `identifySpeakers` takes a live `sql` and loads the WavLM model, and this repo mocks neither (see Global Constraints). It is verified by the type-check plus the Phase 3 manual check in Task 13.

- [ ] **Step 4: Commit**

```bash
git add src/lib/capture/pipeline.ts
git commit -m "feat(capture): keep the embedding of an unmatched speaker

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Clustering function

**Files:**
- Create: `src/lib/capture/cluster.ts`
- Test: `test/capture-cluster.test.mts`

**Interfaces:**
- Consumes: `cosineSimilarity` from `src/lib/capture/identify.ts`.
- Produces:
  - `interface ClusterItem { key: string; embedding: number[] | null }`
  - `clusterEmbeddings(items: ClusterItem[], threshold: number): Record<string, string>` — maps each item key to its group id.
  - `voiceKey(conversationId: string, speakerId: number): string` returning `` `${conversationId}:${speakerId}` ``.

- [ ] **Step 1: Write the failing tests**

Create `test/capture-cluster.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterEmbeddings, voiceKey } from "../src/lib/capture/cluster.ts";

const A = [1, 0, 0];
const A2 = [0.99, 0.14, 0];   // ~0.99 cosine with A
const B = [0, 1, 0];
const B2 = [0.14, 0.99, 0];   // ~0.99 cosine with B

test("voiceKey joins a conversation and speaker", () => {
  assert.equal(voiceKey("c1", 2), "c1:2");
});

test("similar embeddings share a group, dissimilar ones do not", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c2:0", embedding: B },
      { key: "c3:2", embedding: A2 },
      { key: "c4:1", embedding: B2 },
    ],
    0.85
  );
  assert.equal(groups["c1:1"], groups["c3:2"]);
  assert.equal(groups["c2:0"], groups["c4:1"]);
  assert.notEqual(groups["c1:1"], groups["c2:0"]);
});

test("a group is named for its earliest member", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c3:2", embedding: A2 },
    ],
    0.85
  );
  assert.equal(groups["c1:1"], "c1:1");
  assert.equal(groups["c3:2"], "c1:1");
});

test("a below-threshold pair stays separate", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c2:0", embedding: A2 },
    ],
    0.999
  );
  assert.notEqual(groups["c1:1"], groups["c2:0"]);
});

test("a null embedding is its own group and never absorbs anyone", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: null },
      { key: "c2:0", embedding: null },
      { key: "c3:2", embedding: A },
    ],
    0.85
  );
  assert.equal(groups["c1:1"], "c1:1");
  assert.equal(groups["c2:0"], "c2:0");
  assert.equal(groups["c3:2"], "c3:2");
});

test("a bridging member merges two groups under the earliest name", () => {
  const mid = [0.7, 0.72, 0];
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c2:0", embedding: B },
      { key: "c3:2", embedding: mid },
    ],
    0.65
  );
  assert.equal(groups["c1:1"], "c1:1");
  assert.equal(groups["c2:0"], "c1:1");
  assert.equal(groups["c3:2"], "c1:1");
});

test("adding a member to an existing set keeps the earlier group id stable", () => {
  const first = clusterEmbeddings([{ key: "c1:1", embedding: A }], 0.85);
  const second = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c9:0", embedding: A2 },
    ],
    0.85
  );
  assert.equal(second["c1:1"], first["c1:1"]);
  assert.equal(second["c9:0"], first["c1:1"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/capture-cluster.test.mts`
Expected: FAIL — cannot resolve `../src/lib/capture/cluster.ts`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/capture/cluster.ts`:

```ts
import { cosineSimilarity } from "./identify";

export interface ClusterItem {
  key: string;
  /** null = unembeddable; it gets a group of its own and joins no other. */
  embedding: number[] | null;
}

export function voiceKey(conversationId: string, speakerId: number): string {
  return `${conversationId}:${speakerId}`;
}

/**
 * Greedy single-link clustering over cosine similarity: an item joins any group
 * containing a member it is similar enough to, and bridges two groups into one
 * when it is similar to both.
 *
 * Order-dependent by nature, so the caller must pass items in a stable order
 * (conversation date) — a group is a review convenience, not stored identity,
 * and the identity is the Person created when the user names the group.
 *
 * A group is named for its earliest member, so ids stay stable as later
 * conversations join an existing group.
 */
export function clusterEmbeddings(items: ClusterItem[], threshold: number): Record<string, string> {
  const groups: { id: string; members: ClusterItem[] }[] = [];

  for (const item of items) {
    if (!item.embedding) {
      groups.push({ id: item.key, members: [item] });
      continue;
    }
    const hits = groups.filter((g) =>
      g.members.some(
        (m) =>
          m.embedding !== null &&
          m.embedding.length === item.embedding!.length &&
          cosineSimilarity(m.embedding, item.embedding!) >= threshold
      )
    );
    if (hits.length === 0) {
      groups.push({ id: item.key, members: [item] });
      continue;
    }
    // Keep the earliest group's id and fold the rest into it.
    const [keep, ...merged] = hits;
    keep.members.push(item);
    for (const g of merged) {
      keep.members.push(...g.members);
      groups.splice(groups.indexOf(g), 1);
    }
  }

  const out: Record<string, string> = {};
  for (const g of groups) for (const m of g.members) out[m.key] = g.id;
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/capture-cluster.test.mts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture/cluster.ts test/capture-cluster.test.mts
git commit -m "feat(capture): cluster unmatched voices by cosine similarity

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: The backfill route

**Files:**
- Create: `src/app/api/capture/cluster-voices/route.ts`
- Modify: `src/lib/capture/pipeline.ts` (add the `voiceGroupThreshold` env reader beside the existing ones at line 37)

**Interfaces:**
- Consumes: Task 8's accessors; Task 10's `clusterEmbeddings`/`voiceKey`; `assembleSessionAudio`, `extractSpeakerPcm`, `int16ToFloat32`, `embedAudio`, `groupBySpeaker`.
- Produces: `POST /api/capture/cluster-voices` with body `{ voices: { conversationId: string; speakerId: number }[]; maxConversations?: number }` → `{ processed: number; remaining: number; groups: Record<string, string> }`. `processed` and `remaining` count **distinct conversations**.

- [ ] **Step 1: Add the threshold reader**

In `src/lib/capture/pipeline.ts`, beside `voiceMatchThreshold` at line 37:

```ts
// Grouping is deliberately stricter than matching: a false match mislabels one
// conversation, a false group makes the user answer for two people at once.
export const voiceGroupThreshold = () =>
  envNumber("CAPTURE_VOICE_GROUP_THRESHOLD", 0.85, (v) => v > 0 && v <= 1);
```

Export `voiceMatchThreshold` the same way — Task 15 needs it.

- [ ] **Step 2: Write the route**

Create `src/app/api/capture/cluster-voices/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/kv";
import {
  ensureCaptureSchemaOnce,
  getSessionByConversationId,
  getConversationRow,
  getVoiceClusters,
  upsertVoiceCluster,
  setVoiceClusterGroups,
  type VoiceClusterRow,
} from "@/lib/capture/store";
import { assembleSessionAudio, voiceGroupThreshold } from "@/lib/capture/pipeline";
import { groupBySpeaker, extractSpeakerPcm, int16ToFloat32 } from "@/lib/capture/identify";
import { embedAudio } from "@/lib/capture/embed";
import { clusterEmbeddings, voiceKey, type ClusterItem } from "@/lib/capture/cluster";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

/** Two conversations per call: one audio assembly plus one inference per
 *  speaker each, comfortably inside the 300s ceiling with headroom for a cold
 *  model load. The client loops until `remaining` is 0. */
const DEFAULT_MAX_CONVERSATIONS = 2;

interface Voice {
  conversationId: string;
  speakerId: number;
}

interface Body {
  voices: Voice[];
  maxConversations?: number;
}

function isBody(v: unknown): v is Body {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.voices)) return false;
  return r.voices.every(
    (x) =>
      !!x &&
      typeof x === "object" &&
      typeof (x as Voice).conversationId === "string" &&
      Number.isInteger((x as Voice).speakerId)
  );
}

/** Backfills embeddings for unrecognized voices captured before anyone was
 *  enrolled (identifySpeakers bails before the model when the gallery is
 *  empty), then groups every submitted voice so one recurring person is one
 *  review card instead of N. Batched and explicitly triggered: this is the
 *  most expensive thing in the app, and it must never run on page load.
 *
 *  Unauthenticated for the same reasons as /api/capture/enroll-voice, and with
 *  the same per-instance single-flight guard over the same kind of exposure —
 *  unauthenticated compute. */
let clusterInFlight = false;

export async function POST(req: NextRequest) {
  if (clusterInFlight) {
    return NextResponse.json({ error: "Grouping is already running — try again in a moment." }, { status: 429 });
  }
  clusterInFlight = true;
  try {
    return await handle(req);
  } finally {
    clusterInFlight = false;
  }
}

async function handle(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isBody(body)) {
    return NextResponse.json({ error: "expected { voices: [{ conversationId, speakerId }] }" }, { status: 400 });
  }

  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const wanted = new Map(body.voices.map((v) => [voiceKey(v.conversationId, v.speakerId), v]));
    const conversationIds = [...new Set(body.voices.map((v) => v.conversationId))];
    const existing = await getVoiceClusters(sql, conversationIds);
    const known = new Map(existing.map((r) => [voiceKey(r.conversationId, r.speakerId), r]));

    // Conversations still owing at least one embedding, oldest first so the
    // client's loop makes deterministic progress across calls.
    const owing = [...new Set([...wanted.values()].filter((v) => !known.has(voiceKey(v.conversationId, v.speakerId))).map((v) => v.conversationId))];
    const rows = await Promise.all(owing.map((id) => getConversationRow(sql, id)));
    const byCreated = owing
      .map((id, i) => ({ id, createdAt: rows[i]?.created_at ?? "" }))
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .map((x) => x.id);

    const limit = Math.max(1, Math.min(body.maxConversations ?? DEFAULT_MAX_CONVERSATIONS, 5));
    const batch = byCreated.slice(0, limit);

    for (const conversationId of batch) {
      const speakers = [...wanted.values()]
        .filter((v) => v.conversationId === conversationId && !known.has(voiceKey(conversationId, v.speakerId)))
        .map((v) => v.speakerId);

      const [session, conversation] = await Promise.all([
        getSessionByConversationId(sql, conversationId),
        getConversationRow(sql, conversationId),
      ]);

      // No session or no conversation means no audio to embed — ever. Record
      // that as a null embedding so the loop stops retrying it forever.
      if (!session || !conversation) {
        for (const speakerId of speakers) {
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
        }
        continue;
      }

      // The assembly is the expensive half, so it is paid once per
      // conversation and reused for every speaker in it.
      const { assembled } = await assembleSessionAudio(sql, session);
      const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];

      for (const speakerId of speakers) {
        let embedding: number[] | null = null;
        try {
          const cluster = groupBySpeaker(
            segments.filter((s) => s.speaker_id === speakerId).map((s) => ({ ...s, text: "" }))
          )[0];
          if (cluster) {
            embedding = await embedAudio(int16ToFloat32(extractSpeakerPcm(assembled, session.startedAtMs, cluster)));
          }
        } catch (e) {
          console.error(`backfill embed failed for ${conversationId}:${speakerId}:`, e);
        }
        const row: VoiceClusterRow = { conversationId, speakerId, embedding, groupId: null };
        await upsertVoiceCluster(sql, row);
        known.set(voiceKey(conversationId, speakerId), row);
      }
    }

    // Cluster everything the client asked about, in conversation-date order so
    // group ids stay stable between calls.
    const items: ClusterItem[] = [...wanted.keys()]
      .map((key) => ({ key, row: known.get(key) }))
      .filter((x) => !!x.row)
      .map((x) => ({ key: x.key, embedding: x.row!.embedding }));

    const groups = clusterEmbeddings(items, voiceGroupThreshold());
    await setVoiceClusterGroups(
      sql,
      Object.entries(groups).map(([key, groupId]) => {
        const v = wanted.get(key)!;
        return { conversationId: v.conversationId, speakerId: v.speakerId, groupId };
      })
    );

    return NextResponse.json({
      processed: batch.length,
      remaining: Math.max(0, byCreated.length - batch.length),
      groups,
    });
  } catch (err) {
    console.error("cluster-voices failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

`ConversationRow.created_at` is a `string` (`src/lib/capture/rows.ts:6`), so the ISO `localeCompare` sort above orders conversations oldest-first correctly.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/capture/cluster-voices/route.ts src/lib/capture/pipeline.ts
git commit -m "feat(capture): batched backfill and grouping for unrecognized voices

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `voiceGroupId` on the pending record

**Files:**
- Modify: `src/lib/people.ts` (`PendingSuggestion` at line 44; a new mutator beside `removePending`)

**Interfaces:**
- Consumes: the file's existing `readMap`, `writeMap`, `pruneTombstones`, `isPendingRecord`.
- Produces: `PendingSuggestion.voiceGroupId?: string` and `setVoiceGroups(entries: { id: string; groupId: string }[]): void`.

- [ ] **Step 1: Add the field**

In `PendingSuggestion`, after `speakerId`:

```ts
  /** Set only for kind: "voice", and only once grouping has run. Cards sharing
   *  a value are the same voice and are reviewed as one. Absent means
   *  ungrouped — which is every record predating this field. */
  voiceGroupId?: string;
```

`isPendingRecord` needs no change: a missing group is a valid record.

- [ ] **Step 2: Add the batched mutator**

Beside `removePending`:

```ts
/** One write for the whole batch. Grouping assigns a value to every voice card
 *  at once, and this namespace re-serializes wholesale on every write and
 *  schedules a push — 44 individual writes would be 44 of both. */
export function setVoiceGroups(entries: { id: string; groupId: string }[]): void {
  if (entries.length === 0) return;
  const map = pruneTombstones(readMap<PendingSuggestion | Tombstone>(PENDING_NS));
  let changed = false;
  for (const { id, groupId } of entries) {
    const cur = map[id];
    if (!isPendingRecord(cur)) continue;
    if (cur.voiceGroupId === groupId) continue;
    map[id] = { ...cur, voiceGroupId: groupId, timestamp: new Date().toISOString() };
    changed = true;
  }
  if (changed) writeMap(PENDING_NS, map);
}
```

- [ ] **Step 3: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

No unit test — this module reads `localStorage` and the suite has no stub for it (see Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add src/lib/people.ts
git commit -m "feat(people): tag a voice suggestion with its group

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: The grouping button and its loop

**Files:**
- Modify: `src/app/people/page.tsx` (Review header, near the "Add all N" block at lines 612-625)

**Interfaces:**
- Consumes: `setVoiceGroups` (Task 12); `fetchJson`; the route from Task 11.
- Produces: no new exports. Establishes `groupingNote` / `groupingBusy` state that Task 14 renders around.

- [ ] **Step 1: Add the state and the loop**

Beside the other handlers in the page component:

```ts
const [groupingBusy, setGroupingBusy] = useState(false);
const [groupingNote, setGroupingNote] = useState<string | null>(null);

const ungroupedVoices = pending.filter((s) => s.kind === "voice" && !s.voiceGroupId);

/** Walks the backfill route until it reports nothing left. Deliberately manual:
 *  one audio assembly per conversation plus one inference per speaker is the
 *  most expensive thing in this app, and it must never start on its own. */
const runVoiceGrouping = async () => {
  const voices = pending
    .filter((s) => s.kind === "voice" && typeof s.speakerId === "number")
    .map((s) => ({ conversationId: s.conversationId, speakerId: s.speakerId!, id: s.id }));
  if (voices.length === 0) return;

  setGroupingBusy(true);
  setGroupingNote("Grouping voices…");
  const byKey = new Map(voices.map((v) => [`${v.conversationId}:${v.speakerId}`, v.id]));
  let total = 0;

  try {
    for (;;) {
      const res = await fetchJson<{ processed: number; remaining: number; groups: Record<string, string> }>(
        "/api/capture/cluster-voices",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voices: voices.map(({ conversationId, speakerId }) => ({ conversationId, speakerId })) }),
        }
      );

      setVoiceGroups(
        Object.entries(res.groups)
          .map(([key, groupId]) => ({ id: byKey.get(key), groupId }))
          .filter((e): e is { id: string; groupId: string } => !!e.id)
      );
      refresh();

      total += res.processed;
      if (res.remaining === 0) break;
      setGroupingNote(`Grouping voices — ${total} of ${total + res.remaining} conversations…`);
    }
    setGroupingNote("Voices grouped.");
  } catch (e) {
    setGroupingNote(e instanceof Error ? e.message : "Couldn’t finish grouping — try again.");
  } finally {
    setGroupingBusy(false);
  }
};
```

Add `setVoiceGroups` to the existing `@/lib/people` import.

- [ ] **Step 2: Add the button**

In the Review section, directly after the `confidentMatches.length > 1` card:

```tsx
{ungroupedVoices.length > 1 && (
  <div className="card p-4 mb-3 flex flex-wrap items-center justify-between gap-3">
    <p className="text-sm text-slate-200">
      <strong className="font-semibold">{ungroupedVoices.length}</strong> unrecognized voices.
      Group them and the same person across conversations becomes one card.
    </p>
    <button onClick={runVoiceGrouping} disabled={groupingBusy} className={`${BUTTON_PRIMARY} py-2 px-4 disabled:opacity-50`}>
      {groupingBusy ? "Grouping…" : "Group similar voices"}
    </button>
  </div>
)}
{groupingNote && (
  <p role="status" className="text-sm text-slate-300 mb-3">{groupingNote}</p>
)}
```

The button disappears once every voice card has a group. It shows in local dev but the first call returns 503 ("store not configured"), which surfaces in `groupingNote` — acceptable, and consistent with how the page's other store-backed actions behave in dev.

- [ ] **Step 3: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: clean.

Manual check on a preview deploy: press "Group similar voices" with several voice cards pending. The note counts conversations upward, the button stays disabled throughout, and when it finishes every voice card has a `voiceGroupId` (check via `localStorage.getItem("omi-people-pending")` in the console). Pressing it again is a no-op — the button is gone.

- [ ] **Step 4: Commit**

```bash
git add src/app/people/page.tsx
git commit -m "feat(people): opt-in backfill that groups unrecognized voices

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 14: One card per group

**Files:**
- Modify: `src/app/people/page.tsx` (the `pending.map` at lines 628-661)
- Modify: `src/components/VoicePendingCard.tsx`

**Interfaces:**
- Consumes: `PendingSuggestion.voiceGroupId` (Task 12).
- Produces: `VoicePendingCard` gains a required `members: PendingSuggestion[]` prop (the group, longest-sample first, `[suggestion]` when ungrouped); `onAcceptExisting` / `onAcceptNew` / `onIgnore` now act on the whole group.

- [ ] **Step 1: Bucket the pending list**

Above the `pending.map(...)` in the Review section:

```ts
/** One card per voice, not per conversation. An ungrouped card is its own
 *  bucket, so this is a no-op until grouping has run. The representative is
 *  the most recent member, so the evidence shown is the freshest sample. */
const voiceGroups = useMemo(() => {
  const buckets = new Map<string, PendingSuggestion[]>();
  for (const s of pending) {
    if (s.kind !== "voice") continue;
    const key = s.voiceGroupId ?? s.id;
    buckets.set(key, [...(buckets.get(key) ?? []), s]);
  }
  return buckets;
}, [pending]);

const reviewRows = useMemo(() => {
  const seen = new Set<string>();
  const rows: { key: string; suggestion: PendingSuggestion; members: PendingSuggestion[] }[] = [];
  for (const s of pending) {
    if (s.kind !== "voice") {
      rows.push({ key: s.id, suggestion: s, members: [s] });
      continue;
    }
    const key = s.voiceGroupId ?? s.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const members = voiceGroups.get(key) ?? [s];
    rows.push({ key, suggestion: members[0], members });
  }
  return rows;
}, [pending, voiceGroups]);
```

`pending` is already sorted newest-first by `getPending`, so `members[0]` is the most recent member and the rows keep the queue's existing order.

- [ ] **Step 2: Render from `reviewRows` and act on whole groups**

Replace `{pending.map((s) => ...)}` with `{reviewRows.map(({ key, suggestion: s, members }) => ...)}`, keeping both branches. In the voice branch, pass `key={key}`, `members={members}`, and group-aware handlers:

```tsx
onAcceptExisting={(id) => acceptVoiceGroupInto(members, id)}
onAcceptNew={(name) => acceptVoiceGroupAsNew(members, name)}
onIgnore={() => ignoreVoiceGroup(members)}
```

Add the three handlers beside the existing voice handlers:

```ts
/** Enrolls once, from the most recent member. Enrolling from all N would mean
 *  N audio assemblies for one tap; picking the *longest* sample instead would
 *  mean fetching every member's transcript just to measure it, which is work
 *  on a path that must stay free. Most-recent is known for nothing, is the
 *  sample the user is most likely to have just heard, and averageEmbeddings
 *  strengthens the print on every later conversation anyway.
 *
 *  `getPending` sorts newest-first and the buckets preserve that order, so
 *  members[0] is the most recent. Nothing is removed unless the enrollment
 *  actually succeeded. */
const acceptVoiceGroupInto = async (members: PendingSuggestion[], personId: string) => {
  const lead = members[0];
  const ok = await acceptVoiceInto(lead, personId);
  if (!ok) return;
  for (const m of members) if (m.id !== lead.id) removePending(m.id);
  refresh();
};

const acceptVoiceGroupAsNew = async (members: PendingSuggestion[], name: string) => {
  const lead = members[0];
  const before = new Set(getPending().map((p) => p.id));
  await acceptVoiceAsNew(lead, name);
  // acceptVoiceAsNew removes its own suggestion only on success; if it is gone
  // the enrollment landed and the rest of the group is the same voice.
  if (getPending().some((p) => p.id === lead.id)) return;
  for (const m of members) if (before.has(m.id) && m.id !== lead.id) removePending(m.id);
  refresh();
};

const ignoreVoiceGroup = (members: PendingSuggestion[]) => {
  for (const m of members) removePending(m.id);
  offerUndo(
    members.length === 1 ? "Voice ignored." : `${members.length} cards ignored.`,
    () => {
      for (const m of members) restorePending(m);
      refresh();
    }
  );
  refresh();
};
```

Task 15 adds the post-enrollment sibling sweep and wires it into both handlers.
Do **not** add a placeholder for it here — this task must contain no dead code,
and it is complete and reviewable without one.

- [ ] **Step 3: Render the group in the card**

In `src/components/VoicePendingCard.tsx`, add `members: PendingSuggestion[]` to the props type and change the header:

```tsx
<div className="mb-2">
  <div className="text-white font-medium">
    {members.length > 1 ? `This voice · ${members.length} conversations` : "Unrecognized voice"}
  </div>
  <div className="text-slate-400 text-xs">{getAnalysisAge(s.date).label}</div>
</div>
```

And under the evidence block, when the group has more than one member:

```tsx
{members.length > 1 && (
  <p className="text-slate-400 text-xs mb-3 break-words">
    Naming this voice resolves all {members.length} cards.
  </p>
)}
```

- [ ] **Step 4: Verify**

Run: `npm run build && npm run lint && npm test`
Expected: clean.

Manual check on a preview deploy, after running the grouping from Task 13: a grouped card reads "This voice · N conversations", naming it removes all N at once, and Ignore removes all N with a working undo. An ungrouped card is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/app/people/page.tsx src/components/VoicePendingCard.tsx
git commit -m "feat(people): review one recurring voice as a single card

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 15: Sibling sweep after enrollment

**Files:**
- Create: `src/app/api/capture/rematch-voices/route.ts`
- Modify: `src/app/people/page.tsx` (replace the `sweepMatchedVoices` stub from Task 14)

**Interfaces:**
- Consumes: `getVoiceClusters` (Task 8); `voiceKey` (Task 10); `bestMatch`, `cosineSimilarity` (`identify.ts`); `voiceMatchThreshold` (exported in Task 11); `getNamespaceData` (`kv.ts`).
- Produces: `POST /api/capture/rematch-voices` with body `{ voices: { conversationId, speakerId }[] }` → `{ matched: { conversationId: string; speakerId: number; personId: string }[] }`.

- [ ] **Step 1: Write the route**

Create `src/app/api/capture/rematch-voices/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getVoiceClusters } from "@/lib/capture/store";
import { bestMatch } from "@/lib/capture/identify";
import { voiceMatchThreshold } from "@/lib/capture/pipeline";
import { voiceKey } from "@/lib/capture/cluster";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 60;

interface Voice {
  conversationId: string;
  speakerId: number;
}

function isBody(v: unknown): v is { voices: Voice[] } {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.voices) &&
    r.voices.every(
      (x) =>
        !!x &&
        typeof x === "object" &&
        typeof (x as Voice).conversationId === "string" &&
        Number.isInteger((x as Voice).speakerId)
    )
  );
}

/** After a voice is named, the cards that were also that voice are no longer
 *  unrecognized. This compares their stored embeddings against the freshly
 *  updated gallery and reports the ones that now match — no audio, no model,
 *  just cosine over rows that already exist, so it is cheap enough to run on
 *  every enrollment. Voices with no stored embedding are simply absent from
 *  the result: the sweep is an optimization, not a correctness requirement. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isBody(body)) {
    return NextResponse.json({ error: "expected { voices: [{ conversationId, speakerId }] }" }, { status: 400 });
  }

  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const raw = (await getNamespaceData(sql, "omi-people")) as Record<string, unknown> | null;
    const gallery: { personId: string; embedding: number[] }[] = [];
    for (const [id, v] of Object.entries(raw ?? {})) {
      if (id.startsWith("__") || !v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      if ("deleted" in r || typeof r.name !== "string") continue;
      if (Array.isArray(r.voicePrint)) gallery.push({ personId: id, embedding: r.voicePrint as number[] });
    }
    if (gallery.length === 0) return NextResponse.json({ matched: [] });

    const wanted = new Map(body.voices.map((v) => [voiceKey(v.conversationId, v.speakerId), v]));
    const rows = await getVoiceClusters(sql, [...new Set(body.voices.map((v) => v.conversationId))]);
    const threshold = voiceMatchThreshold();

    const matched: { conversationId: string; speakerId: number; personId: string }[] = [];
    for (const row of rows) {
      const key = voiceKey(row.conversationId, row.speakerId);
      if (!wanted.has(key) || !row.embedding) continue;
      const hit = bestMatch(row.embedding, gallery, threshold);
      if (hit) matched.push({ conversationId: row.conversationId, speakerId: row.speakerId, personId: hit.personId });
    }

    return NextResponse.json({ matched });
  } catch (err) {
    console.error("rematch-voices failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 2: Add the sweep and call it from both group handlers**

In `src/app/people/page.tsx`, add this beside the voice handlers from Task 14:

```ts
/** Cards that are now recognizable because of the enrollment that just landed.
 *  Removed with an undo, matching how acceptAllConfident handles bulk
 *  resolution — a sweep that silently clears cards the user never saw resolved
 *  needs a way back. A failure here is silent: the cards simply stay, which is
 *  the state the app was already in. */
const sweepMatchedVoices = async () => {
  const voices = getPending()
    .filter((s) => s.kind === "voice" && typeof s.speakerId === "number")
    .map((s) => ({ conversationId: s.conversationId, speakerId: s.speakerId!, id: s.id, record: s }));
  if (voices.length === 0) return;

  let matched: { conversationId: string; speakerId: number }[] = [];
  try {
    const res = await fetchJson<{ matched: { conversationId: string; speakerId: number }[] }>(
      "/api/capture/rematch-voices",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voices: voices.map(({ conversationId, speakerId }) => ({ conversationId, speakerId })) }),
      }
    );
    matched = res.matched;
  } catch {
    return;
  }

  const keys = new Set(matched.map((m) => `${m.conversationId}:${m.speakerId}`));
  const cleared = voices.filter((v) => keys.has(`${v.conversationId}:${v.speakerId}`));
  if (cleared.length === 0) return;

  for (const c of cleared) removePending(c.id);
  setBatchResult(
    `Also cleared ${cleared.length} ${cleared.length === 1 ? "card" : "cards"} that were the same voice.`
  );
  offerUndo(`Cleared ${cleared.length} matching ${cleared.length === 1 ? "card" : "cards"}.`, () => {
    for (const c of cleared) restorePending(c.record);
    setBatchResult(null);
    refresh();
  });
  refresh();
};
```

Then add the call to both group-accept handlers, immediately before their
closing `refresh()`:

```ts
  for (const m of members) if (m.id !== lead.id) removePending(m.id);
  await sweepMatchedVoices();
  refresh();
};
```

in `acceptVoiceGroupInto`, and:

```ts
  for (const m of members) if (before.has(m.id) && m.id !== lead.id) removePending(m.id);
  await sweepMatchedVoices();
  refresh();
};
```

in `acceptVoiceGroupAsNew`. `ignoreVoiceGroup` does not sweep — ignoring a
voice enrolls nothing, so no other card's status can have changed.

- [ ] **Step 3: Verify**

Run: `npm run build && npx tsc --noEmit && npm run lint && npm test`
Expected: clean.

Manual check on a preview deploy: with grouping already run, name one voice. Any remaining card whose stored embedding matches the new voiceprint disappears, the status line reports how many, and the undo restores them.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/capture/rematch-voices/route.ts src/app/people/page.tsx
git commit -m "feat(people): clear the cards a new enrollment already answers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npm test` — all suites pass, including the four new files (`voice-evidence`, `voice-evidence-cache`, `capture-clip`, `capture-cluster`).
- [ ] `npm run build && npx tsc --noEmit && npm run lint` — clean.
- [ ] `git status` — clean tree. If `AGENTS.md` was regenerated by `next dev`, commit it with the work rather than reverting it (see `AGENTS.md`).
- [ ] On a preview deploy, walk the Review queue end to end: evidence renders, a clip plays and replays, grouping collapses the queue, naming a group resolves it and sweeps its siblings, and undo works on both bulk paths.
- [ ] Then use `superpowers:finishing-a-development-branch` to merge, and clean up the local and origin branches afterwards.
