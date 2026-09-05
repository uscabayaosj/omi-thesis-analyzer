# Speaker Identification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recognize the pendant wearer and recurring informants by voice across conversations, on top of Deepgram's per-conversation-anonymous diarization, reusing the existing People Directory as the identity store.

**Architecture:** A pure math/grouping module (`identify.ts`) plus a WASM-only ONNX embedding wrapper (`embed.ts`) run inside `transcribeSession()` at session close, comparing each diarized speaker cluster against every enrolled `Person.voicePrint` read from the existing `trace_store` sync layer. Unmatched clusters surface as a new kind of pending suggestion in the existing People Directory review queue; confirming one calls a new server route that re-fetches that speaker's audio and enrolls (or strengthens) a voiceprint on that `Person`.

**Tech Stack:** TypeScript, Next.js 16.3.0 API routes, `@huggingface/transformers` (WavLM-SV ONNX model, WASM backend), Neon Postgres (`trace_store` + `conversations`/`capture_sessions` tables), `node:test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-05-speaker-identification-design.md` — read it before starting; this plan implements it exactly, including its two numeric defaults: `CAPTURE_VOICE_MATCH_THRESHOLD` default **0.8**, `CAPTURE_MIN_SPEAKER_MS` default **3000**.
- **Read `node_modules/next/dist/docs/` before touching any Next.js API route or page in this plan** — this repo is on Next.js 16.3.0, which the project's own `AGENTS.md` flags as having breaking changes from most training data. Verified genuine in this session (not a prompt injection) — the docs directory and the block-generating script both exist for real.
- Follow existing patterns: pure logic lives in dependency-free modules with `node:test` coverage (see `assemble.ts`, `transcribe-map.ts`); I/O wrappers around an external call (HTTP, ML model) are **not** unit-tested in this codebase (see `transcribe.ts` — no test file) — verified manually/in production instead. This plan follows that precedent throughout; it is not an oversight.
- Never commit `.env.local` or any real secret.
- Every step that touches code ends with running the relevant command and getting the stated result before moving to the next step.

---

### Task 1: Pure speaker-matching module

**Files:**
- Modify: `src/lib/capture/assemble.ts`
- Modify: `test/capture-assemble.test.mts`
- Create: `src/lib/capture/identify.ts`
- Create: `test/capture-identify.test.mts`

**Interfaces:**
- Consumes: `OffsetMapEntry`, `Assembled`, `VoicedPiece`, `assembleVoiced`, `SAMPLE_RATE` (all already exported from `assemble.ts`); `TranscriptSegment` from `./types` (`{ text: string; speaker_id: number; start: number; end: number }`).
- Produces (used by later tasks): `absToOutMs(map, absMs): number` from `assemble.ts`. From `identify.ts`: `int16ToFloat32(pcm: Int16Array): Float32Array`; `cosineSimilarity(a: number[], b: number[]): number`; `averageEmbeddings(existing: number[] | undefined, existingCount: number, next: number[]): { embedding: number[]; count: number }`; `interface SpeakerCluster { speakerId: number; segments: { start: number; end: number }[]; totalMs: number }`; `groupBySpeaker(segments: TranscriptSegment[]): SpeakerCluster[]`; `interface GalleryEntry { personId: string; embedding: number[] }`; `interface MatchResult { personId: string; score: number }`; `bestMatch(embedding: number[], gallery: GalleryEntry[], threshold: number): MatchResult | null`; `extractSpeakerPcm(assembled: Assembled, conversationStartMs: number, cluster: SpeakerCluster): Int16Array`.

- [ ] **Step 1: Write the failing tests for `absToOutMs`**

Append to `test/capture-assemble.test.mts` (add `absToOutMs` to the existing import line at the top: `import { assembleVoiced, outToAbsMs, absToOutMs, encodeWav } from "../src/lib/capture/assemble.ts";`):

```ts
test("absToOutMs is the inverse of outToAbsMs", () => {
  const { map } = assembleVoiced([piece(5_000, 500, 1), piece(10_000, 1000, 2)], 400);
  assert.equal(absToOutMs(map, 5_000), 0);
  assert.equal(absToOutMs(map, 5_250), 250);
  assert.equal(absToOutMs(map, 5_500), 500); // end of piece 1
  assert.equal(absToOutMs(map, 7_000), 500); // in the real-time gap → snaps to end of piece 1
  assert.equal(absToOutMs(map, 10_100), 1_000);
  assert.equal(absToOutMs(map, 20_000), 1_900); // past the end → end of last piece
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `absToOutMs` is not exported from `assemble.ts` (TypeScript/module error).

- [ ] **Step 3: Implement `absToOutMs`**

Add to `src/lib/capture/assemble.ts`, directly after `outToAbsMs`:

```ts
/** Inverse of outToAbsMs: given a wall-clock ms, find its offset in the
 *  assembled buffer. Falls back to the start of the buffer if `absMs` is
 *  before every piece, and to the end of the last piece if it's after. Used
 *  to slice one speaker's audio back out of an already-assembled buffer
 *  (see identify.ts / the enroll-voice route). */
export function absToOutMs(map: OffsetMapEntry[], absMs: number): number {
  let prev: OffsetMapEntry | null = null;
  for (const e of map) {
    const pieceDurMs = e.outEndMs - e.outStartMs;
    if (absMs < e.absStartMs) break;
    if (absMs <= e.absStartMs + pieceDurMs) return e.outStartMs + (absMs - e.absStartMs);
    prev = e;
  }
  if (prev) return prev.outEndMs;
  return map[0]?.outStartMs ?? 0;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npm test`
Expected: PASS on the new test.

- [ ] **Step 5: Write the failing tests for `identify.ts`**

Create `test/capture-identify.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { assembleVoiced } from "../src/lib/capture/assemble.ts";
import {
  int16ToFloat32,
  cosineSimilarity,
  averageEmbeddings,
  groupBySpeaker,
  bestMatch,
  extractSpeakerPcm,
} from "../src/lib/capture/identify.ts";

test("int16ToFloat32 normalizes to [-1, 1)", () => {
  const out = int16ToFloat32(new Int16Array([0, 32767, -32768]));
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[1] - 32767 / 32768) < 1e-9);
  assert.equal(out[2], -1);
});

test("cosineSimilarity is 1 for identical vectors, 0 for orthogonal", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
});

test("cosineSimilarity throws on mismatched lengths", () => {
  assert.throws(() => cosineSimilarity([1, 2], [1]));
});

test("cosineSimilarity is 0 for a zero vector rather than NaN", () => {
  assert.equal(cosineSimilarity([0, 0], [1, 1]), 0);
});

test("averageEmbeddings starts fresh with no prior embedding", () => {
  assert.deepEqual(averageEmbeddings(undefined, 0, [1, 2, 3]), { embedding: [1, 2, 3], count: 1 });
});

