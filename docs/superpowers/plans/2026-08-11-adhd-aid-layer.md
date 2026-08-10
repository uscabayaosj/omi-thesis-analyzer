# ADHD Aid Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "ADHD Aid" analysis lens (per-conversation cognitive prosthetic + calendar-day rollup) that runs alongside the existing Pioneer Sovereignty thesis analysis on single or multiple conversations.

**Architecture:** A second lens over the same Omi conversation data. New provider-agnostic libs (`adhd.ts`, `rollup.ts`) reuse the existing `chatCompletion` from `analysis.ts`. Two new API routes mirror the existing analyze routes. All persistence stays client-side in `localStorage` via a dedicated `adhd-storage.ts`. UI adds a lens toggle on the conversation page, lens badges + a batch action on the home list, and a new day-anchored `/rollup` page.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript 5, Tailwind CSS v4. AI via `chatCompletion` (OpenAI/Anthropic/Google/OpenRouter, provider chosen by `AI_PROVIDER` env).

## Global Constraints

- **No test runner exists.** Verification per task = `npx tsc --noEmit` (must be clean) + `npm run lint` (no new errors) + browser preview for observable behavior. There is no `npm test`.
- **All AI calls go through `chatCompletion(messages, jsonMode)` in `src/lib/analysis.ts`.** Do not add a new provider client. Reuse `clampTranscript`, `extractJsonObject` from the same file.
- **All persistence is `localStorage`.** No server-side storage, no database.
- **Lens label is exactly `ADHD Aid`** in all UI. Generated analysis text must never contain "ADHD", "you forgot", or scolding (this lives in the prompt's tone rules).
- **Coercers must never throw on malformed model output.** Array fields default to `[]`, string fields to a fallback string, so the UI always renders.
- **Follow existing patterns:** `friendlyError` for route errors, `fetchJson` for client calls, `card` / `analysis-section` Tailwind classes, `min-h-[44px]` tap targets, `aria-*` labels as in existing pages.
- **Commit after each task** with a `feat:`/`refactor:` message; end every commit body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

**Create:**
- `src/lib/adhd.ts` — ADHD + Rollup TypeScript types, `commitmentKey`, per-conversation system/user prompts, `analyzeAdhd`, `toAdhdAnalysis`.
- `src/lib/rollup.ts` — rollup system/user prompts, `generateRollup`.
- `src/lib/adhd-storage.ts` — `localStorage` helpers for ADHD analyses + rollups.
- `src/app/api/analyze-adhd/route.ts` — single-conversation ADHD route.
- `src/app/api/rollup/route.ts` — daily rollup route.
- `src/components/ThesisResults.tsx` — extracted thesis results renderer (refactor).
- `src/components/AdhdResults.tsx` — ADHD results renderer.
- `src/app/rollup/page.tsx` — Daily Rollup page.

**Modify:**
- `src/components/icons.tsx` — add `UsersIcon`, `CalendarIcon`, `CheckSquareIcon`.
- `src/app/conversation/[id]/page.tsx` — lens toggle, ADHD analyze/render, use extracted components.
- `src/app/page.tsx` — lens badges, batch ADHD action, Daily Rollup link.
- `src/lib/obsidian.ts` — ADHD note + rollup note markdown builders.

---

## Task 1: ADHD analysis lib (`src/lib/adhd.ts`)

**Files:**
- Create: `src/lib/adhd.ts`

**Interfaces:**
- Consumes: `chatCompletion`, `clampTranscript`, `extractJsonObject` from `src/lib/analysis.ts`.
- Produces:
  - Types `Confidence`, `AdhdCommitment`, `AdhdPerson`, `AdhdAheadItem`, `AdhdAnalysis`, `Rollup`.
  - `commitmentKey(who: string, what: string): string`
  - `toAdhdAnalysis(raw: Record<string, unknown>): AdhdAnalysis`
  - `analyzeAdhd(transcript: string, title: string, date: string): Promise<AdhdAnalysis>`

- [ ] **Step 1: Create the file with types, key hashing, coercer, prompts, and `analyzeAdhd`.**

Create `src/lib/adhd.ts`:

```ts
import { chatCompletion, clampTranscript, extractJsonObject } from "./analysis";

// ─────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────

export type Confidence = "FIRM" | "SOFT" | "PROPOSED";

export interface AdhdCommitment {
  /** Deterministic hash of normalized who+what. Stable across re-runs so
   *  done-state (tracked by key) survives re-analysis. */
  key: string;
  direction: "user_to_other" | "other_to_user";
  who: string;
  what: string;
  deadline: string;
  confidence: Confidence;
  quote: string;
}

export interface AdhdPerson {
  name: string;
  relationship: string;
  shared: string;
  tone: string;
  owed: string;
}

export interface AdhdAheadItem {
  event: string;
  date: string;
  prep: string;
  start_when: string;
  conflict: string;
}

export interface AdhdAnalysis {
  do_today: string[];
  commitments: AdhdCommitment[];
  remember: string[];
  people: AdhdPerson[];
  open_loops: string[];
  ahead: AdhdAheadItem[];
  summary: string;
}

/** Daily rollup shape. Prose blocks by design (a 60-second plan, not a table).
 *  Defined here so both adhd-storage and rollup.ts can import it. */
export interface Rollup {
  tomorrow_plan: string;
  aging_commitments: string;
  conflicts_at_risk: string;
  social_ledger: string;
  tomorrow_events: string;
  today_paragraph: string;
  dropped: string;
}

// ─────────────────────────────────────────────────────────────────
// Commitment key — deterministic, synchronous (FNV-1a, base36)
// ─────────────────────────────────────────────────────────────────

export function commitmentKey(who: string, what: string): string {
  const s = `${who}|${what}`.toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ─────────────────────────────────────────────────────────────────
// Coercion — never throws; guarantees renderable shapes
// ─────────────────────────────────────────────────────────────────

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" && v.trim() ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function asConfidence(v: unknown): Confidence {
  return v === "FIRM" || v === "SOFT" || v === "PROPOSED" ? v : "PROPOSED";
}

function toCommitment(raw: unknown): AdhdCommitment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const who = asString(r.who, "Unknown");
  const what = asString(r.what);
  if (!what) return null;
  const direction =
    r.direction === "other_to_user" ? "other_to_user" : "user_to_other";
  return {
    key: commitmentKey(who, what),
    direction,
    who,
    what,
    deadline: asString(r.deadline, "PROPOSED: no date stated"),
    confidence: asConfidence(r.confidence),
    quote: asString(r.quote),
  };
}

function toPerson(raw: unknown): AdhdPerson | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = asString(r.name);
  if (!name) return null;
  return {
    name,
    relationship: asString(r.relationship, "Unknown relationship"),
    shared: asString(r.shared, "None"),
    tone: asString(r.tone, "Neutral"),
    owed: asString(r.owed, "None"),
  };
}

function toAheadItem(raw: unknown): AdhdAheadItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const event = asString(r.event);
  if (!event) return null;
  return {
    event,
    date: asString(r.date, "No date stated"),
    prep: asString(r.prep, "None"),
    start_when: asString(r.start_when, "None"),
    conflict: asString(r.conflict, "None"),
  };
}

export function toAdhdAnalysis(raw: Record<string, unknown>): AdhdAnalysis {
  const commitments = Array.isArray(raw.commitments)
    ? raw.commitments.map(toCommitment).filter((c): c is AdhdCommitment => c !== null)
    : [];
  const people = Array.isArray(raw.people)
    ? raw.people.map(toPerson).filter((p): p is AdhdPerson => p !== null)
    : [];
  const ahead = Array.isArray(raw.ahead)
    ? raw.ahead.map(toAheadItem).filter((a): a is AdhdAheadItem => a !== null)
    : [];
  return {
    do_today: asStringArray(raw.do_today).slice(0, 3),
    commitments,
    remember: asStringArray(raw.remember),
    people,
    open_loops: asStringArray(raw.open_loops),
    ahead,
    summary: asString(raw.summary, "No summary was returned. Re-run the analysis."),
  };
}

// ─────────────────────────────────────────────────────────────────
// Prompts — the cognitive-prosthetic pass, JSON output
// ─────────────────────────────────────────────────────────────────

const ADHD_SYSTEM_PROMPT = `You are a cognitive prosthetic for a person with ADHD. You process the transcript of a conversation they just had, captured by a wearable microphone. Your job is to do the cognitive work their brain deprioritizes: holding commitments, tracking time, remembering people, and converting vague intentions into concrete plans. Assume anything you don't capture is lost forever — the user will not re-read the transcript.

The transcript comes from speech-to-text and may have errors, missing punctuation, and imperfect speaker labels. "SPEAKER_0" or the primary voice is usually the user. Infer speakers from context when labels are unreliable. Never invent content to fill gaps; mark uncertainty instead.

## Processing rules

1. Commitments are sacred. Extract every promise, task, or obligation — both directions: what the user committed to do, and what others committed to the user. Include IMPLIED commitments (agreeing with "yeah, okay" counts). Softened language ("I might", "I'll try to") still counts — set confidence SOFT. For each: who owes whom, exactly what, deadline (explicit or inferred), and the quote it came from. If no deadline was stated, propose one and prefix the deadline with "PROPOSED: " and set confidence PROPOSED. An untimed task is a forgotten task.

2. Convert intentions into next actions. Whenever the user expresses an intention, rewrite it as the smallest concrete first step, with a realistic time estimate. Multiply the user's own stated time estimates by 1.5. If a task has more than one step, break out step one only.

3. Offload working memory into "remember": decisions made (with the reasoning — the reasoning is what gets lost), facts/numbers/dates/names/addresses/titles/recommendations mentioned in passing, answers the user received, instructions given to the user.

4. Social recall. For each person: name and how they relate to the user (inferred), personal details they shared, emotional tone, and anything the user owes them socially (thank-you, reply, favor, congratulation).

5. Open loops: topics raised but never resolved. Phrase each as a question the user can act on.

6. Planning ahead: future events (meetings, deadlines, trips, appointments) with date and prep required; when prep is needed, state when to start (work backward from the deadline); flag scheduling conflicts or physically unrealistic plans.

7. Tone rules. Never scold, never mention ADHD, never say "you forgot" or "you failed to". State facts and next actions neutrally.

8. Precision over recall padding. Every extracted item must trace to something actually said. If a section has nothing, return an empty array (or "None." for the summary if truly empty).

You MUST respond with valid JSON matching this exact schema:
{
  "do_today": ["highest-leverage action with a time estimate", "..."],
  "commitments": [
    {
      "direction": "user_to_other" | "other_to_user",
      "who": "the counterparty",
      "what": "exactly what is owed",
      "deadline": "explicit date, or 'PROPOSED: <date>' when inferred",
      "confidence": "FIRM" | "SOFT" | "PROPOSED",
      "quote": "short source quote"
    }
  ],
  "remember": ["decision (with reasoning), fact, answer, or recommendation", "..."],
  "people": [
    {
      "name": "person name",
      "relationship": "how they relate to the user",
      "shared": "personal details worth mentioning next time, or 'None'",
      "tone": "emotional read",
      "owed": "social debt (reply/thank-you/favor), or 'None'"
    }
  ],
  "open_loops": ["unresolved question phrased so the user can act on it", "..."],
  "ahead": [
    {
      "event": "upcoming event",
      "date": "when it is",
      "prep": "what prep is required, or 'None'",
      "start_when": "when to start prep (worked backward), or 'None'",
      "conflict": "flagged scheduling/impossibility issue, or 'None'"
    }
  ],
  "summary": "a single sentence the user could read in 3 seconds to know what this conversation was"
}

"do_today" holds at most 3 items. Do not manufacture insights. Empty arrays are correct when a section has nothing.`;

function buildAdhdUserPrompt(transcript: string, title: string, date: string): string {
  return `Conversation title: "${title}"
Conversation date: ${date}

Process this transcript into the JSON schema. Deadlines you infer must be realistic relative to the conversation date above. Remember: implied and softened commitments still count; every commitment needs a deadline (propose one if none was stated).

Transcript:
${transcript}`;
}

export async function analyzeAdhd(
  transcript: string,
  title: string,
  date: string
): Promise<AdhdAnalysis> {
  const content = await chatCompletion(
    [
      { role: "system", content: ADHD_SYSTEM_PROMPT },
      { role: "user", content: buildAdhdUserPrompt(clampTranscript(transcript), title, date) },
    ],
    true
  );
  return toAdhdAnalysis(extractJsonObject(content));
}
```

- [ ] **Step 2: Type-check.**

Run: `npx tsc --noEmit`
Expected: clean (no output, exit 0).

- [ ] **Step 3: Lint.**

Run: `npm run lint`
Expected: no new errors for `src/lib/adhd.ts`.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/adhd.ts
git commit -m "feat: add ADHD per-conversation analysis lib

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Single-conversation ADHD route (`src/app/api/analyze-adhd/route.ts`)

**Files:**
- Create: `src/app/api/analyze-adhd/route.ts`

**Interfaces:**
- Consumes: `getConversation`, `segmentsToText` from `src/lib/omi-api.ts`; `analyzeAdhd` from `src/lib/adhd.ts`; `friendlyError` from `src/lib/api-error.ts`.
- Produces: `POST /api/analyze-adhd` returning `{ conversation, analysis }` where `analysis` is `AdhdAnalysis`.

- [ ] **Step 1: Create the route (mirrors `src/app/api/analyze/route.ts`).**

Create `src/app/api/analyze-adhd/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { getConversation, segmentsToText } from "@/lib/omi-api";
import { analyzeAdhd } from "@/lib/adhd";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { conversationId } = await req.json();

    if (!conversationId || typeof conversationId !== "string") {
      return NextResponse.json(
        { error: "Please select a conversation to analyze." },
        { status: 400 }
      );
    }

    const convo = await getConversation(conversationId);

    if (!convo.transcript_segments || convo.transcript_segments.length === 0) {
      return NextResponse.json(
        { error: "This conversation has no transcript to analyze. Try recording a new conversation with your Omi device." },
        { status: 404 }
      );
    }

    const transcript = segmentsToText(convo.transcript_segments);
    const title = convo.structured?.title || "Untitled Conversation";
    const date = convo.created_at;

    const analysis = await analyzeAdhd(transcript, title, date);

    return NextResponse.json({ conversation: convo, analysis });
  } catch (err) {
    console.error("analyze-adhd failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 2: Type-check.** Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Lint.** Run: `npm run lint` → no new errors.

- [ ] **Step 4: Commit.**

```bash
git add src/app/api/analyze-adhd/route.ts
git commit -m "feat: add /api/analyze-adhd route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: ADHD storage (`src/lib/adhd-storage.ts`)

**Files:**
- Create: `src/lib/adhd-storage.ts`

**Interfaces:**
- Consumes: `AdhdAnalysis`, `Rollup` from `src/lib/adhd.ts`.
- Produces:
  - `StoredAdhdAnalysis`, `StoredRollup` types.
  - `getAdhdAnalysis(id): StoredAdhdAnalysis | null`
  - `saveAdhdAnalysis(record: { conversationId; title; date?; analysis }): StoredAdhdAnalysis` (preserves existing `doneKeys` for keys still present)
  - `getAdhdAnalyzedIds(): Set<string>`
  - `toggleCommitmentDone(id: string, key: string): string[]`
  - `getRollup(day: string): StoredRollup | null`
  - `saveRollup(record: { day; conversationIds; rollup }): StoredRollup`
  - `getRollupDays(): string[]`
  - `getPreviousRollup(day: string): StoredRollup | null`

- [ ] **Step 1: Create the file.**

Create `src/lib/adhd-storage.ts`:

```ts
"use client";

import type { AdhdAnalysis, Rollup } from "./adhd";

export interface StoredAdhdAnalysis {
  conversationId: string;
  timestamp: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
  /** Commitment keys the user has marked done. */
  doneKeys: string[];
}

export interface StoredRollup {
  day: string; // YYYY-MM-DD
  timestamp: string;
  conversationIds: string[];
  rollup: Rollup;
}

const ANALYSES_KEY = "omi-adhd-analyses";
const ROLLUPS_KEY = "omi-adhd-rollups";

// ── low-level ──

function readMap<T>(key: string): Record<string, T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, T>;
  } catch {
    return {};
  }
}

function writeMap<T>(key: string, map: Record<string, T>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      console.error(`localStorage quota exceeded writing ${key}`);
    }
  }
}

// ── ADHD analyses ──

export function getAdhdAnalysis(id: string): StoredAdhdAnalysis | null {
  const map = readMap<StoredAdhdAnalysis>(ANALYSES_KEY);
  return map[id] ?? null;
}

export function getAdhdAnalyzedIds(): Set<string> {
  return new Set(Object.keys(readMap<StoredAdhdAnalysis>(ANALYSES_KEY)));
}

export function saveAdhdAnalysis(record: {
  conversationId: string;
  title: string;
  date?: string;
  analysis: AdhdAnalysis;
}): StoredAdhdAnalysis {
  const map = readMap<StoredAdhdAnalysis>(ANALYSES_KEY);
  const prev = map[record.conversationId];

  // Preserve done-state for commitments that still exist after re-analysis.
  const liveKeys = new Set(record.analysis.commitments.map((c) => c.key));
  const doneKeys = (prev?.doneKeys ?? []).filter((k) => liveKeys.has(k));

  const stored: StoredAdhdAnalysis = {
    conversationId: record.conversationId,
    timestamp: new Date().toISOString(),
    title: record.title,
    date: record.date,
    analysis: record.analysis,
    doneKeys,
  };
  map[record.conversationId] = stored;
  writeMap(ANALYSES_KEY, map);
  return stored;
}

export function toggleCommitmentDone(id: string, key: string): string[] {
  const map = readMap<StoredAdhdAnalysis>(ANALYSES_KEY);
  const stored = map[id];
  if (!stored) return [];
  const set = new Set(stored.doneKeys);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  stored.doneKeys = Array.from(set);
  writeMap(ANALYSES_KEY, map);
  return stored.doneKeys;
}

// ── rollups ──

export function getRollup(day: string): StoredRollup | null {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  return map[day] ?? null;
}

export function getRollupDays(): string[] {
  return Object.keys(readMap<StoredRollup>(ROLLUPS_KEY)).sort().reverse();
}

export function saveRollup(record: {
  day: string;
  conversationIds: string[];
  rollup: Rollup;
}): StoredRollup {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  const stored: StoredRollup = {
    day: record.day,
    timestamp: new Date().toISOString(),
    conversationIds: record.conversationIds,
    rollup: record.rollup,
  };
  map[record.day] = stored;
  writeMap(ROLLUPS_KEY, map);
  return stored;
}

/** Most recent stored rollup for a day strictly earlier than `day`. */
export function getPreviousRollup(day: string): StoredRollup | null {
  const map = readMap<StoredRollup>(ROLLUPS_KEY);
  const earlier = Object.keys(map).filter((d) => d < day).sort();
  const prevDay = earlier[earlier.length - 1];
  return prevDay ? map[prevDay] : null;
}
```

- [ ] **Step 2: Type-check.** Run: `npx tsc --noEmit` → clean.

- [ ] **Step 3: Lint.** Run: `npm run lint` → no new errors.

- [ ] **Step 4: Commit.**

```bash
git add src/lib/adhd-storage.ts
git commit -m "feat: add ADHD localStorage layer (analyses + rollups)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: New icons (`src/components/icons.tsx`)

**Files:**
- Modify: `src/components/icons.tsx` (append)

**Interfaces:**
- Produces: `UsersIcon`, `CalendarIcon`, `CheckSquareIcon` — each `({ className }: { className?: string }) => JSX`, matching the existing icon signature in the file.

- [ ] **Step 1: Read the existing icon convention.**

Run: `sed -n '1,30p' src/components/icons.tsx`
Note the exact prop signature and SVG attribute style used by existing icons, and match it.

- [ ] **Step 2: Append the three icons** to the end of `src/components/icons.tsx`, matching the existing component style (same `className` prop, `fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`, `aria-hidden`). Use these paths:

```tsx
export function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-1a4 4 0 00-4-4h-1m-4 5H2v-1a4 4 0 014-4h4a4 4 0 014 4v1zm-3-9a3 3 0 11-6 0 3 3 0 016 0zm6-3a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
    </svg>
  );
}

