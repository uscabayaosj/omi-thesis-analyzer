# Full Data Export (Backup) — Design Spec (2026-08-24)

## Purpose

Analyses are the most expensive, least replaceable artifact in this app — a
day of Omi recordings turned into dissertation evidence or a daily plan by a
paid LLM call. There is currently no way to get all of it out of the app in
one shot. This adds a single "Backup" action that downloads every stored
analysis as one JSON file.

## Approved decisions

- **Format: single JSON file, all 6 synced namespaces** (`omi-thesis-analyses`,
  `omi-adhd-analyses`, `omi-adhd-rollups`, `omi-thesis-group-analyses`,
  `omi-people`, `omi-people-pending` — the exact list in `SYNCED_NAMESPACES`,
  `src/lib/kv.ts`). Machine-readable, not meant for reading — Markdown export
  of individual analyses already exists (`src/lib/obsidian.ts`) and stays
  separate.
- **Trigger: manual download button only.** No scheduled/automatic backups,
  no server-side nightly dump — out of scope for this pass.
- **Source: Neon (server), with a localStorage fallback.** The server mirror
  is meant to be the union of all devices' data (especially now that the
  thesis-analyses sync bug is fixed), so it's the more complete backup
  source. If the store isn't configured (`configured: false`, the same
  degrade signal every other store-backed route already returns), the
  client falls back to bundling this browser's own `localStorage` instead —
  the button always produces something, regardless of setup.
- **No restore/import.** This is one-directional: download only. Restoring
  from a backup file is out of scope.
- **UI: a button in the home page's nav row**, not a new page — this is a
  one-shot action (like the existing Refresh button), not a destination.

## API

`GET /api/export` (`src/app/api/export/route.ts`):

- Reads all 6 `SYNCED_NAMESPACES` from Neon via the existing
  `getNamespaceData(sql, namespace)` (`src/lib/kv.ts`), in parallel.
- Returns `{ configured: true, exportedAt: <ISO timestamp>, namespaces: Record<SyncedNamespace, unknown> }` on success.
- Returns `{ configured: false }` (HTTP 200, never 500) if the store isn't
  configured or a read fails — matching every other store-backed route's
  degrade posture (`src/app/api/store/route.ts`, `src/lib/usage.ts`,
  `src/app/api/search/route.ts`).

## Client

New module `src/lib/export.ts`:

- `exportAllData(): Promise<void>` — calls `/api/export`. If
  `configured: true`, builds the download directly from the response. If
  `configured: false`, falls back to reading all 6 `SYNCED_NAMESPACES` keys
  straight out of `localStorage` (parsing each with `JSON.parse`, defaulting
  to `null` on a missing/corrupt key) and bundles them into the same shape,
  with `source: "local"` instead of `"server"` recorded in the output so a
  restored/inspected file is traceable to where it came from.
- Downloads via the same `Blob([...], { type: "application/json" })` +
  `URL.createObjectURL` + synthetic `<a download>` click + `revokeObjectURL`
  pattern already used by `src/lib/obsidian.ts`'s three markdown-download
  functions — no new download mechanism introduced.
- Filename: `trace-backup-YYYY-MM-DD.json` (today's date, from the export
  moment, not `exportedAt` from a possibly-stale server response — cosmetic
  only, doesn't affect content).

## UI

In `src/app/page.tsx`'s nav row (the `<div className="flex items-center
gap-2 flex-shrink-0">` block already holding Rollup/People/Usage/Search),
add a "Backup" button (not a `<Link>`, since it's an action not a route)
using the existing `DownloadIcon`, styled consistently with the Refresh
button (same disabled-while-busy pattern, since the export takes a network
round-trip). On failure (network error, unexpected response shape), show a
brief inline error using whatever lightweight error-surfacing convention the
home page already uses elsewhere — no new error UI pattern.
