# TRACE Capture — Design

**Date:** 2026-09-05
**Status:** approved in conversation; spec for review

## Why

Omi has blocked BYOK speech-to-text, which closes the "Omi as a dumb transcript
pipe" middle path (see `2026-09-03-enrichment-junk-filter-design.md`). The only
route that keeps TRACE independent of Omi's cloud and pricing is the full
takeover: the pendant keeps capturing audio, and TRACE owns everything after the
radio. The Omi app and API are retired; the phone becomes the relay by way of a
personal iOS app.

## Goals

1. **Capture without Omi.** A personal iOS app ("TRACE Capture") keeps the Omi
   pendant connected over BLE, in the background, all day, and ships its audio
   to TRACE.
2. **TRACE becomes the source of truth for conversations.** Ingest, archive,
   voice detection, conversation segmentation, and transcription run in TRACE.
   The existing lenses (thesis, ADHD, enrichment/junk, rollups) keep working
   unchanged — they only ever consumed transcripts.
3. **Raw audio is archived** (privately) as thesis evidence and for future
   re-transcription.
4. **Cost discipline.** Deepgram is charged only for speech, never for the hours
   of silence the pendant streams; LLM spend is unchanged.

Non-goals (this phase): live captions on the phone; multi-user; Android;
offline flash sync (phase 2); speaker identification beyond diarization.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Signing | Paid Apple Developer Program (user enrolling) | Free-ID builds expire every 7 days — unlivable for an always-on relay |
| Where STT runs | Server (TRACE), not phone | Thinnest app; Deepgram key stays server-side; audio archived; one path for live and (later) offline audio |
| Phone's job | Dumb pipe: forward raw Opus packets | No decoder, no VAD, no tuning on the phone; every tunable is a server deploy, not an app rebuild |
| When to transcribe | Once per closed conversation | One Deepgram call per conversation, best diarization; latency (~3 min after a conversation ends) is acceptable |
| Repo layout | `ios/TraceCapture/` in this repo | The ingest contract and the app evolve in one history |

## Facts pinned from primary sources

From `sdks/device/PROTOCOL.md` and `sdks/device/dart/lib/uuids.dart` in
BasedHardware/omi (MIT):

- Omi service `19b10000-e8f2-537e-4f6c-d104768a1214`; audio data (notify)
  `19b10001-…`; codec (read) `19b10002-…`. Battery `180f`/`2a19`.
- Codec id is the first byte of the codec characteristic: `0x14` = Opus,
  160-sample (10 ms) frames @ 100 fps; `0x15` = Opus, 320-sample (20 ms) frames
  @ 50 fps. Both decode to 16 kHz mono PCM16.
- Each audio notify payload is `[3-byte header][Opus frame]`; strip 3 bytes.
- Storage (offline flash) service `30295780-4301-eabd-2904-2849adfeae43`,
  data `30295781-…`, read-control `30295782-…` — phase 2.
- Button service `23ba7924-0000-1000-7450-346eac492e92` — phase 3.

The official Swift SDK (`sdks/swift`) is reference material only: its
`CBCentralManager` has no restoration identifier, it decodes to WAV on the
phone, and it bundles a 75 MB Whisper model. We reuse its protocol knowledge,
not its code.

## Architecture

```
pendant ──BLE──▶ TRACE Capture (iOS) ──HTTPS──▶ POST /api/capture/chunks
                  raw Opus packets,               │
                  30 s chunk files,               ├─▶ Vercel Blob (private): raw chunk archive
                  background upload               ├─▶ Neon: capture_chunks
                                                  └─▶ decode → VAD → voiced spans → capture_sessions
                                                                                  │ (gap > 3 min closes)
                                                                                  ▼
                                                            Deepgram (speech only) → conversations row
                                                                                  │
                                              /api/conversations reads Neon (∪ Omi API while it still exists)
```

### 1. iOS app — TRACE Capture (`ios/TraceCapture/`)

Swift 6 / SwiftUI, minimum iOS 18, **no third-party dependencies** (the phone
never decodes audio, so no Opus library).

- **BLE.** `CBCentralManager` created with `CBCentralManagerOptionRestoreIdentifierKey`
  and the `bluetooth-central` background mode (`UIBackgroundModes`), plus
  `NSBluetoothAlwaysUsageDescription`. First pairing: scan for the Omi service
  UUID, user taps the device, its peripheral identifier is persisted. Thereafter:
  `retrievePeripherals(withIdentifiers:)` → `connect` (an iOS pending connect
  survives out-of-range and app suspension). On `didDisconnect`: reconnect
  immediately and call `POST /api/capture/sweep` (see §3). On connect: read the
  codec characteristic, subscribe to audio notifications, read battery.
- **Chunking.** Each notify payload has its 3-byte header stripped and the Opus
  frame appended to the current chunk file as `u16 LE length + frame`. A chunk
  starts with a fixed header (below) and rolls every **30 s** (or on disconnect).
  Chunk `startedAt` = phone clock at the first packet. Files live in the app's
  `Application Support/chunks/` directory.
