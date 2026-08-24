# Thesis & Group Analysis Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user search across every stored thesis-analysis and group-analysis by content — "find every conversation touching water rights" — via a dedicated `/search` page.

**Architecture:** A new `GET /api/search` route reads the two existing Neon-mirrored namespaces (`omi-thesis-analyses`, `omi-thesis-group-analyses`) whole (already how every other route reads them), and does a case-insensitive substring scan over each analysis's text fields in Node — no schema change, no SQL `ILIKE`, since the data is stored as one JSONB document per namespace, not one row per analysis. A new `src/lib/search.ts` module holds the field lists, friendly labels, and matching logic; the route is a thin wrapper. A new `/search` page renders the results, linking conversation hits to `/conversation/[id]` and group hits to `/analyze-group?ids=...` (which already resolves that param against stored groups and shows the cached result).

**Tech Stack:** Next.js 16 App Router, TypeScript, `@neondatabase/serverless` (existing dependency).

## Global Constraints

- Scope is analyses only — thesis (`omi-thesis-analyses`) and group (`omi-thesis-group-analyses`) namespaces. No transcript search, no ADHD-lens search (per spec — the two lenses stay independent).
- Matching is a plain case-insensitive substring scan, not ranked/stemmed full-text search.
- `/api/search` degrades to `{ configured: false, conversationResults: [], groupResults: [] }` with HTTP 200 (never 500) when the Neon store isn't configured — matches every other store-backed route's posture (`src/app/api/store/route.ts`, `src/lib/usage.ts`).
- An empty/whitespace-only query returns empty results immediately, without scanning.
- No pagination, no ranking beyond match-count-then-recency sort, no search history.
- **No test runner exists in this codebase** (confirmed: no jest/vitest/tsx in `node_modules/.bin`, no `test` script in `package.json`, zero test files under `src/`). Verification in this plan uses `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual runtime checks (curl against `npm run dev`) — do not introduce a new test framework.

---

## File Structure

- **Create `src/lib/search.ts`** — field lists + friendly labels for both analysis shapes, the substring-match + snippet logic, and the two result-shape interfaces. Pure functions, no I/O, so they're easy to reason about independent of the route.
- **Create `src/app/api/search/route.ts`** — thin `GET` handler: reads both namespaces via `src/lib/kv.ts`, calls into `src/lib/search.ts`, returns JSON.
- **Create `src/app/search/page.tsx`** — the search UI.
- **Modify `src/app/page.tsx`** — add a nav link to `/search`, reusing the existing `SearchIcon`.

---

### Task 1: Search matching logic and API route

**Files:**
- Create: `src/lib/search.ts`
- Create: `src/app/api/search/route.ts`

**Interfaces:**
- Consumes: `getStore`, `getNamespaceData`, `type Sql` from `src/lib/kv.ts` (existing exports).
- Produces: `export interface SearchMatch { field: string; label: string; snippet: string }`
- Produces: `export interface ConversationSearchResult { conversationId: string; title: string; date?: string; matches: SearchMatch[] }`
- Produces: `export interface GroupSearchResult { conversationIds: string[]; conversationTitles: string[]; timestamp: string; matches: SearchMatch[] }`
- Produces: `export function searchAnalyses(analysesMap: unknown, query: string): ConversationSearchResult[]`
- Produces: `export function searchGroupAnalyses(groupsArray: unknown, query: string): GroupSearchResult[]`

- [ ] **Step 1: Write the field lists, labels, and snippet helper**

```typescript
// src/lib/search.ts

/**
 * Content search over the thesis lens's stored output — the 8
 * per-conversation dimensions and the 5 group-analysis dimensions. Not
 * transcripts (not stored durably) and not the ADHD lens (the two lenses
 * stay independent — see PRODUCT.md).
 *
 * Matching is a plain case-insensitive substring scan run in Node, not SQL
 * ILIKE: both source namespaces are mirrored to Neon as one JSONB document
 * per namespace (see kv.ts's putNamespaceData/getNamespaceData), not one
 * row per analysis, so there's nothing for ILIKE to filter without a much
 * larger storage restructure. This is the equivalent behavior at this
 * data volume.
 */

export interface SearchMatch {
  field: string;
  label: string;
  snippet: string;
}

export interface ConversationSearchResult {
  conversationId: string;
  title: string;
  date?: string;
  matches: SearchMatch[];
}