export function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}

export function CheckSquareIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m1 7H8a2 2 0 01-2-2V7a2 2 0 012-2h8a2 2 0 012 2v6a2 2 0 01-2 2z" />
    </svg>
  );
}
```

> If any of these names already exists in the file, keep the existing one and skip the duplicate.

- [ ] **Step 3: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors.

- [ ] **Step 4: Commit.**

```bash
git add src/components/icons.tsx
git commit -m "feat: add Users, Calendar, CheckSquare icons

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Extract thesis results into `ThesisResults.tsx` (refactor, no behavior change)

**Files:**
- Create: `src/components/ThesisResults.tsx`
- Modify: `src/app/conversation/[id]/page.tsx`

**Interfaces:**
- Produces: `ThesisResults` component and the `Analysis` type it renders. It encapsulates the existing `AnalysisSection` sub-component and the `sections` array currently built inline in the page.

**Rationale:** the conversation page is ~750 lines. Moving the thesis results renderer out is a prerequisite for adding the ADHD renderer without the page becoming unmanageable. This task must not change any thesis behavior.

- [ ] **Step 1: Create `src/components/ThesisResults.tsx`** holding the thesis `Analysis` type, the `AnalysisSection` component (moved verbatim from the page, lines ~92-115), and a `ThesisResults` component that renders the eight-section list. Signature:

```tsx
import type { ComponentType } from "react";
import {
  ScrollIcon, HomeIcon, LinkIcon, MountainsIcon,
  TargetIcon, ScaleIcon, XCircleIcon, TrendingUpIcon,
} from "@/components/icons";

export interface Analysis {
  rq1_documentary_record: string;
  rq2_everyday_practices: string;
  rq3_cskt_intersection: string;
  rq4_wildness_imaginary: string;
  conditions_check: string;
  rival_hypothesis_test: string;
  refutation_signals: string;
  forward_thinking: string;
}

function AnalysisSection({
  icon: Icon, title, subtitle, content,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  content: string;
}) {
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {title}
        </h3>
        <p className="text-xs text-slate-500 mb-3">{subtitle}</p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

export function ThesisResults({ analysis }: { analysis: Analysis }) {
  const dim = (text: string | undefined) =>
    text && text.trim() ? text : "No content was recorded for this dimension. Re-run the analysis to fill it in.";

  const sections = [
    { icon: ScrollIcon, title: "RQ1 — Documentary Record", subtitle: "Historical-legal constitution of authority: patents, water rights, allotments, grazing permits", content: dim(analysis.rq1_documentary_record) },
    { icon: HomeIcon, title: "RQ2 — Everyday Practices", subtitle: "Kinship, inheritance, branding, boundary-maintenance, conflict — how authority is produced daily", content: dim(analysis.rq2_everyday_practices) },
    { icon: LinkIcon, title: "RQ3 — CSKT Intersection", subtitle: "How ranching authority intersects with, depends on, and is contested by CSKT sovereignty", content: dim(analysis.rq3_cskt_intersection) },
    { icon: MountainsIcon, title: "RQ4 — Wildness Imaginary", subtitle: "Frontier mythology as double-erasure instrument (4A: Indigenous erasure, 4B: federal erasure)", content: dim(analysis.rq4_wildness_imaginary) },
    { icon: TargetIcon, title: "Orienting Conditions", subtitle: "Which of the five conditions are evidenced in this conversation?", content: dim(analysis.conditions_check) },
    { icon: ScaleIcon, title: "Rival Hypothesis Test", subtitle: "Is frontier framing public/strategic or intimate? Felt subjectivity or instrumental rhetoric?", content: dim(analysis.rival_hypothesis_test) },
    { icon: XCircleIcon, title: "Refutation Signals", subtitle: "Does anything challenge or complicate the pioneer sovereignty concept?", content: dim(analysis.refutation_signals) },
    { icon: TrendingUpIcon, title: "Forward Thinking", subtitle: "Research directions, questions to pursue, connections to other data", content: dim(analysis.forward_thinking) },
  ];

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <AnalysisSection key={section.title} {...section} />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Update the page to use it.** In `src/app/conversation/[id]/page.tsx`:
  - Delete the local `AnalysisSection` function (lines ~92-115) and the local `interface Analysis` (lines ~59-68).
  - Add `import { ThesisResults, type Analysis } from "@/components/ThesisResults";` with the other imports.
  - Replace the inline `sections`/`dim` block (lines ~432-447) and the results `<div className="space-y-6">…{sections.map(...)}</div>` (lines ~608-612) with a single `{analysis && <ThesisResults analysis={analysis} />}`.
  - The eight `ScrollIcon…TrendingUpIcon` imports become unused in the page — remove them from the page's icon import (they now live in `ThesisResults`). Keep icons the page still uses (`RefreshIcon`, `ArrowLeftIcon`, `WarningIcon`, `CheckIcon`, `CompassIcon`, `CogIcon`, `ClipboardIcon`, `FileTextIcon`, `DownloadIcon`, `ExternalLinkIcon`, `LoaderIcon`).

- [ ] **Step 3: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors (in particular, no unused-import warnings).

- [ ] **Step 4: Browser verify (no behavior change).** Start the dev server and open an already-analyzed conversation; confirm the eight thesis sections render exactly as before.

Run: `preview_start { name: "dev" }` (create `.claude/launch.json` with an `npm run dev` config on port 3000 if absent), navigate to `/conversation/<an-analyzed-id>`, and confirm via `read_page` that the eight section headings appear.

- [ ] **Step 5: Commit.**

```bash
git add src/components/ThesisResults.tsx src/app/conversation/[id]/page.tsx
git commit -m "refactor: extract ThesisResults from conversation page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: ADHD results + conversation-page lens toggle + done-toggle + export