- **Upload.** A background `URLSession` (identifier `capture.upload`) with one
  upload task per chunk file; iOS completes these even while the app is
  suspended. On HTTP 2xx the file is deleted; otherwise it stays queued and is
  retried on next launch/connect with exponential backoff. Idempotency is the
  chunk id (a client UUID), so a retried upload can never double-ingest.
- **UI.** One screen: connection state, pendant battery, chunks pending upload,
  last successful upload time, and a Settings sheet for TRACE base URL and the
  ingest token (Keychain). The token is typed by the user, once.
- **Timestamps.** Phone clock only (the pendant's time-sync service is not used
  in phase 1). Duration is derived server-side from packet count × frame length.

**Chunk container (v1)** — byte layout, little-endian:

```
offset  size  field
0       4     magic "TRCH"
4       1     version = 1
5       1     codec id as read from the device (0x14 or 0x15)
6       2     reserved (0)
8       8     startedAt, ms since Unix epoch (int64)
16      …     packets: repeated [u16 length][Opus frame bytes]
```

### 2. Ingest contract

`POST /api/capture/chunks`

- `Authorization: Bearer <CAPTURE_INGEST_TOKEN>` (constant-time compare; 401
  otherwise). `Content-Type: application/octet-stream`; body = chunk file.
- Headers: `X-Chunk-Id` (UUID, idempotency key), `X-Device-Id` (peripheral
  identifier), `X-App-Version`.
- Behaviour: if the chunk id already exists → `200 {duplicate: true}`. Else:
  parse + validate the container (400 on bad magic/version/codec); store the
  bytes in Vercel Blob at `capture/<YYYY-MM-DD>/<chunkId>.trch` (**private**
  access); insert `capture_chunks`; run span processing (§3) inline; respond
  `200 {chunkId, durationMs, voicedMs, sessionId}`. Session closure that this
  chunk triggers runs after the response via `waitUntil` so uploads stay fast.

`POST /api/capture/sweep` — same auth. Closes any open session whose
`last_speech_at` is older than the gap (§3). Called by the app on BLE
disconnect, by every chunk ingest as a side effect, and by a daily cron
backstop (`vercel.json`, second cron slot).

`POST /api/capture/import-omi` — same auth (or `CRON_SECRET`). One-time
backfill: pages the Omi Developer API (`limit=50`, `include_transcript=true`)
and upserts each conversation into `conversations` with `source='omi'`, ids
preserved, `structured` and `geolocation` kept. Idempotent; safe to re-run.

### 3. Server processing (`src/lib/capture/`)

Small pure modules first, side effects at the edges. Each pure module has
node:test coverage (dependency-free, like `merge.ts`/`enrich-core.ts`).

| Module | Responsibility | Pure? |
|---|---|---|
| `container.ts` | parse/validate the TRCH container; frame duration from codec id; `durationMs` | yes |
| `decode.ts` | Opus frames → PCM16 via `opusscript` (WASM, no native modules) | wraps WASM |
| `vad.ts` | energy VAD over 20 ms windows → voiced spans in ms offsets | yes |
| `sessions.ts` | grouping rules: which session a span joins; when a session closes; caps | yes |
| `assemble.ts` | voiced spans → one PCM buffer with 400 ms gaps + offset map back to absolute time | yes |
| `transcribe.ts` | Deepgram prerecorded call; map utterances through the offset map to `transcript_segments` | wraps HTTP |
| `store.ts` | Neon reads/writes for chunks, sessions, conversations; `ensureSchema` | I/O |

**VAD (v1).** RMS per 20 ms window in dBFS. Speech starts after 3 consecutive
windows ≥ `CAPTURE_VAD_DBFS` (default −45); ends after 800 ms below it. Spans
are padded 300 ms each side and spans shorter than 500 ms are dropped. The
threshold is an env var so it can be tuned with a redeploy.

