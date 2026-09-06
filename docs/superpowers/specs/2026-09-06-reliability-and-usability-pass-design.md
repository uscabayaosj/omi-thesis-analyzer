# Reliability and usability pass — Design (2026-09-06)

**Status:** implemented in the same working session; this note records what was
found and the decisions behind each change so the reasoning survives the diff.

## Method

Whole-codebase read (every route, lib, page and component; prior critiques in
`.impeccable/critique`; every spec in this folder), then a defect list sorted
by consequence. Build health was clean at the start (tsc, eslint, 80 tests),
so nothing here is a regression fix — these are latent defects and gaps.

## Findings and decisions

### 1. A client can wipe a server namespace (data safety)

`PUT /api/store` replaced a namespace wholesale with whatever the client sent.
Every pull merges per record, but nothing protected the *server* copy: a
device with an empty or corrupt `localStorage` that writes before its first
pull lands (a new browser, cleared site data, a slow connection) pushes a
one-record map and the server loses everything else. The people page already
documented this exact race for voice enrollment.

**Decision:** the server merges on PUT with the same rules the client uses
on pull (`mergeMaps`, per-record last-write-wins, done-state fields on their
own clocks, tombstones as records). A PUT can therefore only add or update
records; a removal must be an explicit tombstone. Two side-effects had to be
closed for this to be safe:

- `omi-thesis-analyses` merged by `current.timestamp` only, and a custom
  analysis is saved without bumping that clock. Under a merge that tie
  resolved to the server copy and the custom result would have been dropped.
  The list merge now overlays `current.custom` from whichever side has the
  newer `custom.timestamp` — the same shape as the done-field overlay.
- `omi-thesis-group-analyses` merged by *list length* ("longer wins"), which
  loses a newly-added group whenever the other side has more. It now merges by
  group key (sorted conversation ids) with the same clock rules.

The read-modify-write on the server is not transactional; two devices
pushing the same namespace in the same second can still lose one push's
changes until that device's next write. That is the pre-existing window,
narrowed, and localStorage still holds the write.

### 2. The server-side rollup job overwrote the analyses namespace

`/api/rollup/job` read `omi-adhd-analyses` at the start of a run, spent
minutes in LLM calls, then wrote the whole map back — discarding anything the
phone pushed in between (a ticked promise, a let-go, an analysis run on the
other device). Same for `omi-adhd-rollups`.

**Decision:** the job re-reads each namespace immediately before writing and
merges its new records in (`mergeMaps` again), so it can only add. It also
now feeds `letGoKeys` to the rollup prompt (a retired promise was being
reported as OPEN), writes `generatedAt`, and the client flushes its pending
pushes before starting a job so the server reuses analyses made moments ago
instead of paying for them twice. The client-side "undo replace" that only
the local fallback path offered is now offered on the server path too, which
is the path production always takes.

### 3. Re-analysis silently dropped let-go state

`saveAdhdAnalysis` carried `doneKeys` across a re-run (contrary to the dialog
copy, which promised a reset) and dropped `letGoKeys` entirely. Both are now
carried for surviving keys, with their clocks, and the dialogs say so.

### 4. Cross-device sync only pulled once per session

`pullAndMerge` latched after the first call; with client-side navigation the
module lives for the whole PWA session, so the phone never saw the desktop's
changes until a full reload. **Decision:** a non-forced pull re-pulls when the
last pull is more than five minutes old, and the home page's return-to-tab
resync asks for one. Forced pulls are unchanged.

### 5. Days older than the newest 200 conversations looked empty

`/api/conversations` returned the newest 200 rows and the calendar treated
that as the whole archive: a day two weeks back said "No conversations on…".
**Decision:** the route accepts `?month=YYYY-MM` (a UTC window widened by a
day each side so local-day grouping is complete) and the home and rollup
pages fetch a month on demand when the day being browsed is older than what
is loaded.

### 6. Titles fell back to "Untitled" everywhere except the home list

TRACE-captured conversations carry no `structured.title`; the enrichment pass
names them, but only the home list read that name. Analyses were saved with
"Untitled", which then showed on the promises ledger, search results, the
rollup coverage list and group chips. **Decision:** one shared title resolver
(`src/lib/titles.ts`) used wherever a title is displayed or persisted.

### 7. Capture: no way to end or retry from the status page

"End conversation now" existed only on the home banner; a failed
transcription waited for the daily cron and was abandoned after three tries
with no UI path. The close route also reported "transcribing now" for work it
had already finished (it awaits transcription). **Decision:** the close route
reports per-session outcomes; a new unauthenticated `POST /api/capture/retry`
(same single-user posture as close) re-runs failed sessions on demand; the
status page gains End, Retry and the per-chunk level readout the API already
computed but nothing displayed.

### 8. Smaller defects fixed in passing

- `friendlyError` matched the substring "rate" — "generate" read as a rate
  limit. Now a word-boundary match.
- ADHD results showed raw `Deadline: Estimated: …` / `Deadline: None.` and
  could not let a promise go; the ledger's normalisation and let-go action
  are shared with it. "None" rows in People / Coming up are hidden.
- Transcript speaker names link to the person's page; unrecognised voices
  are named on the page instead of only in the People queue.
- The ADHD lens gets the same Stop button and elapsed clock the thesis lens
  had.
- Weekly rollup and group analysis regeneration get the ten-second undo the
  daily rollup already had.
- Copy: the delete-person dialog said "can't be undone" and then offered undo;
  the manual said the thesis lens has five dimensions (it has eight); README
  listed dimensions the code does not have and the wrong Next.js version.
- Route-level error boundaries printed raw `error.message` (the root one had
  already been fixed); search result dates used the UTC day.
- Usage tiles stack on narrow screens instead of overflowing.

## Not changed, and why

- **Rollup nudge timezone.** The London approximation is an approved decision
  in the 2026-08-24 nudge spec.
- **iOS app.** Out of scope for a web pass.

**Backup restore** was left out of the first draft of this pass because the
2026-08-24 export spec had scoped it out; the user then asked for it, and it
ships on the same branch under its own note,
`2026-09-06-backup-restore-design.md`.

## Verification

`npx tsc --noEmit`, `npx eslint .`, `npm test` (new tests for the store merge,
group merge, custom overlay, rate-limit matcher, deadline normalisation), a
production build, and a browser walkthrough of the changed screens under
`npm run dev:fixtures`.