**Files:**
- Create: `src/components/AdhdResults.tsx`
- Modify: `src/app/conversation/[id]/page.tsx`
- Modify: `src/lib/obsidian.ts` (add ADHD per-conversation builder)

**Interfaces:**
- Consumes: `AdhdAnalysis`, `AdhdCommitment` from `src/lib/adhd`; `getAdhdAnalysis`, `saveAdhdAnalysis`, `toggleCommitmentDone`, `StoredAdhdAnalysis` from `src/lib/adhd-storage`; `UsersIcon`, `CalendarIcon`, `CheckSquareIcon`, plus existing icons.
- Produces: `AdhdResults` component; `buildAdhdMarkdown(stored)` + `exportAdhdToObsidian(stored)` + `downloadAdhdMarkdown(stored)` in `obsidian.ts`; a `Lens` state (`"thesis" | "adhd" | "both"`) on the page.

- [ ] **Step 1: Add the ADHD markdown builder to `src/lib/obsidian.ts`.** Append (keep the existing `MAX_URI_LENGTH` and the same `obsidian://advanced-uri` + `vault: "PhDVault"` conventions used by the thesis builder). Import the stored type at the top: `import type { StoredAdhdAnalysis } from "./adhd-storage";`

```ts
function fmtCommitment(c: { direction: string; who: string; what: string; deadline: string; confidence: string; quote: string }, done: boolean): string {
  const box = done ? "✅" : "⬜";
  const dir = c.direction === "other_to_user" ? `${c.who} → me` : `me → ${c.who}`;
  return `- ${box} **${dir}** — ${c.what} (**${c.deadline}**, ${c.confidence})\n  > ${c.quote}`;
}

export function buildAdhdMarkdown(stored: StoredAdhdAnalysis): { markdown: string; filename: string } {
  const a = stored.analysis;
  const done = new Set(stored.doneKeys);
  const day = (stored.date || stored.timestamp).split("T")[0];
  const safeName = (stored.title || "Untitled").replace(/[\/\\:*?"<>|]/g, "-").substring(0, 80);

  const commitments = a.commitments.length
    ? a.commitments.map((c) => fmtCommitment(c, done.has(c.key))).join("\n")
    : "None.";
  const people = a.people.length
    ? a.people.map((p) => `### ${p.name} — ${p.relationship}\n- Shared: ${p.shared}\n- Tone: ${p.tone}\n- Owed: ${p.owed}`).join("\n\n")
    : "None.";
  const ahead = a.ahead.length
    ? a.ahead.map((x) => `- **${x.event}** (${x.date}) — prep: ${x.prep}; start: ${x.start_when}; conflict: ${x.conflict}`).join("\n")
    : "None.";
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "None.");

  const markdown = `---
title: "${(stored.title || "Untitled").replace(/"/g, '\\"')}"
date: ${day}
analyzed: ${stored.timestamp}
type: adhd-analysis
source: Omi DK2
tags:
  - omi-analysis
  - adhd-aid
---

# ${stored.title || "Untitled"} — ADHD Aid

> ${a.summary}

## ⚡ Do today

${list(a.do_today)}

## 📌 Commitments

${commitments}

## 🧠 Remember

${list(a.remember)}

## 👥 People

${people}

## 🔁 Open loops

${list(a.open_loops)}

## 📅 Ahead

${ahead}

---
*Generated by [[Omi Thesis Analyzer]] — ADHD Aid layer.*
`;
  return { markdown, filename: `ADHD - ${day} - ${safeName}` };
}

export function exportAdhdToObsidian(stored: StoredAdhdAnalysis): { uri: string; uriTooLong: boolean } {
  const { markdown, filename } = buildAdhdMarkdown(stored);
  const params = new URLSearchParams({
    vault: "PhDVault",
    name: `Fieldwork/Omi Analysis/${filename}`,
    content: markdown,
    append: "false",
  });
  const uri = `obsidian://advanced-uri?${params.toString()}`;
  return { uri, uriTooLong: uri.length > MAX_URI_LENGTH };
}