**Sessions.** At most one open session per device. A new span joins the open
session if `span.start − session.last_speech_at ≤ 90 s` (shortened from Omi's 180 s on 2026-09-05); otherwise
the open session closes and a new one starts at the span. Hard caps that also
force a close: 4 h wall time, or **45 min of voiced audio** (keeps the assembled
WAV ≈ 86 MB, within one function's memory and the 300 s limit). A session that
closes with **< 2 s of voiced audio is marked `discarded`** — no Deepgram call,
no conversation row: the audio-level analogue of the junk word floor.

**Transcription (on close).** Re-fetch the session's chunks from Blob, decode,
assemble voiced spans, and POST the WAV bytes directly to Deepgram
(`model=nova-3&diarize=true&smart_format=true&punctuate=true&utterances=true`)
— bytes, not a URL, so the audio never needs a public link. Utterances map
through the offset map to absolute times, then to seconds relative to the
conversation start. Output row shape mirrors what the UI already reads:

```ts
{ id, source: 'trace', created_at, started_at, finished_at,
  transcript_segments: [{ text, speaker_id, start, end }],
  structured: null, geolocation: null,
  session_id, word_count, audio_refs: [chunk blob paths] }
```

Failures mark the session `failed` with the error; the sweep retries `failed`
sessions up to 3 times, then leaves them for manual attention (visible on the
capture status page, §4).

### 4. Data model (Neon; `ensureSchema` on first use, like `trace_store`)

- `capture_chunks(id uuid pk, device_id text, codec smallint, started_at timestamptz, duration_ms int, packets int, voiced_ms int, blob_path text, bytes int, session_id uuid null, received_at timestamptz default now())`
- `capture_sessions(id uuid pk, device_id text, started_at timestamptz, last_speech_at timestamptz, ended_at timestamptz null, status text /* open|transcribing|done|discarded|failed */, attempts int default 0, conversation_id text null, spans jsonb /* [{chunkId,startMs,endMs}] absolute epoch ms */, error text null)`
- `conversations(id text pk, source text /* omi|trace */, created_at timestamptz, started_at timestamptz null, finished_at timestamptz null, transcript_segments jsonb, structured jsonb null, geolocation jsonb null, session_id uuid null, word_count int, audio_refs jsonb null, inserted_at timestamptz default now())`

The store guard in `kv.ts` applies unchanged: outside production the capture
tables are never touched.

### 5. Read path

- `GET /api/conversations`: Neon `conversations` (newest first, limit 200) ∪ Omi
  API results (only while `OMI_API_KEY` is set), de-duplicated by id with Neon
  winning. Once history is imported and the Omi app retired, the env var is
  removed and the union collapses to Neon alone.
- `GET /api/conversations/[id]`: Neon first, Omi fallback under the same rule.
- Every consumer of these routes (home list, detail page, lenses, rollups,
  people pipeline) is unchanged.
- **Capture status page** (`/capture`, linked from the home "Contents" nav):
  last chunk received, open session state, sessions by status for the last 7
  days, failed sessions with their error, and a "Run Omi import" button. Reads
  only; no LLM.

### 6. Error handling summary

- Phone: no network → chunks queue on disk; upload retries with backoff; a
  duplicate upload is a no-op server-side. BLE drop → immediate reconnect +
  sweep call; iOS relaunches the app for BLE events via state restoration.
- Server: bad container → 400 (the app keeps the file for inspection but stops
  retrying after 3× 400s); Blob or Neon outage → 503 (the app retries later);
  Deepgram failure → session `failed`, retried by sweep.
- Silence: a session that never closes because uploads stopped is closed by the
  next ingest, the app's disconnect sweep, or the daily cron — whichever first.

### 7. Cost

- Deepgram nova-3 prerecorded on **speech only**: ~$0.0043/min → a heavy
  two-hour-speech day is under $0.60; silence costs nothing.
- Blob: raw Opus ≈ 14 MB per hour of wear (~3–4 GB/month at 8 h/day) — cents.
- Vercel: one function invocation per 30 s of wear plus one close per
  conversation; well within Hobby.
- LLM: unchanged. The enrichment/junk pass keys on conversation ids, so
  Trace-sourced conversations flow through it exactly like Omi ones.

### 8. Secrets and setup (done by the user, never pasted into chat)

- Vercel: `DEEPGRAM_API_KEY`, `CAPTURE_INGEST_TOKEN` (any long random string),
  a Vercel Blob store (private) — `BLOB_READ_WRITE_TOKEN` via the integration.
- Phone: TRACE base URL + the same ingest token, entered in the app's settings.
- Apple: Developer Program enrollment; the app is run from Xcode onto the
  user's iPhone (simulators have no Bluetooth).

### 9. Testing

- node:test for `container`, `vad`, `sessions`, `assemble` (offset mapping),
  and the Omi→row import mapping; each with boundary cases (codec ids, span
  padding, the 90 s gap, the 45-min voiced cap, the 2 s discard floor).
- A replay script (`scripts/capture-replay.mts`) that feeds a recorded `.trch`
  chunk through parse → decode → VAD locally and prints spans — the tuning tool
  for `CAPTURE_VAD_DBFS`.
- Swift: unit tests for the chunk writer (container bytes) and the upload queue;
  BLE is verified on the device with the pendant.
- End-to-end on production (dev has no store by design): wear the pendant,
  watch `/capture`, confirm a conversation appears in the list and the
  enrichment pass names it.

### 10. Phases

1. **This spec:** app + ingest + processing + read path + import + status page.
2. **Offline flash sync:** the app drains the pendant's storage service into the
   same chunk format (a second producer; the server pipeline is unchanged). Best
   done with Deepgram's cheaper batch pricing already in place from phase 1.
3. **Button boundaries (optional):** the pendant button forces a session close.

## Open risks

- **iOS background longevity.** State restoration + background URLSession is the
  documented pattern, but iOS can still terminate a backgrounded app under
  memory pressure; the pending-connect model means it is relaunched on the next
  BLE event. Battery impact of a continuous BLE stream is what the Omi app
  already imposes.
- **VAD on a pendant mic.** The energy threshold may need tuning in the field
  (wind, engines, cattle). The replay script and the env var exist for this.
- **Deepgram diarization** across concatenated spans: speaker labels reset only
  per request, and a conversation is one request, so labels are consistent
  within a conversation.