export interface GroupSearchResult {
  conversationIds: string[];
  conversationTitles: string[];
  timestamp: string;
  matches: SearchMatch[];
}

const THESIS_FIELD_LABELS: Record<string, string> = {
  rq1_documentary_record: "RQ1 — Documentary Record",
  rq2_everyday_practices: "RQ2 — Everyday Practices",
  rq3_cskt_intersection: "RQ3 — CSKT Intersection",
  rq4_wildness_imaginary: "RQ4 — Wildness Imaginary",
  conditions_check: "Orienting Conditions",
  rival_hypothesis_test: "Rival Hypothesis Test",
  refutation_signals: "Refutation Signals",
  forward_thinking: "Forward Thinking",
  "custom.result": "Custom Question",
};

const GROUP_FIELD_LABELS: Record<string, string> = {
  cross_conversation_themes: "Cross-Conversation Themes",
  contradictions_and_tensions: "Contradictions & Tensions",
  evolution_and_patterns: "Evolution & Patterns",
  synthesis: "Synthesis",
  forward_thinking: "Forward Thinking",
  "custom.result": "Custom Question",
};

const SNIPPET_RADIUS = 60; // chars of context on each side of the first match

/** Returns a snippet centered on the first case-insensitive match of `query`
 *  in `text`, or null if there's no match. */
function snippetFor(text: string, query: string): string | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/** Scans `fieldLabels`' keys against `record`, returning one SearchMatch per
 *  matching field. `"custom.result"` is looked up as record.custom?.result. */
function matchFields(
  record: Record<string, unknown>,
  fieldLabels: Record<string, string>,
  query: string
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const [field, label] of Object.entries(fieldLabels)) {
    const value =
      field === "custom.result"
        ? (record.custom as { result?: unknown } | undefined)?.result
        : record[field];
    if (typeof value !== "string" || !value) continue;
    const snippet = snippetFor(value, query);
    if (snippet !== null) matches.push({ field, label, snippet });
  }
  return matches;
}
```

- [ ] **Step 2: Write `searchAnalyses` and `searchGroupAnalyses`**

Append to `src/lib/search.ts`:

```typescript
/** `analysesMap` is the raw JSONB value of the omi-thesis-analyses
 *  namespace: expected shape Record<conversationId, StoredAnalysis>, but
 *  read as `unknown` since it comes straight from Postgres JSONB — this
 *  function defensively narrows it rather than trusting the shape. */
export function searchAnalyses(analysesMap: unknown, query: string): ConversationSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (!analysesMap || typeof analysesMap !== "object" || Array.isArray(analysesMap)) return [];

  const results: ConversationSearchResult[] = [];
  for (const [conversationId, raw] of Object.entries(analysesMap as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const matches = matchFields(record, THESIS_FIELD_LABELS, trimmed);
    if (matches.length === 0) continue;
    results.push({
      conversationId,
      title: typeof record.title === "string" && record.title ? record.title : "Untitled",
      date: typeof record.date === "string" ? record.date : undefined,
      matches,
    });
  }

  return results.sort((a, b) => {
    if (b.matches.length !== a.matches.length) return b.matches.length - a.matches.length;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });
}

/** `groupsArray` is the raw JSONB value of the omi-thesis-group-analyses
 *  namespace: expected shape StoredGroupAnalysis[] (an array, unlike the
 *  per-conversation namespace above — confirmed from
 *  src/app/analyze-group/page.tsx's storage format). */