export function downloadAdhdMarkdown(stored: StoredAdhdAnalysis): void {
  const { markdown, filename } = buildAdhdMarkdown(stored);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
```

> Confirm `MAX_URI_LENGTH` is module-scoped in `obsidian.ts` (it is, per the existing thesis builder). If it is function-local, lift it to module scope so these functions can use it.

- [ ] **Step 2: Create `src/components/AdhdResults.tsx`.**

```tsx
"use client";

import type { ComponentType, ReactNode } from "react";
import type { AdhdAnalysis } from "@/lib/adhd";
import {
  ZapIcon, ClipboardIcon, CogIcon, UsersIcon, RefreshIcon,
  CalendarIcon, CheckSquareIcon,
} from "@/components/icons";

function Block({
  icon: Icon, title, children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {title}
        </h3>
        <div className="text-sm leading-relaxed mt-3">{children}</div>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="text-slate-500">None.</p>;
}

export function AdhdResults({
  analysis,
  doneKeys,
  onToggleDone,
}: {
  analysis: AdhdAnalysis;
  doneKeys: string[];
  onToggleDone: (key: string) => void;
}) {
  const done = new Set(doneKeys);

  return (
    <div className="space-y-6">
      {/* One-line summary */}
      <div className="card p-5 border-indigo-500/30">
        <p className="text-sm text-slate-200">{analysis.summary}</p>
      </div>

      <Block icon={ZapIcon} title="Do today">
        {analysis.do_today.length ? (
          <ul className="space-y-2">
            {analysis.do_today.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-indigo-400 flex-shrink-0">→</span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={ClipboardIcon} title="Commitments">
        {analysis.commitments.length ? (
          <ul className="space-y-3">
            {analysis.commitments.map((c) => {
              const isDone = done.has(c.key);
              const dir = c.direction === "other_to_user" ? `${c.who} → me` : `me → ${c.who}`;
              return (
                <li key={c.key} className="flex gap-3">
                  <button
                    onClick={() => onToggleDone(c.key)}
                    aria-pressed={isDone}
                    aria-label={isDone ? "Mark commitment not done" : "Mark commitment done"}
                    className="flex-shrink-0 mt-0.5 min-h-[44px] min-w-[44px] flex items-start justify-center text-slate-500 hover:text-emerald-400 transition-colors"
                  >
                    {isDone
                      ? <CheckSquareIcon className="w-5 h-5 text-emerald-400" />
                      : <CheckSquareIcon className="w-5 h-5 opacity-40" />}
                  </button>
                  <div className={`min-w-0 ${isDone ? "opacity-50 line-through" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{dir}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">{c.confidence}</span>
                    </div>
                    <p className="text-slate-200 mt-0.5">{c.what}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Deadline: <strong className="text-slate-200">{c.deadline}</strong></p>
                    {c.quote && <p className="text-xs text-slate-500 italic mt-1">&ldquo;{c.quote}&rdquo;</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={CogIcon} title="Remember">
        {analysis.remember.length ? (
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-600">
            {analysis.remember.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={UsersIcon} title="People">
        {analysis.people.length ? (
          <div className="space-y-3">
            {analysis.people.map((p, i) => (
              <div key={i} className="rounded-lg bg-slate-900/60 p-3">
                <p className="font-medium text-slate-200">{p.name} <span className="text-slate-500 font-normal">— {p.relationship}</span></p>
                <p className="text-xs text-slate-400 mt-1">Shared: {p.shared}</p>
                <p className="text-xs text-slate-400">Tone: {p.tone}</p>
                <p className="text-xs text-slate-400">Owed: {p.owed}</p>
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Block>

      <Block icon={RefreshIcon} title="Open loops">
        {analysis.open_loops.length ? (
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-600">
            {analysis.open_loops.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={CalendarIcon} title="Ahead">
        {analysis.ahead.length ? (
          <div className="space-y-3">
            {analysis.ahead.map((x, i) => (
              <div key={i} className="rounded-lg bg-slate-900/60 p-3">
                <p className="font-medium text-slate-200">{x.event} <span className="text-slate-500 font-normal">({x.date})</span></p>
                <p className="text-xs text-slate-400 mt-1">Prep: {x.prep}</p>
                <p className="text-xs text-slate-400">Start: {x.start_when}</p>
                {x.conflict && x.conflict !== "None" && (
                  <p className="text-xs text-amber-300 mt-1">Conflict: {x.conflict}</p>
                )}
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Block>
    </div>
  );
}
```

- [ ] **Step 3: Wire the lens toggle + ADHD flow into `src/app/conversation/[id]/page.tsx`.**

Add imports:
```tsx
import { AdhdResults } from "@/components/AdhdResults";
import type { AdhdAnalysis } from "@/lib/adhd";
import { getAdhdAnalysis, saveAdhdAnalysis, toggleCommitmentDone } from "@/lib/adhd-storage";
import { buildAdhdMarkdown, exportAdhdToObsidian, downloadAdhdMarkdown } from "@/lib/obsidian";
```

Add state (near the other `useState`s):
```tsx
type Lens = "thesis" | "adhd" | "both";
const [lens, setLens] = useState<Lens>("thesis");
const [adhd, setAdhd] = useState<AdhdAnalysis | null>(null);
const [adhdDoneKeys, setAdhdDoneKeys] = useState<string[]>([]);
const [adhdAnalyzing, setAdhdAnalyzing] = useState(false);
```

Load stored ADHD + pick the default lens, in a new effect after the existing stored-thesis effect:
```tsx
useEffect(() => {
  const storedAdhd = getAdhdAnalysis(id);
  if (storedAdhd) {
    setAdhd(storedAdhd.analysis);
    setAdhdDoneKeys(storedAdhd.doneKeys);
  }
  // Default lens: the single lens that has results; else thesis.
  const hasThesis = !!getStoredAnalysis(id);
  const hasAdhd = !!storedAdhd;
  if (hasAdhd && !hasThesis) setLens("adhd");
  else setLens("thesis");
}, [id]);
```

Add the ADHD analyze handler:
```tsx
const executeAdhd = useCallback(async () => {
  setAdhdAnalyzing(true);
  setError(null);
  try {
    const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: Conversation }>("/api/analyze-adhd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    });
    setAdhd(data.analysis);
    if (data.conversation?.transcript_segments?.length) {
      setConversation(data.conversation);
      cacheSet(`conversation:${id}`, data.conversation);
    }
    const stored = saveAdhdAnalysis({
      conversationId: id,
      title: data.conversation?.structured?.title || conversation?.structured?.title || "Untitled",
      date: data.conversation?.created_at || conversation?.created_at,
      analysis: data.analysis,
    });
    setAdhdDoneKeys(stored.doneKeys);
  } catch (e) {
    setError(e instanceof Error ? e.message : "ADHD analysis failed");
  } finally {
    setAdhdAnalyzing(false);
  }
}, [id, conversation]);

const handleToggleDone = useCallback((key: string) => {
  setAdhdDoneKeys(toggleCommitmentDone(id, key));
}, [id]);

const handleAdhdExport = useCallback(() => {
  const stored = getAdhdAnalysis(id);
  if (!stored) return;
  const { uri, uriTooLong } = exportAdhdToObsidian(stored);
  if (uriTooLong) downloadAdhdMarkdown(stored);
  else window.open(uri, "_blank");
}, [id]);

const handleAdhdDownload = useCallback(() => {
  const stored = getAdhdAnalysis(id);
  if (stored) downloadAdhdMarkdown(stored);
}, [id]);
```

Add a lens toggle above the analyze area (place it right after the `<header>` block, before the `{!analysis && (...)}` analyze button). Use a segmented control:
```tsx
<div className="flex gap-1 mb-6 p-1 bg-slate-900 rounded-lg w-fit" role="radiogroup" aria-label="Analysis lens">
  {(["thesis", "adhd", "both"] as const).map((l) => (
    <button
      key={l}
      onClick={() => setLens(l)}
      role="radio"
      aria-checked={lens === l}
      className={`px-4 py-2 min-h-[44px] rounded-md text-sm transition-colors ${
        lens === l ? "bg-indigo-600 text-white" : "text-slate-300 hover:text-white"
      }`}
    >
      {l === "thesis" ? "Thesis" : l === "adhd" ? "ADHD Aid" : "Both"}
    </button>
  ))}
</div>
```

Gate the existing thesis analyze button and thesis results section on `(lens === "thesis" || lens === "both")`, and render the thesis results via `<ThesisResults analysis={analysis} />` (from Task 5).

Add the ADHD analyze button + results, gated on `(lens === "adhd" || lens === "both")`, after the thesis section:
```tsx
{(lens === "adhd" || lens === "both") && (
  <section className="mb-8" aria-label="ADHD Aid analysis">
    {!adhd && (
      <button
        onClick={executeAdhd}
        disabled={adhdAnalyzing}
        aria-label="Run ADHD Aid analysis on this conversation"
        className="w-full card p-6 text-center hover:border-indigo-500/50 transition-colors cursor-pointer disabled:opacity-50 mb-6 min-h-[44px]"
      >
        {adhdAnalyzing ? (
          <div className="flex items-center justify-center gap-3">
            <LoaderIcon className="w-6 h-6 text-indigo-400 animate-spin flex-shrink-0" />
            <p className="font-semibold text-white">Running ADHD Aid…</p>
          </div>
        ) : (
          <div>
            <ClipboardIcon className="w-7 h-7 mx-auto mb-2 text-indigo-400" />
            <p className="font-semibold text-white">Run ADHD Aid</p>
            <p className="text-slate-400 text-sm mt-1">Commitments, people, open loops, and next actions</p>
          </div>
        )}
      </button>
    )}
    {adhd && (
      <>
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <ClipboardIcon className="w-5 h-5 text-indigo-400 flex-shrink-0" />
            ADHD Aid
          </h2>
          <div className="flex items-center gap-2">
            <button onClick={handleAdhdExport} className="text-sm bg-purple-900/40 hover:bg-purple-800/50 text-purple-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
              <ExternalLinkIcon className="w-3.5 h-3.5" /> Send to Obsidian
            </button>
            <button onClick={handleAdhdDownload} className="text-sm bg-amber-900/40 hover:bg-amber-800/50 text-amber-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
              <DownloadIcon className="w-3.5 h-3.5" /> Download .md
            </button>
            <button onClick={executeAdhd} disabled={adhdAnalyzing} aria-label="Re-run ADHD Aid" className="text-slate-400 hover:text-indigo-400 disabled:opacity-50 transition-colors p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
              <RefreshIcon className={`w-4 h-4 ${adhdAnalyzing ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
        <AdhdResults analysis={adhd} doneKeys={adhdDoneKeys} onToggleDone={handleToggleDone} />
      </>
    )}
  </section>
)}
```

- [ ] **Step 4: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors.

- [ ] **Step 5: Browser verify.** With the dev server running, open a conversation:
  - Switch the lens to **ADHD Aid**, click **Run ADHD Aid**, confirm the summary + sections render.
  - Toggle a commitment checkbox; reload the page; confirm the checkbox state persisted (read from `localStorage` key `omi-adhd-analyses`).
  - Switch to **Both**; confirm thesis and ADHD sections both show.
  - Confirm **Download .md** produces a note; check via `read_network_requests` / console that no errors fire.

- [ ] **Step 6: Commit.**

```bash
git add src/components/AdhdResults.tsx src/app/conversation/[id]/page.tsx src/lib/obsidian.ts
git commit -m "feat: ADHD Aid lens on the conversation page

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Home list — lens badges, batch ADHD, Daily Rollup link

**Files:**
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `getAdhdAnalyzedIds` from `src/lib/adhd-storage`; `fetchJson`; `Link` (already imported); `ClipboardIcon`, `CalendarIcon` from icons.
- Produces: batch ADHD run over the current multi-selection.

- [ ] **Step 1: Track ADHD-analyzed ids.** Alongside `analyzedIds`, add:
```tsx
const [adhdIds, setAdhdIds] = useState<Set<string>>(new Set());
```
Populate it in the existing mount effect where `getAnalyzedIds()` is called:
```tsx
setAdhdIds(getAdhdAnalyzedIds());
```
Imports (add at the top of the file with the other imports):
```tsx
import { getAdhdAnalyzedIds, saveAdhdAnalysis } from "@/lib/adhd-storage";
import type { AdhdAnalysis } from "@/lib/adhd";
```

Then make the existing filter treat "analyzed" as **either lens** (per spec). Define a helper and use it in both `analyzedCount` and `filtered`:
```tsx
const isAnalyzedEither = useCallback(
  (cid: string) => analyzedIds.has(cid) || adhdIds.has(cid),
  [analyzedIds, adhdIds]
);
```
- Replace `const analyzedCount = conversations.filter((c) => analyzedIds.has(c.id)).length;` with `conversations.filter((c) => isAnalyzedEither(c.id)).length`.
- In `filtered`, replace `analyzedIds.has(c.id)` with `isAnalyzedEither(c.id)` for both the `"analyzed"` and `"unanalyzed"` branches.

- [ ] **Step 2: Dual lens badge.** Replace the `AnalyzedIndicator` component so it shows two small badges (thesis `T`, ADHD `A`) instead of one check. Keep the same outer size/margins so list layout is unchanged:
```tsx
function LensBadges({ thesis, adhd }: { thesis: boolean; adhd: boolean }) {
  const dot = (on: boolean, label: string) => (
    <span
      title={`${label}: ${on ? "analyzed" : "not analyzed"}`}
      className={`w-5 h-5 rounded-full border text-[10px] font-semibold flex items-center justify-center ${
        on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" : "bg-slate-800/60 border-slate-700 text-slate-600"
      }`}
    >
      {label}
    </span>
  );
  return (
    <div className="mt-0.5 flex-shrink-0 flex flex-col gap-1" aria-hidden="true">
      {dot(thesis, "T")}
      {dot(adhd, "A")}
    </div>
  );
}
```
Replace both `<AnalyzedIndicator analyzed={isAnalyzed} />` usages with `<LensBadges thesis={isAnalyzed} adhd={adhdIds.has(convo.id)} />`, and delete the old `AnalyzedIndicator`.

- [ ] **Step 3: Batch ADHD state + handler.** Add:
```tsx
const [batchRunning, setBatchRunning] = useState(false);
const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, failed: 0 });

const runBatchAdhd = useCallback(async () => {
  const ids = Array.from(selected);
  if (ids.length === 0) return;
  setBatchRunning(true);
  setBatchProgress({ done: 0, total: ids.length, failed: 0 });
  let failed = 0;
  for (let i = 0; i < ids.length; i++) {
    try {
      const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: { structured?: { title?: string }; created_at?: string } }>(
        "/api/analyze-adhd",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: ids[i] }),
        }
      );
      // Persist via the storage lib (same shape the conversation page uses).
      saveAdhdAnalysis({
        conversationId: ids[i],
        title: data.conversation?.structured?.title || "Untitled",
        date: data.conversation?.created_at,
        analysis: data.analysis,
      });
    } catch {
      failed++;
    }
    setBatchProgress({ done: i + 1, total: ids.length, failed });
  }
  setAdhdIds(getAdhdAnalyzedIds());
  setBatchRunning(false);
}, [selected]);
```

- [ ] **Step 4: Toolbar actions.** In the select-mode toolbar, replace the single "Analyze Group" button with two actions + progress. The existing `startGroupAnalysis` stays for thesis:
```tsx
<div className="flex items-center gap-2">
  <button
    onClick={startGroupAnalysis}
    disabled={selected.size < 2 || batchRunning}
    aria-label={`Group thesis analysis on ${selected.size} conversations`}
    className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium py-2 px-4 min-h-[44px] rounded-lg text-sm transition-colors"
  >
    <SparklesIcon className="w-4 h-4" />
    Group Thesis ({selected.size})
  </button>
  <button
    onClick={runBatchAdhd}
    disabled={selected.size < 1 || batchRunning}
    aria-label={`Run ADHD Aid on ${selected.size} conversations`}
    className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 font-medium py-2 px-4 min-h-[44px] rounded-lg text-sm transition-colors"
  >
    <ClipboardIcon className="w-4 h-4" />
    {batchRunning ? `Running ${batchProgress.done}/${batchProgress.total}…` : `Run ADHD (${selected.size})`}
  </button>
</div>
```
Under the toolbar, when a batch finishes with failures, show a note:
```tsx
{!batchRunning && batchProgress.total > 0 && batchProgress.failed > 0 && (
  <p className="text-amber-300/90 text-sm mt-2" role="status">
    {batchProgress.failed} of {batchProgress.total} could not be analyzed and {batchProgress.failed === 1 ? "was" : "were"} skipped.
  </p>
)}
```
Import `ClipboardIcon` (and keep `SparklesIcon`) in the page's icon import.

> Note: `Group Thesis` still requires ≥2 (`startGroupAnalysis` already guards `< 2`); `Run ADHD` allows ≥1 (batch is per-conversation).

- [ ] **Step 5: Daily Rollup link.** In the header, add a link next to the Refresh button:
```tsx
<Link
  href="/rollup"
  className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
>
  <CalendarIcon className="w-4 h-4 flex-shrink-0" />
  Daily Rollup
</Link>
```
Import `CalendarIcon`.

- [ ] **Step 6: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors.

- [ ] **Step 7: Browser verify.** With the dev server running: enter select mode, select 2+ conversations, click **Run ADHD**, watch progress advance, and confirm the `A` badges light up afterward. Confirm **Group Thesis** still navigates to `/analyze-group?ids=…`. Confirm the **Daily Rollup** link routes to `/rollup`.

- [ ] **Step 8: Commit.**

```bash
git add src/app/page.tsx
git commit -m "feat: lens badges, batch ADHD, and Daily Rollup link on home

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Rollup lib (`src/lib/rollup.ts`)

**Files:**
- Create: `src/lib/rollup.ts`

**Interfaces:**
- Consumes: `chatCompletion`, `extractJsonObject` from `src/lib/analysis`; `AdhdAnalysis`, `Rollup` from `src/lib/adhd`.
- Produces:
  - `DayConvoOutput` type (`{ title: string; date: string; analysis: AdhdAnalysis }`)
  - `toRollup(raw): Rollup`
  - `generateRollup(day: string, conversations: DayConvoOutput[], previousRollup?: Rollup): Promise<Rollup>`

- [ ] **Step 1: Create the file.**

```ts
import { chatCompletion, extractJsonObject } from "./analysis";
import type { AdhdAnalysis, Rollup } from "./adhd";

export interface DayConvoOutput {
  title: string;
  date: string;
  analysis: AdhdAnalysis;
}

const ROLLUP_FIELDS: (keyof Rollup)[] = [
  "tomorrow_plan",
  "aging_commitments",
  "conflicts_at_risk",
  "social_ledger",
  "tomorrow_events",
  "today_paragraph",
  "dropped",
];

export function toRollup(raw: Record<string, unknown>): Rollup {
  const result = {} as Record<keyof Rollup, string>;
  for (const field of ROLLUP_FIELDS) {
    const v = raw[field];
    result[field] = typeof v === "string" && v.trim()
      ? v
      : "The AI did not return this section. Re-run the rollup to fill it in.";
  }
  return result;
}

const ROLLUP_SYSTEM_PROMPT = `You are the end-of-day executive function layer for a person with ADHD. Your input is the set of structured extractions from every conversation they had on a given day, plus optionally the previous day's rollup. Each extraction was made in isolation; your job is to see the whole day at once and produce one plan the user can act on tomorrow. The user will read only your output.

## Processing rules

1. Deduplicate and reconcile. The same commitment often appears in multiple conversations. Merge duplicates into one item, keeping the earliest deadline and every person expecting it. If two extractions conflict (different deadlines, amounts, decisions), flag the conflict explicitly — do not silently pick one.

2. Re-prioritize globally. Re-rank everything against each other. Priority order: (1) commitments to others with deadlines in the next 48 hours; (2) prep whose start date is today or tomorrow; (3) soft commitments at risk of silently expiring; (4) everything else. Cap tomorrow's list at 5 items. Overflow goes under conflicts/at-risk, not the plan.

3. Track commitment aging. If a previous rollup is provided, carry forward any commitment not yet marked done, and show its age in days. An item carried 3+ times gets promoted to the top with a suggested renegotiation script.

4. Detect the day's drift. Compare intended vs. actual in one neutral, pattern-level sentence — data for tomorrow, not blame.

5. Consolidate people into one social ledger: who was interacted with, social debts accumulated (replies owed, thank-yous), and relationships pending more than a few days. Surface at most 3 cheap high-value social actions.

6. Build tomorrow's runway: tomorrow's known events in time order with prep status; one suggested "first block" (the single most important task at the user's best hours, phrased as its smallest first step with a 1.5x time estimate); flag any conflict or impossible sequencing now.

7. Close or kill open loops. Merge all open loops; drop any resolved later in the day; attach the rest to a task or park them. Loops surviving three rollups should be suggested for deletion.

8. Tone: neutral, no scolding, no ADHD mention, no "you failed to". Facts and next actions. The whole rollup must be readable in under 60 seconds.

You MUST respond with valid JSON matching this exact schema:
{
  "tomorrow_plan": "First block: <smallest first step, time estimate, suggested slot>. Then up to 4 more ranked items, each one line with the deadline in bold.",
  "aging_commitments": "Carried items with age in days; renegotiation script for anything 3+ days old. 'None.' if clean.",
  "conflicts_at_risk": "Contradictions between conversations, overcommitted slots, overflow tasks needing a decision or renegotiation. 'None.' if clean.",
  "social_ledger": "At most 3 cheap high-value social actions; longer-pending relationship debts below, one line each.",
  "tomorrow_events": "Time-ordered events, each with prep status (ready / needs X min / unprepared). 'None.' if none.",
  "today_paragraph": "3-4 sentences: what got decided, what moved, the drift observation — written so reading only this a week later reconstructs the day.",
  "dropped": "Loops and items closed or killed today, one line each, so the user trusts nothing vanished silently. 'None.' if none."
}

Each field is a prose string (may contain newlines and simple markdown like bold or hyphen bullets). Do not return arrays or nested objects.`;

function fmtCommitment(c: AdhdAnalysis["commitments"][number]): string {
  const dir = c.direction === "other_to_user" ? `${c.who} owes me` : `I owe ${c.who}`;
  return `    - [${c.confidence}] ${dir}: ${c.what} (deadline: ${c.deadline})`;
}

function fmtConvo(c: DayConvoOutput, i: number): string {
  const a = c.analysis;
  const commitments = a.commitments.length ? a.commitments.map(fmtCommitment).join("\n") : "    - none";
  const people = a.people.length ? a.people.map((p) => `    - ${p.name} (${p.relationship}); owed: ${p.owed}`).join("\n") : "    - none";
  const loops = a.open_loops.length ? a.open_loops.map((l) => `    - ${l}`).join("\n") : "    - none";
  const ahead = a.ahead.length ? a.ahead.map((x) => `    - ${x.event} (${x.date}); prep: ${x.prep}; start: ${x.start_when}`).join("\n") : "    - none";
  return `--- CONVERSATION ${i + 1}: "${c.title}" (${c.date}) ---
  Summary: ${a.summary}
  Commitments:
${commitments}
  People:
${people}
  Open loops:
${loops}
  Ahead:
${ahead}`;
}

function fmtPreviousRollup(prev: Rollup): string {
  return `--- PREVIOUS ROLLUP (for commitment aging and loop-killing) ---
Tomorrow plan (which was for today): ${prev.tomorrow_plan}
Aging commitments: ${prev.aging_commitments}
Conflicts/at-risk: ${prev.conflicts_at_risk}
Open items today paragraph: ${prev.today_paragraph}
Dropped: ${prev.dropped}`;
}

export async function generateRollup(
  day: string,
  conversations: DayConvoOutput[],
  previousRollup?: Rollup
): Promise<Rollup> {
  const convoBlocks = conversations.map(fmtConvo).join("\n\n");
  const prevBlock = previousRollup ? `\n\n${fmtPreviousRollup(previousRollup)}` : "";

  const userPrompt = `Day being rolled up: ${day}

Below are the per-conversation ADHD extractions for this day. Produce one rollup for tomorrow following your rules.${prevBlock}

${convoBlocks}`;

  const content = await chatCompletion(
    [
      { role: "system", content: ROLLUP_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    true
  );
  return toRollup(extractJsonObject(content));
}
```

- [ ] **Step 2: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors.

- [ ] **Step 3: Commit.**

```bash
git add src/lib/rollup.ts
git commit -m "feat: add daily rollup lib

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Rollup route (`src/app/api/rollup/route.ts`)

**Files:**
- Create: `src/app/api/rollup/route.ts`

**Interfaces:**
- Consumes: `generateRollup`, `DayConvoOutput` from `src/lib/rollup`; `Rollup` from `src/lib/adhd`; `friendlyError` from `src/lib/api-error`.
- Produces: `POST /api/rollup` returning `{ rollup }`.

- [ ] **Step 1: Create the route.** It performs no Omi fetch — the client sends the structured day outputs and (optionally) the prior rollup.

```ts
import { NextRequest, NextResponse } from "next/server";
import { generateRollup, type DayConvoOutput } from "@/lib/rollup";
import type { Rollup } from "@/lib/adhd";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { day, conversations, previousRollup } = await req.json();

    if (typeof day !== "string" || !day) {
      return NextResponse.json({ error: "Missing day for rollup." }, { status: 400 });
    }
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return NextResponse.json(
        { error: "No conversation outputs to roll up for this day." },
        { status: 400 }
      );
    }

    const rollup = await generateRollup(
      day,
      conversations as DayConvoOutput[],
      (previousRollup as Rollup | undefined) ?? undefined
    );

    return NextResponse.json({ rollup });
  } catch (err) {
    console.error("rollup failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
```

- [ ] **Step 2: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors.

- [ ] **Step 3: Commit.**

```bash
git add src/app/api/rollup/route.ts
git commit -m "feat: add /api/rollup route

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Daily Rollup page (`src/app/rollup/page.tsx`) + rollup export

**Files:**
- Create: `src/app/rollup/page.tsx`
- Modify: `src/lib/obsidian.ts` (add rollup builder)

**Interfaces:**
- Consumes: `fetchJson`; `getConversations`-backed list via `/api/conversations`; `getAdhdAnalysis`, `saveAdhdAnalysis`, `getRollup`, `saveRollup`, `getRollupDays`, `getPreviousRollup` from `adhd-storage`; `AdhdAnalysis`, `Rollup` from `adhd`; `formatDateTime` from `format`; icons.
- Produces: the day-anchored rollup UI and `buildRollupMarkdown`/`exportRollupToObsidian`/`downloadRollupMarkdown` in `obsidian.ts`.

- [ ] **Step 1: Add the rollup markdown builder to `src/lib/obsidian.ts`.** Import `import type { StoredRollup } from "./adhd-storage";` at the top.

```ts
export function buildRollupMarkdown(stored: StoredRollup): { markdown: string; filename: string } {
  const r = stored.rollup;
  const markdown = `---
title: "Daily Rollup — ${stored.day}"
date: ${stored.day}
analyzed: ${stored.timestamp}
type: adhd-rollup
source: Omi DK2
tags:
  - omi-analysis
  - adhd-aid
  - daily-rollup
---

# Daily Rollup — ${stored.day}

## 🌅 Tomorrow's plan

${r.tomorrow_plan}

## ⏳ Aging commitments

${r.aging_commitments}

## ⚠️ Conflicts & at-risk

${r.conflicts_at_risk}

## 👥 Social ledger

${r.social_ledger}

## 📅 Tomorrow's events

${r.tomorrow_events}

## 🧠 Today in one paragraph

${r.today_paragraph}

## 🗑 Dropped

${r.dropped}

---
*Generated by [[Omi Thesis Analyzer]] — ADHD Aid daily rollup.*
`;
  return { markdown, filename: `Rollup - ${stored.day}` };
}

export function exportRollupToObsidian(stored: StoredRollup): { uri: string; uriTooLong: boolean } {
  const { markdown, filename } = buildRollupMarkdown(stored);
  const params = new URLSearchParams({
    vault: "PhDVault",
    name: `Fieldwork/Omi Analysis/${filename}`,
    content: markdown,
    append: "false",
  });
  const uri = `obsidian://advanced-uri?${params.toString()}`;
  return { uri, uriTooLong: uri.length > MAX_URI_LENGTH };
}

export function downloadRollupMarkdown(stored: StoredRollup): void {
  const { markdown, filename } = buildRollupMarkdown(stored);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Create `src/app/rollup/page.tsx`.** The page: loads the conversation list, groups by calendar day, lets the user pick a day, ensures each day-conversation has an ADHD analysis (running `/api/analyze-adhd` for missing ones with progress), then calls `/api/rollup` with the prior day's stored rollup, saves, and renders the seven sections.

```tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format";
import type { AdhdAnalysis, Rollup } from "@/lib/adhd";
import {
  getAdhdAnalysis, saveAdhdAnalysis, getRollup, saveRollup, getPreviousRollup,
} from "@/lib/adhd-storage";
import { exportRollupToObsidian, downloadRollupMarkdown } from "@/lib/obsidian";
import {
  ArrowLeftIcon, CalendarIcon, WarningIcon, LoaderIcon, RefreshIcon,
  ExternalLinkIcon, DownloadIcon, CheckIcon,
} from "@/components/icons";

interface ConvoLite {
  id: string;
  created_at: string;
  structured?: { title?: string };
}

function dayOf(iso: string): string {
  return iso.length >= 10 ? iso.split("T")[0] : "unknown-date";
}

const ROLLUP_SECTIONS: { key: keyof Rollup; heading: string }[] = [
  { key: "tomorrow_plan", heading: "🌅 Tomorrow's plan" },
  { key: "aging_commitments", heading: "⏳ Aging commitments" },
  { key: "conflicts_at_risk", heading: "⚠️ Conflicts & at-risk" },
  { key: "social_ledger", heading: "👥 Social ledger" },
  { key: "tomorrow_events", heading: "📅 Tomorrow's events" },
  { key: "today_paragraph", heading: "🧠 Today in one paragraph" },
  { key: "dropped", heading: "🗑 Dropped" },
];

export default function RollupPage() {
  const [convos, setConvos] = useState<ConvoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [exported, setExported] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<ConvoLite[]>("/api/conversations");
        setConvos(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reach Omi");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Group conversations by calendar day, newest day first.
  const days = Array.from(
    convos.reduce((m, c) => {
      const d = dayOf(c.created_at);
      (m.get(d) ?? m.set(d, []).get(d)!).push(c);
      return m;
    }, new Map<string, ConvoLite[]>())
  ).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const selectDay = useCallback((day: string) => {
    setSelectedDay(day);
    setProgress({ done: 0, total: 0 });
    const existing = getRollup(day);
    setRollup(existing ? existing.rollup : null);
  }, []);

  const generate = useCallback(async (dayConvos: ConvoLite[], day: string) => {
    setRunning(true);
    setError(null);
    try {
      // 1. Ensure each conversation has an ADHD analysis.
      const outputs: { title: string; date: string; analysis: AdhdAnalysis }[] = [];
      const total = dayConvos.length;
      setProgress({ done: 0, total });
      for (let i = 0; i < dayConvos.length; i++) {
        const c = dayConvos[i];
        let stored = getAdhdAnalysis(c.id);
        if (!stored) {
          const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: { structured?: { title?: string }; created_at?: string } }>(
            "/api/analyze-adhd",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversationId: c.id }),
            }
          );
          stored = saveAdhdAnalysis({
            conversationId: c.id,
            title: data.conversation?.structured?.title || c.structured?.title || "Untitled",
            date: data.conversation?.created_at || c.created_at,
            analysis: data.analysis,
          });
        }
        outputs.push({
          title: stored.title,
          date: stored.date || c.created_at,
          analysis: stored.analysis,
        });
        setProgress({ done: i + 1, total });
      }

      // 2. Roll up, chaining to the prior day's rollup.
      const prev = getPreviousRollup(day);
      const data = await fetchJson<{ rollup: Rollup }>("/api/rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day,
          conversations: outputs,
          previousRollup: prev?.rollup,
        }),
      });
      saveRollup({ day, conversationIds: dayConvos.map((c) => c.id), rollup: data.rollup });
      setRollup(data.rollup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollup failed");
    } finally {
      setRunning(false);
    }
  }, []);

  const doExport = useCallback(() => {
    if (!selectedDay) return;
    const stored = getRollup(selectedDay);
    if (!stored) return;
    const { uri, uriTooLong } = exportRollupToObsidian(stored);
    if (uriTooLong) downloadRollupMarkdown(stored);
    else window.open(uri, "_blank");
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [selectedDay]);

  const doDownload = useCallback(() => {
    if (!selectedDay) return;
    const stored = getRollup(selectedDay);
    if (stored) downloadRollupMarkdown(stored);
  }, [selectedDay]);

  const selectedConvos = selectedDay ? (days.find((d) => d[0] === selectedDay)?.[1] ?? []) : [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2">
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-indigo-400 flex-shrink-0" />
          Daily Rollup
        </h1>
        <p className="text-slate-400 text-sm">
          Pick a day to merge its conversations into one plan for tomorrow. Aging carries across days automatically.
        </p>
      </header>

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          <button onClick={() => setError(null)} className="mt-2 text-sm text-slate-400 hover:text-white min-h-[44px] px-2">Dismiss</button>
        </div>
      )}

      {loading && (
        <div className="space-y-3" role="status" aria-label="Loading days">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full" />)}
        </div>
      )}

      {!loading && !selectedDay && (
        <div className="space-y-3" role="list" aria-label="Days with conversations">
          {days.map(([day, list]) => {
            const hasRollup = !!getRollup(day);
            return (
              <button
                key={day}
                onClick={() => selectDay(day)}
                role="listitem"
                className="w-full text-left card p-5 hover:border-indigo-500/50 transition-colors min-h-[44px] flex items-center justify-between"
              >
                <div>
                  <p className="font-semibold text-white">{formatDateTime(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                  <p className="text-slate-400 text-sm mt-1">{list.length} conversation{list.length === 1 ? "" : "s"}</p>
                </div>
                {hasRollup && (
                  <span className="text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded-full">rollup saved</span>
                )}
              </button>
            );
          })}
          {days.length === 0 && (
            <div className="card p-8 text-center">
              <p className="text-slate-400">No conversations to roll up yet.</p>
            </div>
          )}
        </div>
      )}

      {selectedDay && (
        <>
          <button onClick={() => { setSelectedDay(null); setRollup(null); }} className="text-slate-400 hover:text-white text-sm mb-4 inline-flex items-center gap-1.5 min-h-[44px] py-2">
            <ArrowLeftIcon className="w-4 h-4" /> All days
          </button>

          <div className="card p-5 mb-6">
            <p className="font-semibold text-white">{formatDateTime(`${selectedDay}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <p className="text-slate-400 text-sm mt-1">{selectedConvos.length} conversation{selectedConvos.length === 1 ? "" : "s"} this day</p>
            <button
              onClick={() => generate(selectedConvos, selectedDay)}
              disabled={running || selectedConvos.length === 0}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center justify-center gap-2"
            >
              {running ? (
                <>
                  <LoaderIcon className="w-4 h-4 animate-spin" />
                  {progress.total ? `Analyzing ${progress.done}/${progress.total}…` : "Generating…"}
                </>
              ) : rollup ? (
                <><RefreshIcon className="w-4 h-4" /> Regenerate rollup</>
              ) : (
                <><CalendarIcon className="w-4 h-4" /> Generate rollup</>
              )}
            </button>
          </div>

          {rollup && (
            <section aria-label="Daily rollup">
              <div className="flex items-center justify-end gap-2 mb-4">
                <button onClick={doExport} className="text-sm bg-purple-900/40 hover:bg-purple-800/50 text-purple-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
                  {exported ? <><CheckIcon className="w-3.5 h-3.5" /> Saved</> : <><ExternalLinkIcon className="w-3.5 h-3.5" /> Send to Obsidian</>}
                </button>
                <button onClick={doDownload} className="text-sm bg-amber-900/40 hover:bg-amber-800/50 text-amber-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
                  <DownloadIcon className="w-3.5 h-3.5" /> Download .md
                </button>
              </div>
              <div className="space-y-6">
                {ROLLUP_SECTIONS.map(({ key, heading }) => (
                  <div key={key} className="card p-6">
                    <div className="analysis-section">
                      <h3>{heading}</h3>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed mt-3">{rollup[key]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Type-check + lint.** Run: `npx tsc --noEmit` → clean; `npm run lint` → no new errors.

- [ ] **Step 4: Browser verify (full pipeline).** With the dev server running:
  - Open `/rollup`; confirm days list with conversation counts.
  - Pick a day with ≥1 conversation; click **Generate rollup**; watch the `Analyzing k/n` progress (for any conversations lacking ADHD analyses), then the seven sections render.
  - Confirm the day now shows a "rollup saved" badge on the day list.
  - Generate a rollup for an earlier day first, then a later day, and confirm the later rollup's **Aging commitments** reflects the chain (prior rollup was sent — verify via `read_network_requests` that the `/api/rollup` request body contains `previousRollup`).
  - **Download .md** produces a valid note.

- [ ] **Step 5: Commit.**

```bash
git add src/app/rollup/page.tsx src/lib/obsidian.ts
git commit -m "feat: Daily Rollup page with day-anchored aging

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification pass

- [ ] **Step 1: Full build.** Run: `npm run build` → succeeds with no type errors.
- [ ] **Step 2: Lint clean.** Run: `npm run lint` → no errors.
- [ ] **Step 3: Regression — thesis flows unchanged.** In the browser: single thesis analysis, group synthesis (`/analyze-group`), and thesis custom analysis all still work.
- [ ] **Step 4: Two-lens smoke.** A conversation run through **Both** shows thesis + ADHD; a batch ADHD over a multi-select lights the `A` badges; a day rollup generates and chains.
- [ ] **Step 5: Update `README.md`** — add an "ADHD Aid" section describing the per-conversation lens and the Daily Rollup, mirroring the existing "Analysis Dimensions" section. Commit:

```bash
git add README.md
git commit -m "docs: document the ADHD Aid layer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
