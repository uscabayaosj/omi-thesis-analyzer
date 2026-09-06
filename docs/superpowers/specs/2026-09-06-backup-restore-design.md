# Backup restore — Design (2026-09-06)

**Status:** approved by the user ("wire in"); implemented alongside the
reliability pass on `feat/reliability-pass`.

## Why

The 2026-08-24 export spec shipped a one-way Backup: every synced namespace
as one JSON file, from the server when it is configured and from this
browser's `localStorage` otherwise. Restore was scoped out. A localStorage-
first app whose analyses are its most expensive artifact therefore had a
backup it could not use: a lost phone, cleared site data, or a bad merge left
the file as evidence of what had existed, not a way back.

## Decisions

- **Restore is a merge, never a replace.** The file is treated exactly as a
  pull from another device: per record, newest `timestamp` wins, done-state
  fields on their own clocks, tombstones as records. Ties resolve to what is
  on the device. Nothing on the device is removed unless the backup recorded
  that deletion later than the device last saw the record. This is the same
  rule the server now applies on PUT, so restoring on one device and syncing
  is safe in both directions.
- **Both file shapes are accepted.** A server export holds canonical shapes
  (bare arrays for the two array namespaces); a local export holds raw
  `localStorage` values (also bare arrays). Anything wrapped as `{ list }` is
  unwrapped. Unknown namespace keys are ignored and reported.
- **Preview before commit.** Parsing and planning are pure and happen before
  anything is written: the confirm dialog states the backup's date and
  source and exactly how many records would be added, updated, and deleted.
  A backup that changes nothing is reported as such with no dialog.
- **The merged copy syncs as usual.** Each written namespace is queued for
  the normal debounced push; the server merges it, so the restore reaches
  the other device on its next pull.
- **UI: a Restore button beside Backup** on the home page, driving a hidden
  file input. Same ghost styling, same notice line for the result. No new
  page.

## Modules

- `src/lib/restore-core.ts` — pure, dependency-free except `merge.ts` and
  `kv.ts` (imported with `.ts` extensions so `node --test` loads it):
  `parseBackup(raw)` validates the file shape; `planRestore(backup, device)`
  returns per-namespace merged values and add / update / delete counts.
- `src/lib/restore.ts` — client: reads the `File`, snapshots `localStorage`,
  plans, and `applyRestore(plan)` writes each changed namespace, schedules
  its push, and nudges the badge when the analyses namespace changed.
- `src/app/page.tsx` — the button, the hidden input, the confirm dialog, the
  result line, and a re-read of the derived state (analyzed ids, gists,
  enrichments) after a restore.

## Tests

`test/restore.test.mts`: shape validation, unknown keys ignored, adds
missing records, keeps the device's newer copy, applies the backup's newer
copy, tie keeps device, tombstones count as deletions and win when newer,
array namespaces in both shapes, `changed` false when identical.