export function searchGroupAnalyses(groupsArray: unknown, query: string): GroupSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  if (!Array.isArray(groupsArray)) return [];

  const results: GroupSearchResult[] = [];
  for (const raw of groupsArray) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const analysis = record.analysis;
    if (!analysis || typeof analysis !== "object") continue;

    // custom lives on the outer record in StoredGroupAnalysis, not inside
    // `analysis` — matchFields reads record.custom, so pass the outer
    // record's custom through onto a combined view for the lookup.
    const combined = { ...(analysis as Record<string, unknown>), custom: record.custom };
    const matches = matchFields(combined, GROUP_FIELD_LABELS, trimmed);
    if (matches.length === 0) continue;

    const conversationIds = Array.isArray(record.conversationIds)
      ? (record.conversationIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const conversations = Array.isArray(record.conversations) ? (record.conversations as unknown[]) : [];
    const conversationTitles = conversations
      .map((c) => (c && typeof c === "object" ? (c as { title?: unknown }).title : undefined))
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    results.push({
      conversationIds: [...conversationIds].sort(),
      conversationTitles,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : "",
      matches,
    });
  }

  return results.sort((a, b) => {
    if (b.matches.length !== a.matches.length) return b.matches.length - a.matches.length;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually sanity-check the matching logic**

Run:
```bash
node -e '
function snippetFor(text, query) {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + query.length + 60);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end).trim() + suffix;
}
const text = "The family described their water rights as inherited from the original homestead patent, filed in 1911.";
console.log(snippetFor(text, "water rights"));
console.log(snippetFor(text, "nonexistent term"));
'
```
Expected: first line prints a snippet containing "water rights" (with a leading `…` if the match isn't at the very start); second line prints `null`. This confirms the snippet logic in isolation before Task 1's route wires it up to real data.

- [ ] **Step 5: Write the API route**

```typescript
// src/app/api/search/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData } from "@/lib/kv";
import { searchAnalyses, searchGroupAnalyses } from "@/lib/search";

// GET /api/search?q=<term> → substring search across stored thesis and
// group analyses. See src/lib/search.ts for why this isn't SQL ILIKE.
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ configured: true, conversationResults: [], groupResults: [] });
  }

  const sql = getStore();
  if (!sql) {
    return NextResponse.json({ configured: false, conversationResults: [], groupResults: [] });
  }

  try {
    const [analysesData, groupsData] = await Promise.all([
      getNamespaceData(sql, "omi-thesis-analyses"),
      getNamespaceData(sql, "omi-thesis-group-analyses"),
    ]);

    return NextResponse.json({
      configured: true,
      conversationResults: searchAnalyses(analysesData, query),
      groupResults: searchGroupAnalyses(groupsData, query),
    });
  } catch (err) {
    console.error("search failed:", err);
    // Degrade rather than error — a broken store should cost search
    // results, not surface a 500 for what's ultimately an optional feature.
    return NextResponse.json({ configured: false, conversationResults: [], groupResults: [] });
  }
}
```

- [ ] **Step 6: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual runtime check**

Run: `npm run dev`, then in another terminal:
```bash
curl -s "http://localhost:3000/api/search?q=water" | head -c 500
```
Expected: if `DATABASE_URL` is configured and there's matching data, a JSON body with populated `conversationResults`/`groupResults`; if not configured, `{"configured":false,"conversationResults":[],"groupResults":[]}`; either way, no 500. Then:
```bash
curl -s "http://localhost:3000/api/search?q=" | head -c 200
```
Expected: `{"configured":true,"conversationResults":[],"groupResults":[]}` — confirms the empty-query short-circuit.

- [ ] **Step 8: Commit**

```bash
git add src/lib/search.ts src/app/api/search/route.ts
git commit -m "feat(search): add thesis/group analysis search matching and API route"
```

---

### Task 2: Search page and nav link

**Files:**
- Create: `src/app/search/page.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`
- Consumes: `SearchMatch`, `ConversationSearchResult`, `GroupSearchResult` types from `src/lib/search.ts` (Task 1)
- Consumes: `SearchIcon`, `ArrowLeftIcon` from `src/components/icons.tsx` (both already exported — `SearchIcon` is already used on the home page's title filter, `ArrowLeftIcon` is used on `/usage` and `/rollup`)

- [ ] **Step 1: Write the search page**

```tsx
// src/app/search/page.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import type { ConversationSearchResult, GroupSearchResult } from "@/lib/search";
import { ArrowLeftIcon, SearchIcon } from "@/components/icons";

interface SearchResponse {
  configured: boolean;
  conversationResults: ConversationSearchResult[];
  groupResults: GroupSearchResult[];
}

const EMPTY: SearchResponse = { configured: true, conversationResults: [], groupResults: [] };
const DEBOUNCE_MS = 300;

function formatDate(date?: string): string {
  if (!date) return "";
  return date.length >= 10 ? date.slice(0, 10) : date;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResult(EMPTY);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetchJson<SearchResponse>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((data) => {
          setResult(data);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Search failed."))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const hasResults = result.conversationResults.length > 0 || result.groupResults.length > 0;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/"
        className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back
      </Link>

      <h1 className="text-2xl font-bold text-white mb-6">Search</h1>

      <div className="relative mb-6">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search thesis and group analyses…"
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        />
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {!hasQuery && !error && (
        <p className="text-sm text-slate-400">
          Search across every stored thesis analysis and group analysis.
        </p>
      )}

      {hasQuery && !result.configured && !error && (
        <p className="text-sm text-slate-400">
          Search needs the server-side store configured (same one used for cross-device sync). Nothing to search yet.
        </p>
      )}

      {hasQuery && loading && <p className="text-sm text-slate-400">Searching…</p>}

      {hasQuery && !loading && result.configured && !hasResults && !error && (
        <p className="text-sm text-slate-400">No matches for &ldquo;{query.trim()}&rdquo;.</p>
      )}

      {result.conversationResults.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-medium text-slate-400 mb-3">Conversations</h2>
          <ul className="space-y-3 list-none">
            {result.conversationResults.map((r) => (
              <li key={r.conversationId} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <Link href={`/conversation/${r.conversationId}`} className="block">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-slate-200 font-medium">{r.title}</span>
                    <span className="text-xs text-slate-500 flex-shrink-0">{formatDate(r.date)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {r.matches.map((m) => (
                      <div key={m.field} className="text-sm">
                        <span className="text-cyan-400">{m.label}: </span>
                        <span className="text-slate-400">{m.snippet}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.groupResults.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-400 mb-3">Groups</h2>
          <ul className="space-y-3 list-none">
            {result.groupResults.map((r) => (
              <li key={r.conversationIds.join(",")} className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
                <Link href={`/analyze-group?ids=${r.conversationIds.join(",")}`} className="block">
                  <div className="text-slate-200 font-medium mb-2">
                    {r.conversationTitles.length > 0 ? r.conversationTitles.join(", ") : `${r.conversationIds.length} conversations`}
                  </div>
                  <div className="space-y-1.5">
                    {r.matches.map((m) => (
                      <div key={m.field} className="text-sm">
                        <span className="text-cyan-400">{m.label}: </span>
                        <span className="text-slate-400">{m.snippet}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Add the nav link on the home page**

In `src/app/page.tsx`, `SearchIcon` is already imported (used by the existing title-filter search box). In the nav row (the `<div className="flex items-center gap-2 flex-shrink-0">` block containing the Rollup/People/Usage links), add a fourth link after the Usage link and before the Refresh button:

```tsx
            <Link
              href="/search"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
            >
              <SearchIcon className="w-4 h-4 flex-shrink-0" />
              Search
            </Link>
```

Read the current file first to confirm the exact surrounding block (it may have shifted slightly since the usage-visibility feature added the Usage link) before inserting.

- [ ] **Step 3: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Full build**

Run: `npm run build`
Expected: build succeeds, `/search` listed as a route in the build output.

- [ ] **Step 5: Manual browser check**

Run: `npm run dev`, open `http://localhost:3000/`, click "Search", type a query, confirm: the debounced request fires (visible in the dev server log or network tab), results render grouped into Conversations/Groups (or the not-configured/no-results state, depending on local `DATABASE_URL`/data), and clicking a conversation result navigates to `/conversation/[id]` while a group result navigates to `/analyze-group?ids=...`. Then navigate back via "Back" and confirm it returns to `/`.

- [ ] **Step 6: Commit**

```bash
git add src/app/search/page.tsx src/app/page.tsx
git commit -m "feat(search): add /search page and nav link"
```

---

## Spec Coverage Check

- Analyses-only scope (thesis + group, no transcripts, no ADHD) → Task 1's `searchAnalyses`/`searchGroupAnalyses` only read the two named namespaces
- JS-side substring match instead of SQL ILIKE, with rationale → Task 1 Step 1's doc comment + implementation
- Friendly field labels matching existing UI → Task 1's `THESIS_FIELD_LABELS`/`GROUP_FIELD_LABELS`
- `configured: false` degrade posture, empty-query short-circuit → Task 1 Step 5 (route)
- `/search` page, debounced input, grouped results, not-configured/no-results/error states → Task 2 Step 1
- Group result links to `/analyze-group?ids=...` reusing existing cache lookup (no new detail route) → Task 2 Step 1 (Link href), confirmed against existing `groupKey()`/`idsParam` logic during spec research, no new task needed
- Nav link → Task 2 Step 2
- Out of scope (ranking/stemming, search history, saved searches, pagination): not built anywhere in this plan — correct per spec