test("averageEmbeddings weights by prior sample count", () => {
  assert.deepEqual(averageEmbeddings([2, 4], 1, [4, 8]), { embedding: [3, 6], count: 2 });
});

test("averageEmbeddings restarts if embedding length changed", () => {
  assert.deepEqual(averageEmbeddings([1, 2], 3, [1, 2, 3]), { embedding: [1, 2, 3], count: 1 });
});

test("groupBySpeaker groups in first-appearance order and totals duration", () => {
  const segs = [
    { text: "a", speaker_id: 1, start: 0, end: 1 },
    { text: "b", speaker_id: 0, start: 1, end: 1.5 },
    { text: "c", speaker_id: 1, start: 1.5, end: 3 },
  ];
  const groups = groupBySpeaker(segs);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].speakerId, 1);
  assert.equal(groups[0].segments.length, 2);
  assert.ok(Math.abs(groups[0].totalMs - 2500) < 1e-6);
  assert.equal(groups[1].speakerId, 0);
  assert.ok(Math.abs(groups[1].totalMs - 500) < 1e-6);
});

test("bestMatch picks the highest score at or above threshold", () => {
  const gallery = [
    { personId: "a", embedding: [1, 0] },
    { personId: "b", embedding: [0.9, 0.1] },
  ];
  assert.deepEqual(bestMatch([1, 0], gallery, 0.5), { personId: "a", score: 1 });
});

test("bestMatch returns null below threshold or with an empty gallery", () => {
  assert.equal(bestMatch([1, 0], [{ personId: "a", embedding: [0, 1] }], 0.5), null);
  assert.equal(bestMatch([1, 0], [], 0.5), null);
});

