# Full Data Export (Backup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Backup" button on the home page that downloads every stored analysis (thesis, group, ADHD, rollups, people) as one JSON file.

**Architecture:** `GET /api/export` reads all 6 `SYNCED_NAMESPACES` from Neon in parallel via the existing `getNamespaceData`, and degrades to `{configured:false}` (HTTP 200) if the store isn't set up. A new `src/lib/export.ts` client module calls that route; on `configured:false` it falls back to reading the same 6 keys straight out of `localStorage`. Either way it downloads a JSON file via the same `Blob`/`URL.createObjectURL` pattern the app's three existing markdown-download functions already use. A button in the home page's nav row triggers it.

**Tech Stack:** Next.js 16 App Router, TypeScript, `@neondatabase/serverless` (existing dependency).

## Global Constraints

- Export covers exactly the 6 namespaces in `SYNCED_NAMESPACES` (`src/lib/kv.ts`) — no more, no less.
- `/api/export` degrades to `{ configured: false }` with HTTP 200 (never 500) when the Neon store isn't configured or a read fails — matches every other store-backed route's posture.
- No restore/import functionality — download only.
- No scheduled/automatic backup — manual trigger only.
- **No test runner exists in this codebase** (confirmed: no jest/vitest/tsx, no `test` script, zero test files under `src/`). Verification in this plan uses `npx tsc --noEmit`, `npm run lint`, `npm run build`, and manual runtime checks (curl against `npm run dev`) — do not introduce a new test framework.

---

## File Structure

- **Create `src/app/api/export/route.ts`** — thin `GET` handler reading all 6 namespaces from Neon.
- **Create `src/lib/export.ts`** — `exportAllData()`: calls the route, falls back to localStorage, triggers the file download.
- **Modify `src/app/page.tsx`** — add a "Backup" button to the nav row.

---

### Task 1: Export API route

**Files:**
- Create: `src/app/api/export/route.ts`

**Interfaces:**
- Consumes: `getStore`, `getNamespaceData`, `SYNCED_NAMESPACES`, `type SyncedNamespace` from `src/lib/kv.ts` (existing exports).
- Produces: the route's JSON response shape, consumed by Task 2: `{ configured: true, exportedAt: string, namespaces: Record<string, unknown> } | { configured: false }`.

- [ ] **Step 1: Write the route**

```typescript
// src/app/api/export/route.ts
import { NextResponse } from "next/server";
import { getStore, getNamespaceData, SYNCED_NAMESPACES } from "@/lib/kv";

// GET /api/export → every synced namespace, bundled for a one-shot backup
// download. Read-only — this route never writes anything.
export async function GET() {
  const sql = getStore();
  if (!sql) {
    return NextResponse.json({ configured: false });
  }

  try {
    const entries = await Promise.all(
      SYNCED_NAMESPACES.map(async (ns) => [ns, await getNamespaceData(sql, ns)] as const)
    );
    const namespaces = Object.fromEntries(entries);

    return NextResponse.json({
      configured: true,
      exportedAt: new Date().toISOString(),
      namespaces,
    });
  } catch (err) {
    console.error("export failed:", err);
    // Degrade rather than error — a broken store should cost the server-side
    // backup source, not surface a 500 for what's ultimately an optional
    // convenience (the client falls back to localStorage on configured:false).
    return NextResponse.json({ configured: false });
  }
}
```

- [ ] **Step 2: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Manual runtime check**

Run: `npm run dev`, then in another terminal:
```bash
curl -s http://localhost:3000/api/export | head -c 300
```
Expected: if `DATABASE_URL` is configured, a JSON body with `"configured":true`, an `"exportedAt"` ISO timestamp, and a `"namespaces"` object with all 6 keys (values may be `null` if a namespace has never been written); if not configured, `{"configured":false}` — either way, no 500.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/export/route.ts
git commit -m "feat(export): add GET /api/export bundling all synced namespaces"
```

---

### Task 2: Client export module and Backup button

**Files:**
- Create: `src/lib/export.ts`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `fetchJson` from `src/lib/fetch-json.ts`
- Consumes: `SYNCED_NAMESPACES` from `src/lib/kv.ts`
- Produces: `export async function exportAllData(): Promise<void>` (throws a readable `Error` on failure, for the button's `catch` to surface)

- [ ] **Step 1: Write the export module**

```typescript
// src/lib/export.ts
"use client";

import { fetchJson } from "./fetch-json";
import { SYNCED_NAMESPACES } from "./kv";

interface ExportResponse {
  configured: boolean;
  exportedAt?: string;
  namespaces?: Record<string, unknown>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function download(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads every synced namespace straight from this browser's localStorage,
 *  for when the server store isn't configured — the same fallback posture
 *  the rest of the app takes when `configured:false` comes back from any
 *  store-backed route. */
function exportFromLocalStorage(): void {
  const namespaces: Record<string, unknown> = {};
  for (const ns of SYNCED_NAMESPACES) {
    try {
      const raw = localStorage.getItem(ns);
      namespaces[ns] = raw ? JSON.parse(raw) : null;
    } catch {
      namespaces[ns] = null;
    }
  }
  download(`trace-backup-${todayStr()}.json`, {
    source: "local",
    exportedAt: new Date().toISOString(),
    namespaces,
  });
}

export async function exportAllData(): Promise<void> {
  const res = await fetchJson<ExportResponse>("/api/export");

  if (!res.configured) {
    exportFromLocalStorage();
    return;
  }

  download(`trace-backup-${todayStr()}.json`, {
    source: "server",
    exportedAt: res.exportedAt,
    namespaces: res.namespaces,
  });
}
```

- [ ] **Step 2: Add the Backup button to the home page nav row**

In `src/app/page.tsx`, add `DownloadIcon` to the existing icons import list (find the `import { ... } from "@/components/icons"` block), and add `exportAllData` as a new import: `import { exportAllData } from "@/lib/export";`.

Add local state for the button near the page's other `useState` calls:
```typescript
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
```

Add a handler:
```typescript
  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportAllData();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };
```

In the nav row (the `<div className="flex items-center gap-2 flex-shrink-0">` block containing the Rollup/People/Usage/Search links), add a button after the Search link and before the Refresh button:

```tsx
            <button
              onClick={handleExport}
              disabled={exporting}
              aria-label="Download a backup of all stored analyses"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <DownloadIcon className="w-4 h-4 flex-shrink-0" />
              {exporting ? "Backing up…" : "Backup"}
            </button>
```

If `exportError` is set, render it near the existing error-display pattern on this page (find how `error` state is currently rendered — likely a dismissible red-bordered card — and reuse that same visual pattern for `exportError`, or a simple inline `<p className="text-sm text-red-400">{exportError}</p>` right after the nav row if no reusable error-card component is cleanly reusable here without restructuring). Read the current file to see the existing error-rendering convention before choosing.

Read `src/app/page.tsx`'s current nav row and imports first to confirm exact current structure (it may have shifted slightly since earlier features were merged) before editing.

- [ ] **Step 3: Verify types compile and lint passes**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Full build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual browser check**

Run: `npm run dev`, open `http://localhost:3000/`, click "Backup", confirm a `trace-backup-YYYY-MM-DD.json` file downloads (check the browser's download bar/folder) and that its content is valid JSON with a `source` field (`"server"` or `"local"` depending on whether `DATABASE_URL` is configured locally) and a `namespaces` object with all 6 keys.

- [ ] **Step 6: Commit**

```bash
git add src/lib/export.ts src/app/page.tsx
git commit -m "feat(export): add Backup button and client export module"
```

---

## Spec Coverage Check

- All 6 `SYNCED_NAMESPACES`, no more/less → Task 1's route, Task 2's localStorage fallback both iterate the same constant
- `configured:false` degrade posture (HTTP 200, never 500) → Task 1 Step 1
- Server-first with localStorage fallback → Task 2 Step 1 (`exportAllData`)
- Single JSON file, no Markdown, no restore/import → not built anywhere in this plan — correct per spec
- Manual trigger only, no scheduled backup → not built anywhere in this plan — correct per spec
- Button in nav row, not a new page → Task 2 Step 2
- Same download mechanism as existing markdown exports (`Blob`/`URL.createObjectURL`) → Task 2 Step 1's `download()` helper, matching `src/lib/obsidian.ts`'s pattern