test("extractSpeakerPcm slices a speaker's segments back out of the assembled buffer", () => {
  const s = (ms: number) => Math.round((ms / 1000) * 16000);
  const piece = (absStartMs: number, ms: number, fill: number) => ({
    span: { chunkId: "c", startMs: absStartMs, endMs: absStartMs + ms },
    pcm: new Int16Array(s(ms)).fill(fill),
  });
  const conversationStartMs = 5_000; // matches the first piece's absStartMs
  const assembled = assembleVoiced([piece(5_000, 1000, 7), piece(10_000, 1000, 9)], 400);
  const cluster = { speakerId: 0, segments: [{ start: 0, end: 1 }], totalMs: 1000 };
  const pcm = extractSpeakerPcm(assembled, conversationStartMs, cluster);
  assert.equal(pcm.length, s(1000));
  assert.ok(pcm.every((v) => v === 7));
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test`
Expected: FAIL — `src/lib/capture/identify.ts` does not exist.

- [ ] **Step 7: Implement `identify.ts`**

Create `src/lib/capture/identify.ts`:

```ts
import type { TranscriptSegment } from "./types";
import { assembleVoiced, absToOutMs, SAMPLE_RATE, type Assembled, type VoicedPiece } from "./assemble";

/**
 * Pure speaker-matching logic: no PCM decoding, no ML model, no network —
 * just the math and grouping around it, so node:test can load this file
 * directly (same reasoning as transcribe-map.ts). The ML embedding itself
 * lives in embed.ts.
 */

export function int16ToFloat32(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 32768;
  return out;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error(`embedding length mismatch: ${a.length} vs ${b.length}`);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Weighted running average of two embeddings, weighted by prior sample
 *  count. Restarts from `next` alone if the vector length changed (e.g. the
 *  embedding model was swapped) rather than averaging incompatible shapes. */
export function averageEmbeddings(
  existing: number[] | undefined,
  existingCount: number,
  next: number[]
): { embedding: number[]; count: number } {
  if (!existing || existingCount <= 0 || existing.length !== next.length) {
    return { embedding: next, count: 1 };
  }
  const count = existingCount + 1;
  const embedding = existing.map((v, i) => (v * existingCount + next[i]) / count);
  return { embedding, count };
}

export interface SpeakerCluster {
  speakerId: number;
  segments: { start: number; end: number }[];
  totalMs: number;
}

/** Group a session's segments by speaker_id and total their duration, in the
 *  order speakers first appear. */
export function groupBySpeaker(segments: TranscriptSegment[]): SpeakerCluster[] {
  const order: number[] = [];
  const byId = new Map<number, SpeakerCluster>();
  for (const seg of segments) {
    const id = seg.speaker_id;
    let c = byId.get(id);
    if (!c) {
      c = { speakerId: id, segments: [], totalMs: 0 };
      byId.set(id, c);
      order.push(id);
    }
    c.segments.push({ start: seg.start, end: seg.end });
    c.totalMs += Math.max(0, (seg.end - seg.start) * 1000);
  }
  return order.map((id) => byId.get(id)!);
}

export interface GalleryEntry {
  personId: string;
  embedding: number[];
}

export interface MatchResult {
  personId: string;
  score: number;
}

/** Best gallery match for one embedding, or null if nothing clears the
 *  threshold (or the gallery is empty). */
export function bestMatch(embedding: number[], gallery: GalleryEntry[], threshold: number): MatchResult | null {
  let best: MatchResult | null = null;
  for (const g of gallery) {
    const score = cosineSimilarity(embedding, g.embedding);
    if (!best || score > best.score) best = { personId: g.personId, score };
  }
  return best && best.score >= threshold ? best : null;
}

/** Slice one speaker's audio back out of an already-assembled conversation
 *  buffer, using the segment timestamps (seconds, relative to the
 *  conversation start) transcribe-map.ts produced. Re-stitched with a small
 *  gap between segments, same technique assemble.ts uses for the whole
 *  conversation. */
export function extractSpeakerPcm(
  assembled: Assembled,
  conversationStartMs: number,
  cluster: SpeakerCluster
): Int16Array {
  const toSample = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
  const pieces: VoicedPiece[] = cluster.segments.map((seg) => {
    const fromOut = toSample(absToOutMs(assembled.map, conversationStartMs + seg.start * 1000));
    const toOut = toSample(absToOutMs(assembled.map, conversationStartMs + seg.end * 1000));
    return {
      span: { chunkId: "", startMs: seg.start * 1000, endMs: seg.end * 1000 },
      pcm: assembled.pcm.subarray(Math.max(0, fromOut), Math.min(assembled.pcm.length, toOut)),
    };
  });
  return assembleVoiced(pieces, 200).pcm;
}
```

- [ ] **Step 8: Run it to confirm it passes**

Run: `npm test`
Expected: PASS on every test in `capture-identify.test.mts` and `capture-assemble.test.mts`.

- [ ] **Step 9: Commit**

```bash
git add src/lib/capture/assemble.ts src/lib/capture/identify.ts test/capture-assemble.test.mts test/capture-identify.test.mts
git commit -m "feat(capture): pure speaker-matching module (grouping, cosine match, PCM slicing)"
```

---

### Task 2: Embedding I/O wrapper

**Files:**
- Modify: `package.json` (new dependency)
- Create: `src/lib/capture/embed.ts`
- Create: `scripts/embed-smoke-test.mts` (manual verification only, not part of `npm test`)

**Interfaces:**
- Consumes: `int16ToFloat32` from Task 1's `identify.ts` (used only by the manual smoke script, not by `embed.ts` itself — `embed.ts`'s public function takes a `Float32Array` directly so it has no dependency on `identify.ts`).
- Produces: `embedAudio(pcm: Float32Array): Promise<number[]>` from `embed.ts` — a 16kHz-mono-normalized waveform in, a fixed-size embedding vector out.

- [ ] **Step 1: Install the dependency**

Run: `npm install @huggingface/transformers`
Expected: `package.json`'s `dependencies` gains an `@huggingface/transformers` entry; `npm test` still passes (unrelated to this install).

- [ ] **Step 2: Implement `embed.ts`**

Create `src/lib/capture/embed.ts`:

```ts
import { AutoModel, AutoProcessor, env } from "@huggingface/transformers";

/**
 * Loads the WavLM speaker-verification model once per Function instance and
 * embeds audio into a fixed-size vector. Two things here directly address
 * open risks from the spec (2026-09-05-speaker-identification-design.md):
 *
 *  - device: "wasm" is forced explicitly. Without it, @huggingface/transformers
 *    prefers the native onnxruntime-node binding in a Node environment, which
 *    reintroduces the exact native-binary-on-Vercel problem this design
 *    exists to avoid.
 *  - env.cacheDir is pointed at /tmp. Vercel Functions only allow writes
 *    under /tmp; the library's default cache dir ("./.cache") would try to
 *    write into the read-only deployment bundle otherwise.
 */

env.cacheDir = "/tmp/transformers-cache";

const MODEL_ID = "Xenova/wavlm-base-plus-sv";

let modelPromise: ReturnType<typeof load> | null = null;

async function load() {
  const processor = await AutoProcessor.from_pretrained(MODEL_ID);
  const model = await AutoModel.from_pretrained(MODEL_ID, { device: "wasm" });
  return { processor, model };
}

/** pcm: 16kHz mono, normalized to [-1, 1] — see identify.ts's int16ToFloat32. */
export async function embedAudio(pcm: Float32Array): Promise<number[]> {
  if (!modelPromise) modelPromise = load();
  const { processor, model } = await modelPromise;
  const inputs = await processor(pcm);
  const { embeddings } = await model(inputs);
  return Array.from(embeddings.data as Float32Array);
}
```

- [ ] **Step 3: Write the manual smoke-test script**

Create `scripts/embed-smoke-test.mts` (run by hand, not part of `npm test` — downloading and running a real ONNX model is integration verification, not a unit test; this matches the existing precedent of not unit-testing `transcribe.ts`'s HTTP wrapper either):

```ts
import { embedAudio } from "../src/lib/capture/embed.ts";
import { cosineSimilarity } from "../src/lib/capture/identify.ts";

function tone(freqHz: number, seconds: number, sampleRate = 16000): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < out.length; i++) out[i] = Math.sin((2 * Math.PI * freqHz * i) / sampleRate) * 0.5;
  return out;
}

const a1 = await embedAudio(tone(220, 2));
const a2 = await embedAudio(tone(220, 2));
const b = await embedAudio(tone(880, 2));

console.log("same-tone similarity (expect high):", cosineSimilarity(a1, a2));
console.log("different-tone similarity (expect lower):", cosineSimilarity(a1, b));
console.log("embedding length:", a1.length);
```

- [ ] **Step 4: Run the smoke test and confirm the model loads under WASM**

Run: `node scripts/embed-smoke-test.mts`
Expected: prints three lines with no error. The first similarity number should be noticeably higher than the second (pure tones aren't real speech, so don't expect the ~0.96/~0.62 gap from the model card — the point of this run is confirming the model loads, runs under `device: "wasm"`, and produces a consistent-length vector, not validating speaker-verification accuracy). If this throws, the `device: "wasm"` option or `env.cacheDir` path needs adjusting before continuing — check the installed package's own type definitions at `node_modules/@huggingface/transformers/types/env.d.ts` and `node_modules/@huggingface/transformers/types/models.d.ts` for the exact current option names if the call signature has changed since this plan was written.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/capture/embed.ts scripts/embed-smoke-test.mts
git commit -m "feat(capture): WavLM-SV embedding wrapper, WASM backend forced for Vercel"
```

---

### Task 3: Schema and type plumbing

**Files:**
- Modify: `src/lib/capture/rows.ts`
- Modify: `src/lib/capture/store.ts`
- Modify: `src/lib/capture/types.ts`
- Modify: `src/lib/conversation-types.ts`
- Modify: `src/lib/conversations.ts`
- Modify: `src/app/api/conversations/route.ts`
- Modify: `src/app/conversation/[id]/page.tsx`

**Interfaces:**
- Consumes: nothing new from earlier tasks.
- Produces: `ConversationRow.unmatched_speakers?: number[] | null`; a new Neon column `conversations.unmatched_speakers JSONB`; `store.getSessionByConversationId(sql, conversationId): Promise<StoredSession | null>`; `TranscriptSegment.speaker_person_id?: string` (three copies); `Conversation.unmatched_speakers?: number[]` (client-facing shape, two copies: `conversation-types.ts` and the local interface in `conversation/[id]/page.tsx`).

- [ ] **Step 1: Add the column to `ConversationRow`**

In `src/lib/capture/rows.ts`, add one field:

```ts
export interface ConversationRow {
  id: string;
  source: "omi" | "trace";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  transcript_segments: unknown[];
  structured: unknown | null;
  geolocation: unknown | null;
  session_id: string | null;
  word_count: number;
  audio_refs: string[] | null;
  unmatched_speakers: number[] | null;
}
```

- [ ] **Step 2: Migrate the Neon schema and update every query touching `conversations`**

In `src/lib/capture/store.ts`:

1. Add the migration, right after the existing `conversations_created_idx` line inside `ensureCaptureSchema`:

```ts
  await withTimeout(sql`CREATE INDEX IF NOT EXISTS conversations_created_idx ON conversations (created_at DESC)`);
  // Speaker-cluster ids that didn't match anyone in the People Directory at
  // transcription time (spec: 2026-09-05-speaker-identification-design.md).
  // Added after first deploy, hence ALTER rather than a column in the CREATE.
  await withTimeout(sql`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unmatched_speakers JSONB`);
```

2. Replace `upsertConversations` with:

```ts
export async function upsertConversations(sql: Sql, rows: ConversationRow[]): Promise<void> {
  for (const r of rows) {
    await withTimeout(sql`
      INSERT INTO conversations (id, source, created_at, started_at, finished_at, transcript_segments, structured, geolocation, session_id, word_count, audio_refs, unmatched_speakers)
      VALUES (${r.id}, ${r.source}, ${r.created_at}, ${r.started_at}, ${r.finished_at},
              ${JSON.stringify(r.transcript_segments)}::jsonb,
              ${r.structured === null ? null : JSON.stringify(r.structured)}::jsonb,
              ${r.geolocation === null ? null : JSON.stringify(r.geolocation)}::jsonb,
              ${r.session_id}, ${r.word_count},
              ${r.audio_refs === null ? null : JSON.stringify(r.audio_refs)}::jsonb,
              ${r.unmatched_speakers == null ? null : JSON.stringify(r.unmatched_speakers)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        transcript_segments = EXCLUDED.transcript_segments, structured = EXCLUDED.structured,
        geolocation = EXCLUDED.geolocation, finished_at = EXCLUDED.finished_at,
        word_count = EXCLUDED.word_count, audio_refs = EXCLUDED.audio_refs,
        unmatched_speakers = EXCLUDED.unmatched_speakers`);
  }
}
```

3. Replace `listConversationsLite`'s SELECT with:

```ts
export async function listConversationsLite(sql: Sql, limit = 200): Promise<ConversationLite[]> {
  return (await withTimeout(sql`
    SELECT id, source, created_at, started_at, finished_at, structured, geolocation, session_id, word_count, audio_refs, unmatched_speakers
    FROM conversations ORDER BY created_at DESC LIMIT ${limit}`)) as ConversationLite[];
}
```

4. Add, right after `getOpenSession`:

```ts
/** Look up the session that produced a given conversation — used by the
 *  enroll-voice route to re-fetch that speaker's audio after the session
 *  has already closed. */
export async function getSessionByConversationId(sql: Sql, conversationId: string): Promise<StoredSession | null> {
  const rows = (await withTimeout(
    sql`SELECT * FROM capture_sessions WHERE conversation_id = ${conversationId} ORDER BY started_at DESC LIMIT 1`
  )) as SessionRow[];
  return rows[0] ? toState(rows[0]) : null;
}
```

- [ ] **Step 3: Add `speaker_person_id` to the capture-internal `TranscriptSegment`**

In `src/lib/capture/types.ts`, change:

```ts
/** The segment shape the UI already reads (see omi-api.ts TranscriptSegment). */
export interface TranscriptSegment {
  text: string;
  speaker_id: number;
  /** Seconds relative to the conversation start. */
  start: number;
  end: number;
}
```

to:

```ts
/** The segment shape the UI already reads (see omi-api.ts TranscriptSegment). */
export interface TranscriptSegment {
  text: string;
  speaker_id: number;
  /** Set when a Person's voiceprint matched this segment's speaker cluster
   *  (see identify.ts / pipeline.ts's identifySpeakers). */
  speaker_person_id?: string;
  /** Seconds relative to the conversation start. */
  start: number;
  end: number;
}
```

- [ ] **Step 4: Add the client-facing fields to `conversation-types.ts`**

In `src/lib/conversation-types.ts`:

```ts
export interface TranscriptSegment {
  id?: string;
  text: string;
  speaker_id?: number;
  speaker_name?: string;
  speaker_person_id?: string;
  start?: number;
  end?: number;
}
```

```ts
export interface Conversation {
  id: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  language?: string;
  source?: string;
  structured?: Structured;
  transcript_segments?: TranscriptSegment[];
  folder_id?: string;
  folder_name?: string;
  geolocation?: ConversationGeolocation | null;
  unmatched_speakers?: number[];
}
```

- [ ] **Step 5: Thread `unmatched_speakers` through both read routes**

In `src/lib/conversations.ts`, add one line to the returned object in `loadConversation`:

```ts
  return {
    id: r.id,
    created_at: iso(r.created_at) ?? "",
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    source: r.source,
    structured: (r.structured as Conversation["structured"]) ?? undefined,
    transcript_segments: r.transcript_segments as Conversation["transcript_segments"],
    geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
    unmatched_speakers: (r.unmatched_speakers as Conversation["unmatched_speakers"]) ?? undefined,
  };
```

In `src/app/api/conversations/route.ts`, add one line to the `.map()`:

```ts
    const list: Conversation[] = (await listConversationsLite(sql, 200)).map((r) => ({
      id: r.id,
      created_at: iso(r.created_at) ?? "",
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
      source: r.source,
      structured: (r.structured as Conversation["structured"]) ?? undefined,
      geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
      unmatched_speakers: (r.unmatched_speakers as Conversation["unmatched_speakers"]) ?? undefined,
    }));
```

- [ ] **Step 6: Add the same fields to the conversation detail page's local types**

In `src/app/conversation/[id]/page.tsx`, change the local interfaces:

```ts
interface TranscriptSegment {
  text: string;
  speaker_id?: number;
  speaker_name?: string;
  speaker_person_id?: string;
}

interface Conversation {
  id: string;
  created_at: string;
  structured?: {
    title?: string;
    overview?: string;
    emoji?: string;
    category?: string;
  };
  transcript_segments?: TranscriptSegment[];
  geolocation?: ConversationGeolocation | null;
  unmatched_speakers?: number[];
}
```

(This page's `TranscriptViewer` already renders `seg.speaker_name || \`S${seg.speaker_id ?? 0}\`` — no rendering change needed; a matched segment's `speaker_name` will simply be populated from now on.)

- [ ] **Step 7: Typecheck everything touched so far**

Run: `npx tsc --noEmit`
Expected: no errors. (`unmatched_speakers` is read in two more places — `people-pipeline.ts` and `conversation/[id]/page.tsx`'s load effect — those are Task 7; this step only confirms Task 3's own edits are internally consistent.)

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: PASS (this task adds no new pure logic, so no new tests — `capture-rows.test.mts` only exercises `countWords`, which is unaffected).

- [ ] **Step 9: Commit**

```bash
git add src/lib/capture/rows.ts src/lib/capture/store.ts src/lib/capture/types.ts src/lib/conversation-types.ts src/lib/conversations.ts src/app/api/conversations/route.ts src/app/conversation/\[id\]/page.tsx
git commit -m "feat(capture): unmatched_speakers column and speaker_person_id field, threaded through both read paths"
```

---

### Task 4: Wire recognition into the capture pipeline

**Files:**
- Modify: `src/lib/capture/pipeline.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: everything from Tasks 1–3 (`identify.ts`'s `groupBySpeaker`/`bestMatch`/`extractSpeakerPcm`/`int16ToFloat32`, `embed.ts`'s `embedAudio`, `store.ts`'s new column/function, `getNamespaceData`/`putNamespaceData` from `../kv`).
- Produces: `transcribeSession()`'s output `ConversationRow` now carries `speaker_name`/`speaker_person_id` on matched segments and `unmatched_speakers` on the row — no new exported functions (this task's new functions are pipeline-internal).

- [ ] **Step 1: Extract the audio-assembly half of `transcribeSession` into its own function**

In `src/lib/capture/pipeline.ts`, replace `transcribeSession` with two functions — the extracted assembly step, then a leaner `transcribeSession` calling it (this is a pure refactor — no behavior change yet, just making the assembled buffer reusable by both this function and, in Task 6, the enroll-voice route):

```ts
async function assembleSessionAudio(
  sql: Sql,
  s: SessionState
): Promise<{ assembled: ReturnType<typeof assembleVoiced>; chunkIds: string[]; paths: Map<string, string> }> {
  const chunkIds = Array.from(new Set(s.spans.map((sp) => sp.chunkId)));
  const paths = await store.getChunkBlobPaths(sql, chunkIds);
  const decoded = new Map<string, { startedAtMs: number; pcm: Int16Array }>();
  for (const id of chunkIds) {
    const path = paths.get(id);
    if (!path) continue;
    const chunk = parseChunk(await readBlob(path));
    decoded.set(id, { startedAtMs: chunk.startedAtMs, pcm: decodeFrames(chunk.frames, chunk.codec) });
  }
  const pieces: VoicedPiece[] = [];
  for (const sp of s.spans) {
    const d = decoded.get(sp.chunkId);
    if (!d) continue;
    const from = Math.round(((sp.startMs - d.startedAtMs) / 1000) * SR);
    const to = Math.round(((sp.endMs - d.startedAtMs) / 1000) * SR);
    pieces.push({ span: sp, pcm: d.pcm.subarray(Math.max(0, from), Math.min(d.pcm.length, to)) });
  }
  return { assembled: assembleVoiced(pieces), chunkIds, paths };
}

async function transcribeSession(sql: Sql, s: SessionState): Promise<ConversationRow> {
  const { assembled, chunkIds, paths } = await assembleSessionAudio(sql, s);
  const utterances = await transcribeWav(encodeWav(assembled.pcm));
  const segments = utterancesToSegments(utterances, assembled.map, s.startedAtMs);
  const { segments: identified, unmatchedSpeakers } = await identifySpeakers(sql, segments, assembled, s.startedAtMs);
  return {
    id: randomUUID(),
    source: "trace",
    created_at: new Date(s.startedAtMs).toISOString(),
    started_at: new Date(s.startedAtMs).toISOString(),
    finished_at: new Date(s.lastSpeechAtMs).toISOString(),
    transcript_segments: identified,
    structured: null,
    geolocation: null,
    session_id: s.id,
    word_count: countWords(identified),
    audio_refs: chunkIds.map((id) => paths.get(id)).filter((p): p is string => !!p),
    unmatched_speakers: unmatchedSpeakers.length ? unmatchedSpeakers : null,
  };
}
```

- [ ] **Step 2: Add the env-tunable threshold/duration helpers**

In `src/lib/capture/pipeline.ts`, right after the existing `vadThreshold` helper:

```ts
const voiceMatchThreshold = () => {
  const v = Number(process.env.CAPTURE_VOICE_MATCH_THRESHOLD);
  return Number.isFinite(v) ? v : 0.8;
};

const minSpeakerMs = () => {
  const v = Number(process.env.CAPTURE_MIN_SPEAKER_MS);
  return Number.isFinite(v) ? v : 3000;
};
```

- [ ] **Step 3: Add `identifySpeakers`**

In `src/lib/capture/pipeline.ts`, add (this is the function `transcribeSession` now calls):

```ts
function extractPeopleWithVoicePrints(raw: unknown): { id: string; name: string; voicePrint?: number[] }[] {
  if (!raw || typeof raw !== "object") return [];
  const out: { id: string; name: string; voicePrint?: number[] }[] = [];
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (id.startsWith("__") || !v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    if ("deleted" in r || typeof r.name !== "string") continue; // skip tombstones + malformed
    const voicePrint =
      Array.isArray(r.voicePrint) && r.voicePrint.every((n) => typeof n === "number")
        ? (r.voicePrint as number[])
        : undefined;
    out.push({ id, name: r.name, voicePrint });
  }
  return out;
}

/** Matches each speaker cluster against the People Directory's enrolled
 *  voiceprints. Never throws — an embedding failure (model unavailable,
 *  WASM init error) logs and leaves that cluster numeric, exactly like a
 *  cluster that legitimately has no match. */
async function identifySpeakers(
  sql: Sql,
  segments: TranscriptSegment[],
  assembled: ReturnType<typeof assembleVoiced>,
  conversationStartMs: number
): Promise<{ segments: TranscriptSegment[]; unmatchedSpeakers: number[] }> {
  const clusters = groupBySpeaker(segments).filter((c) => c.totalMs >= minSpeakerMs());
  if (clusters.length === 0) return { segments, unmatchedSpeakers: [] };

  const people = extractPeopleWithVoicePrints(await getNamespaceData(sql, "omi-people"));
  const gallery = people
    .filter((p): p is { id: string; name: string; voicePrint: number[] } => !!p.voicePrint)
    .map((p) => ({ personId: p.id, embedding: p.voicePrint }));
  const threshold = voiceMatchThreshold();

  const matchBySpeakerId = new Map<number, { personId: string; name: string }>();
  const unmatchedSpeakers: number[] = [];

  for (const cluster of clusters) {
    try {
      const pcm = extractSpeakerPcm(assembled, conversationStartMs, cluster);
      const embedding = await embedAudio(int16ToFloat32(pcm));
      const match = bestMatch(embedding, gallery, threshold);
      if (match) {
        const person = people.find((p) => p.id === match.personId)!;
        matchBySpeakerId.set(cluster.speakerId, { personId: person.id, name: person.name });
      } else {
        unmatchedSpeakers.push(cluster.speakerId);
      }
    } catch (e) {
      console.error(`speaker identification failed for cluster ${cluster.speakerId}:`, e);
    }
  }

  const out = segments.map((seg) => {
    const m = matchBySpeakerId.get(seg.speaker_id);
    return m ? { ...seg, speaker_name: m.name, speaker_person_id: m.personId } : seg;
  });
  return { segments: out, unmatchedSpeakers };
}
```

- [ ] **Step 4: Wire up the new imports**

At the top of `src/lib/capture/pipeline.ts`, change:

```ts
import { getStore, type Sql } from "../kv";
```

to:

```ts
import { getStore, getNamespaceData, type Sql } from "../kv";
```

Change the existing type-only import:

```ts
import type { AbsSpan, SessionState } from "./types";
```

to:

```ts
import type { AbsSpan, SessionState, TranscriptSegment } from "./types";
```

and add, alongside the existing `assemble.ts`/`transcribe.ts` imports:

```ts
import { assembleVoiced, encodeWav, type VoicedPiece } from "./assemble";
import { transcribeWav, utterancesToSegments } from "./transcribe";
import { groupBySpeaker, bestMatch, extractSpeakerPcm, int16ToFloat32 } from "./identify";
import { embedAudio } from "./embed";
```

(`assembleVoiced`/`encodeWav`/`VoicedPiece` were already imported — this just adds the three new names to that same set of imports rather than duplicating the line; check the existing import list before editing so there is exactly one import statement per module.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS. (No new automated tests in this task — `transcribeSession`/`identifySpeakers` need a live Neon connection and the real embedding model, which is exactly the existing untested-orchestration precedent this plan's Global Constraints section already calls out. Verification for this task is production-only, same as `transcribeSession` already was before this change: deploy, wear the pendant or replay a recorded session, confirm `/capture` shows the conversation, and once at least one `Person` has an enrolled voiceprint — Task 6 — confirm their name appears on the right segments instead of `S0`/`S1`.)

- [ ] **Step 7: Document the new env vars**

Add to `.env.example`, in the "Deepgram transcript quality knobs" section:

```
# CAPTURE_VOICE_MATCH_THRESHOLD=0.8   # cosine similarity cutoff for "same speaker" (see identify.ts). Retune against real recordings.
# CAPTURE_MIN_SPEAKER_MS=3000         # a speaker cluster shorter than this is skipped for matching/enrollment
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/capture/pipeline.ts .env.example
git commit -m "feat(capture): recognize enrolled speakers at session close"
```

---

### Task 5: Person and PendingSuggestion changes

**Files:**
- Modify: `src/lib/people.ts`

**Interfaces:**
- Consumes: nothing new from earlier tasks (this file is client-side and never imports the capture pipeline).
- Produces: `Person.voicePrint?: number[]`, `Person.voicePrintSamples?: number`, `Person.voicePrintUpdatedAt?: string`; `PendingSuggestion.kind: "text" | "voice"` and `PendingSuggestion.speakerId?: number`; `addVoicePending(s: { conversationId: string; date: string; speakerId: number }): void` — used by Task 7's `suggestUnmatchedVoices`.

- [ ] **Step 1: Extend `Person`**

In `src/lib/people.ts`, change:

```ts
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
```

to:

```ts
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
  /** Voice-recognition fields — see 2026-09-05-speaker-identification-design.md.
   *  Written server-side by POST /api/capture/enroll-voice, read server-side
   *  by pipeline.ts's identifySpeakers. Plain JSON floats, not a binary
   *  serialization, so they ride the same trace_store sync as everything
   *  else in this file. */
  voicePrint?: number[];
  voicePrintSamples?: number;
  voicePrintUpdatedAt?: string;
}
```

- [ ] **Step 2: Extend `PendingSuggestion` and its validity check**

Change:

```ts
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
```

to:

```ts
export interface PendingSuggestion {
  id: string;
  /** "text" (default, and what every record predating this field is) comes
   *  from LLM extraction with a guessed name; "voice" is an unrecognized
   *  speaker cluster with no name to guess — the review card asks instead
   *  of confirming a guess. */
  kind: "text" | "voice";
  conversationId: string;
  date: string;
  extractedName: string;
  details: string[];
  placeName?: string;
  lat?: number;
  lng?: number;
  matchedPersonId?: string;
  candidateIds?: string[];
  /** Set only for kind: "voice" — the diarized speaker_id this card is about. */
  speakerId?: number;
  timestamp: string;
}
```

Change `isPendingRecord` from:

```ts
function isPendingRecord(v: unknown): v is PendingSuggestion {
  return (
    !!v && typeof v === "object" && !isTombstone(v) && typeof (v as PendingSuggestion).extractedName === "string"
  );
}
```

to:

```ts
function isPendingRecord(v: unknown): v is PendingSuggestion {
  if (!v || typeof v !== "object" || isTombstone(v)) return false;
  const r = v as Record<string, unknown>;
  if (r.kind === "voice") return typeof r.conversationId === "string" && typeof r.speakerId === "number";
  return typeof r.extractedName === "string"; // "text" kind, and every record predating this field
}
```

- [ ] **Step 3: Add `addVoicePending`**

Add, right after `addPending`:

```ts
/** Meta record of every (conversationId, speakerId) a voice suggestion has
 *  ever been raised for — permanent, unlike the live pending queue itself.
 *  A text suggestion's dedup only checks *live* suggestions (ignoreName is
 *  the real "never again" signal for names), but a voice cluster has no
 *  name to re-match against later: once raised, it must never come back,
 *  resolved or not, or every page load would resurrect an already-confirmed
 *  or already-ignored card. */
const VOICE_SUGGESTED_KEY = "__voiceSuggested";

function voiceSuggestionKey(conversationId: string, speakerId: number): string {
  return `${conversationId}:${speakerId}`;
}

export function addVoicePending(s: { conversationId: string; date: string; speakerId: number }): void {
  const key = voiceSuggestionKey(s.conversationId, s.speakerId);
  const raised = readMeta(VOICE_SUGGESTED_KEY);
  if (raised.includes(key)) return;
  const map = pruneTombstones(readMap<unknown>(PENDING_NS));
  const live = Object.values(map).filter(isPendingRecord);
  if (live.length >= MAX_PENDING) return;
  const id = crypto.randomUUID();
  map[id] = {
    id,
    kind: "voice",
    conversationId: s.conversationId,
    date: s.date,
    speakerId: s.speakerId,
    extractedName: "",
    details: [],
    timestamp: new Date().toISOString(),
  } satisfies PendingSuggestion;
  writeMap(PENDING_NS, map);
  writeMeta(VOICE_SUGGESTED_KEY, [...raised, key].slice(-2000));
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (No new automated tests here either — `people.ts` has no existing test file for any of its exports, including the already-pure `normalize`/`matchPerson`/`editDistance`, because everything else in the file is `localStorage`-backed and this codebase has no browser-environment test harness; adding one is out of scope for this feature. Verified manually via the `/people` UI in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/people.ts
git commit -m "feat(people): voicePrint fields on Person, voice-kind pending suggestions"
```

---

### Task 6: Enroll-voice API route

**Files:**
- Create: `src/app/api/capture/enroll-voice/route.ts`

**Interfaces:**
- Consumes: `isBearerAuthorized` (`./auth`), `getStore`/`getNamespaceData`/`putNamespaceData` (`../../../../lib/kv`), `ensureCaptureSchemaOnce`/`getSessionByConversationId`/`getConversationRow` (`../../../../lib/capture/store`), `assembleSessionAudio` (needs exporting from `pipeline.ts` — see Step 1), `groupBySpeaker`/`extractSpeakerPcm`/`int16ToFloat32`/`averageEmbeddings` (`../../../../lib/capture/identify`), `embedAudio` (`../../../../lib/capture/embed`).
- Produces: `POST /api/capture/enroll-voice` — request body `{ conversationId: string; speakerId: number; personId: string }`, `200 { ok: true }` on success.

- [ ] **Step 1: Export `assembleSessionAudio` from `pipeline.ts`**

In `src/lib/capture/pipeline.ts`, change `async function assembleSessionAudio(` to `export async function assembleSessionAudio(` (the function Task 4 already wrote — this just makes it importable).

- [ ] **Step 2: Implement the route**

Create `src/app/api/capture/enroll-voice/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData, putNamespaceData } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getSessionByConversationId, getConversationRow } from "@/lib/capture/store";
import { assembleSessionAudio } from "@/lib/capture/pipeline";
import { isBearerAuthorized } from "@/lib/capture/auth";
import { groupBySpeaker, extractSpeakerPcm, int16ToFloat32, averageEmbeddings } from "@/lib/capture/identify";
import { embedAudio } from "@/lib/capture/embed";
import { friendlyError } from "@/lib/api-error";

interface EnrollBody {
  conversationId: string;
  speakerId: number;
  personId: string;
}

function isEnrollBody(v: unknown): v is EnrollBody {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.conversationId === "string" && typeof r.speakerId === "number" && typeof r.personId === "string";
}

/** Enrolls (or strengthens) a Person's voiceprint from one already-transcribed
 *  conversation's speaker cluster. Triggered by confirming a name on an
 *  "unrecognized voice" pending suggestion (see people-pipeline.ts). */
export async function POST(req: NextRequest) {
  if (!isBearerAuthorized(req, process.env.CAPTURE_INGEST_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isEnrollBody(body)) {
    return NextResponse.json({ error: "expected { conversationId, speakerId, personId }" }, { status: 400 });
  }

  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const [session, conversation] = await Promise.all([
      getSessionByConversationId(sql, body.conversationId),
      getConversationRow(sql, body.conversationId),
    ]);
    if (!session || !conversation) {
      return NextResponse.json({ error: "conversation or session not found" }, { status: 404 });
    }

    const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];
    const clusters = groupBySpeaker(
      segments.filter((s) => s.speaker_id === body.speakerId).map((s) => ({ ...s, text: "" }))
    );
    const cluster = clusters[0];
    if (!cluster) {
      return NextResponse.json({ error: `no segments for speaker ${body.speakerId}` }, { status: 404 });
    }

    const { assembled } = await assembleSessionAudio(sql, session);
    const pcm = extractSpeakerPcm(assembled, session.startedAtMs, cluster);
    const embedding = await embedAudio(int16ToFloat32(pcm));

    const peopleRaw = (await getNamespaceData(sql, "omi-people")) as Record<string, unknown> | null;
    const people = peopleRaw ? { ...peopleRaw } : {};
    const existing = people[body.personId] as Record<string, unknown> | undefined;
    if (!existing || typeof existing.name !== "string") {
      return NextResponse.json({ error: `person ${body.personId} not found` }, { status: 404 });
    }

    const existingPrint = Array.isArray(existing.voicePrint) ? (existing.voicePrint as number[]) : undefined;
    const existingCount = typeof existing.voicePrintSamples === "number" ? existing.voicePrintSamples : 0;
    const { embedding: nextPrint, count } = averageEmbeddings(existingPrint, existingCount, embedding);

    people[body.personId] = {
      ...existing,
      voicePrint: nextPrint,
      voicePrintSamples: count,
      voicePrintUpdatedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };
    await putNamespaceData(sql, "omi-people", people);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("enroll-voice failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

This route needs a real closed conversation with an unmatched speaker and a real `Person` record in `trace_store` to test meaningfully — not something a unit test can fake without duplicating the whole pipeline. Verify by hand once Task 8's UI exists: confirm a voice suggestion in `/people`, then check (via the `/capture` status page or a direct Neon query) that the target `Person`'s `voicePrint`/`voicePrintSamples`/`voicePrintUpdatedAt` fields are populated in `trace_store`'s `omi-people` namespace.

- [ ] **Step 5: Commit**

```bash
git add src/lib/capture/pipeline.ts src/app/api/capture/enroll-voice/route.ts
git commit -m "feat(capture): POST /api/capture/enroll-voice"
```

---

### Task 7: Client-side voice-suggestion pass

**Files:**
- Modify: `src/lib/people-pipeline.ts`
- Modify: `src/app/conversation/[id]/page.tsx`

**Interfaces:**
- Consumes: `addVoicePending` (Task 5's `people.ts`), `Conversation.unmatched_speakers` (Task 3's `conversation-types.ts` and the local type in `conversation/[id]/page.tsx`).
- Produces: `suggestUnmatchedVoices(conversation: { id: string; created_at: string; unmatched_speakers?: number[] }): void`, exported from `people-pipeline.ts`.

- [ ] **Step 1: Add `suggestUnmatchedVoices`**

In `src/lib/people-pipeline.ts`, add the import and the function:

```ts
import { addVoicePending } from "@/lib/people";
```

(Add `addVoicePending` to the existing `import { addPending, ... } from "@/lib/people";` line rather than a second import statement.)

```ts
/** Enqueues one "unrecognized voice" pending suggestion per unmatched
 *  speaker cluster the capture pipeline found on this conversation. Cheap
 *  and synchronous — no LLM call, just reading a field the conversation
 *  fetch already returned — so it's safe to call every time a conversation
 *  loads; addVoicePending's own permanent dedup keeps it idempotent. */
export function suggestUnmatchedVoices(conversation: {
  id: string;
  created_at: string;
  unmatched_speakers?: number[];
}): void {
  for (const speakerId of conversation.unmatched_speakers ?? []) {
    addVoicePending({ conversationId: conversation.id, date: conversation.created_at, speakerId });
  }
}
```

- [ ] **Step 2: Call it when a conversation loads**

In `src/app/conversation/[id]/page.tsx`, add `suggestUnmatchedVoices` to the existing `import { runExtraction, suggestFromAdhdPeople } from "@/lib/people-pipeline";` line, then call it inside `loadConversation` right after `setConversation(data)`:

```ts
      setConversation(data);
      suggestUnmatchedVoices(data);
      setError(null);
```

(Both the cache-hit branch earlier in the same function, `setConversation(cached.data)`, and this network branch call `setConversation` — add the same `suggestUnmatchedVoices(cached.data)` line right after the cache-hit branch's `setConversation(cached.data)` too, so a suggestion still appears on a cache-served visit, not only on a fresh network fetch.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS (no new automated tests — this task's logic is a thin call-through covered by Task 5's manual verification path).

- [ ] **Step 5: Commit**

```bash
git add src/lib/people-pipeline.ts src/app/conversation/\[id\]/page.tsx
git commit -m "feat(people): raise a pending suggestion for each unrecognized voice on conversation load"
```

---

### Task 8: Review-queue UI for voice suggestions

**Files:**
- Modify: `src/app/people/page.tsx`

**Interfaces:**
- Consumes: `PendingSuggestion.kind`/`speakerId` (Task 5), `POST /api/capture/enroll-voice` (Task 6).
- Produces: nothing new consumed elsewhere — this is the leaf UI.

- [ ] **Step 1: Add the accept/ignore handlers**

In `src/app/people/page.tsx`, add state for the new-person text draft per voice card, right after the existing `const [acceptErrorId, setAcceptErrorId] = useState<string | null>(null);`:

```ts
  const [voiceNameDraft, setVoiceNameDraft] = useState<Record<string, string>>({});
```

Add the handlers right after `doIgnore`:

```ts
  const acceptVoiceInto = async (s: PendingSuggestion, personId: string) => {
    try {
      await fetchJson("/api/capture/enroll-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: s.conversationId, speakerId: s.speakerId, personId }),
      });
    } catch {
      setAcceptErrorId(s.id);
      refresh();
      return;
    }
    setAcceptErrorId((cur) => (cur === s.id ? null : cur));
    removePending(s.id);
    refresh();
  };

  const acceptVoiceAsNew = async (s: PendingSuggestion, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const p = createPerson({ name: trimmed });
    if (!p) {
      setAcceptErrorId(s.id);
      refresh();
      return;
    }
    await acceptVoiceInto(s, p.id);
  };

  const doIgnoreVoice = (s: PendingSuggestion) => {
    removePending(s.id);
    refresh();
  };
```

`fetchJson` is already imported in this file's neighbor `people-pipeline.ts`; check whether `src/app/people/page.tsx` itself already imports it — if not, add `import { fetchJson } from "@/lib/fetch-json";` to this file's import block.

- [ ] **Step 2: Branch the render loop**

In `src/app/people/page.tsx`, replace the `{pending.map((s) => ( <PendingCard ... /> ))}` block with:

```tsx
              {pending.map((s) =>
                s.kind === "voice" ? (
                  <VoicePendingCard
                    key={s.id}
                    suggestion={s}
                    people={people}
                    showError={acceptErrorId === s.id}
                    newName={voiceNameDraft[s.id] ?? ""}
                    onNewNameChange={(v) => setVoiceNameDraft((cur) => ({ ...cur, [s.id]: v }))}
                    onAcceptExisting={(id) => acceptVoiceInto(s, id)}
                    onAcceptNew={(name) => acceptVoiceAsNew(s, name)}
                    onIgnore={() => doIgnoreVoice(s)}
                  />
                ) : (
                  <PendingCard
                    key={s.id}
                    suggestion={s}
                    people={people}
                    showError={acceptErrorId === s.id}
                    reassignOpen={reassigning === s.id}
                    onOpenReassign={() => setReassigning(s.id)}
                    onCloseReassign={() => setReassigning(null)}
                    onAcceptMatched={(id) => acceptInto(s, id)}
                    onAcceptCandidate={(id) => acceptInto(s, id)}
                    onAcceptExisting={(id) => acceptInto(s, id)}
                    onAcceptNew={() => acceptAsNew(s)}
                    onIgnore={() => doIgnore(s)}
                  />
                )
              )}
```

(`confidentMatches` — the bulk "Add all N" banner — is computed as `pending.filter((s) => s.matchedPersonId)`; voice suggestions never set `matchedPersonId`, so they're automatically excluded from that count with no change needed there.)

- [ ] **Step 3: Add the `VoicePendingCard` component**

Add this new component right after `PendingCard`'s closing brace:

```tsx
function VoicePendingCard({
  suggestion: s,
  people,
  showError,
  newName,
  onNewNameChange,
  onAcceptExisting,
  onAcceptNew,
  onIgnore,
}: {
  suggestion: PendingSuggestion;
  people: Person[];
  showError: boolean;
  newName: string;
  onNewNameChange: (v: string) => void;
  onAcceptExisting: (personId: string) => void;
  onAcceptNew: (name: string) => void;
  onIgnore: () => void;
}) {
  return (
    <div className="card p-4">
      <div className="mb-2">
        <div className="text-white font-medium">Unrecognized voice</div>
        <div className="text-slate-400 text-xs">{getAnalysisAge(s.date).label}</div>
      </div>

      {showError && (
        <p className="text-red-400 text-xs mb-2" role="alert">
          Couldn&rsquo;t save — try again.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-2 min-w-0">
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) onAcceptExisting(e.target.value);
          }}
          aria-label="Select person"
          className="flex-1 min-w-0 max-w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          <option value="" disabled>
            Who is this?
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {optionLabel(p.name)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-2 items-center min-w-0">
        <input
          value={newName}
          onChange={(e) => onNewNameChange(e.target.value)}
          placeholder="Or add a new person…"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 min-h-[44px] text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400"
        />
        <button
          onClick={() => onAcceptNew(newName)}
          disabled={!newName.trim()}
          className={`${BUTTON_PRIMARY} px-3 disabled:opacity-50`}
        >
          Add
        </button>
        <button
          onClick={onIgnore}
          className="text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          Ignore
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification in the browser**

Run: `npm run dev`, open `/people`. With at least one `kind: "voice"` pending suggestion present (seed one by hand in `localStorage` under the `omi-people-pending` key if no real conversation has produced one yet — shape: `{ id, kind: "voice", conversationId: "test", date: new Date().toISOString(), speakerId: 0, extractedName: "", details: [], timestamp: new Date().toISOString() }`), confirm:
- the card renders as "Unrecognized voice" with a person picker and a new-person input, not the text-suggestion layout
- picking an existing person or typing a new name and clicking Add removes the card from the queue (network call to `enroll-voice` will 404 against the fake `conversationId` above — confirm the error path shows "Couldn't save — try again." and the card stays, rather than silently disappearing)
- Ignore removes the card immediately

- [ ] **Step 6: Commit**

```bash
git add src/app/people/page.tsx
git commit -m "feat(people): review-queue UI for unrecognized voices"
```

---

### Task 9: Final docs pass

**Files:**
- Modify: `README.md` (only if it lists environment variables or the capture pipeline's dependencies — check first)

**Interfaces:** none.

- [ ] **Step 1: Check whether README documents capture env vars or dependencies**

Run: `grep -n "CAPTURE_VAD_DBFS\|DEEPGRAM_API_KEY\|@neondatabase" README.md`

- [ ] **Step 2: If it does, add the two new env vars and the new dependency in the same style/section as the existing ones**

(No fixed snippet here — match whatever format Step 1 reveals. If README doesn't document capture env vars at all today, skip this task entirely: `.env.example` from Task 4 is already the source of truth, and this plan shouldn't invent new documentation surface the project doesn't already have.)

- [ ] **Step 3: Commit (only if Step 2 made a change)**

```bash
git add README.md
git commit -m "docs: speaker-identification env vars and dependency"
```
