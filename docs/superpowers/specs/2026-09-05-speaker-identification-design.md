# Speaker Identification — Design

**Date:** 2026-09-05
**Status:** approved in conversation; spec for review

## Why

`2026-09-05-trace-capture-design.md` explicitly deferred this: "speaker
identification beyond diarization" was a non-goal of phase 1. Diarization
(now Deepgram's v2 diarizer — see `transcribe-url.ts`) already separates
"speaker 1" from "speaker 2" within one conversation, but those labels are
anonymous and reset every conversation: there's no way to know that speaker 1
in Tuesday's field recording is the same rancher as speaker 2 last Thursday,
or that either of them is the wearer. This spec is that deferred phase.

## Goals

1. **Recognize the wearer.** Segments spoken by the person wearing the pendant
   are labeled as them, not as an anonymous numbered speaker.
2. **Recognize recurring informants.** A person enrolled once (e.g. a rancher
   interviewed across several field visits) is identified by voice in later
   conversations too, not just within the session they were first named in.
3. **Reuse the People Directory**, not build a parallel identity system. A
   recognized voice IS a `Person` record (`src/lib/people.ts`) — same facts,
   aliases, and merge history informants already get from text extraction.
4. **No new third-party data sharing.** Picovoice Eagle runs on-device inside
   the existing Vercel Function; participant audio is never sent to a new
   vendor over the network to make this work.

Non-goals: real-time/streaming recognition (matching happens once, at session
close, like transcription itself); recognizing anyone not already a `Person`
the user has confirmed; a standalone enrollment UI (see Decisions).

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Engine | Picovoice Eagle (Node SDK) | The realistic field narrowed hard: Azure AI Speaker Recognition retired Sept 2025, Amazon Connect Voice ID retired May 2026. Eagle is purpose-built (enrollment + identification), runs on-device (no per-call network round-trip, no new vendor sees participant audio), has a Node.js SDK that runs inside a Vercel Function. |
| Identity storage | New optional `Person.voicePrint` field | Rides the existing client-synced `Person` record (`trace_store.omi-people` via `/api/store`) — no new table, no new sync path. A recognized voice already **is** a Person; this just gives that Person a voiceprint alongside their name and facts. |
| Where matching runs | Server, inside `transcribeSession()` (`pipeline.ts`) | Raw PCM only ever exists server-side (decoded from private Blob); the client has no path to audio today (confirmed — no route serves `audio_refs` bytes back). Matching happens right where the session's audio is already in memory, once, at close. |
| Where enrollment runs | Server, triggered by a client confirmation | Same reason: Eagle's Profiler needs raw PCM. The client only ever sends "this cluster is Person X"; the server re-fetches that cluster's audio from Blob (`transcribeSession()` already does this exact re-fetch) and computes the print there. |
| Enrollment UX | Piggyback on the existing pending-suggestions review | `people-pipeline.ts` already surfaces "is this someone you know?" cards from text extraction. An unmatched voice becomes the same kind of card — one review inbox, not two. |
| Your own voice | No special case | The first conversation's speaker(s) won't match anyone yet, so they surface as "unrecognized voice" like any informant. Confirming one as yourself (an existing or new Person) enrolls it exactly the same way. |

## Architecture

```
transcribeSession() (pipeline.ts, unchanged up to utterancesToSegments)
        │
        ▼
group segments by speaker_id ──▶ for each cluster: concatenate that
        │                        speaker's voiced PCM
        │
        ▼
getNamespaceData(sql, "omi-people")   (existing function, kv.ts)
        │
        ▼
Eagle Recognizer vs. every Person.voicePrint
        │
   ┌────┴─────┐
   │ match ≥   │  no match / no prints yet
   │ threshold │
   ▼           ▼
segment.speaker_name = Person.name     conversation row gains
segment.speaker_person_id = Person.id  unmatched_speakers: [speaker_id, ...]
   │                                        │
   ▼                                        ▼
conversation row saved as today      client's people-pipeline pass reads it,
                                      enqueues an "unrecognized voice" pending
                                      suggestion per unmatched cluster
                                             │
                                             ▼
                              user confirms a name in the review UI
                                             │
                                             ▼
                    POST /api/capture/enroll-voice { conversationId, speakerId, personId }
                                             │
                          server re-fetches that cluster's audio from Blob,
                          runs Eagle Profiler, read-merge-writes
                          trace_store.omi-people[personId].voicePrint
                          (fresh timestamp — same last-write-wins rule
                          every other Person edit already follows)
```

### 1. Recognition step (new: `src/lib/capture/identify.ts`, pure matching logic + a thin I/O wrapper in `pipeline.ts`)

- Input: the session's `TranscriptSegment[]` (already grouped by `speaker_id`
  from `utterancesToSegments`) plus the decoded PCM per span (already in hand
  in `transcribeSession()` before assembly). Concatenate each speaker's spans
  into one buffer — same 400 ms-gap technique `assemble.ts` already uses, so
  this is a small variant of existing code, not new logic.
- For each cluster, call Eagle's `Recognizer` against every enrolled
  `Person.voicePrint` fetched via `getNamespaceData`. Highest score wins if it
  clears `CAPTURE_VOICE_MATCH_THRESHOLD` (new env var, default **0.6** —
  Eagle publishes no canonical "same speaker" cutoff, so this starting point
  is chosen to favor missing a match over misattributing an informant's words
  to the wrong named person; like `CAPTURE_VAD_DBFS`, expect to retune it
  against real field recordings). Below threshold, or with an empty gallery,
  the cluster is left numeric — today's behavior, unchanged.
- Clusters under a minimum duration (new `CAPTURE_MIN_SPEAKER_MS`, default
  **3000**) are skipped entirely for both matching and the unmatched-list —
  a two-word aside shouldn't become a review card or a bad enrollment.
- Output: `speaker_name` + `speaker_person_id` set on matched segments;
  `unmatched_speakers: number[]` (cluster ids that had enough speech but no
  match) added to the `ConversationRow`.

### 2. Type changes

- `TranscriptSegment` (three copies today: `capture/types.ts`,
  `conversation-types.ts`, `conversation/[id]/page.tsx`) gains
  `speaker_person_id?: string` alongside the existing `speaker_name?: string`
  (already declared, already rendered, never populated until now).
- `ConversationRow` gains `unmatched_speakers?: number[]`.
- `Person` (`people.ts`) gains `voicePrint?: string` (base64 of Eagle's
  exported profile bytes) and `voicePrintUpdatedAt?: string`.

### 3. Enrollment review (client, extends `people-pipeline.ts`)

- A new pass, run alongside `runExtraction`: for each conversation with
  `unmatched_speakers`, enqueue one pending suggestion per cluster —
  `{ kind: "voice", conversationId, speakerId, ... }` — distinct from today's
  `{ kind: "text", extractedName, ... }` suggestions (the existing
  `PendingSuggestion` shape grows a `kind` discriminant; text suggestions are
  `kind: "text"` for backward compatibility with what's already stored).
  Reuses the existing dedup/cap/tombstone machinery in `people.ts` unchanged.
- The review UI (`/people`) shows a voice card the same way it shows a text
  card, but "confirm" means "pick or create a Person," not "confirm this
  name" — no transcript text to prefill a name from, since the whole point is
  the model didn't already know who this is by name.
- Confirming calls the new `POST /api/capture/enroll-voice` route (bearer auth
  like the rest of `/api/capture/*`), which re-fetches the cluster's chunks
  from Blob (same lookup `transcribeSession()` does via `chunkIds` /
  `getChunkBlobPaths`), decodes, runs Eagle's `Profiler`, and read-merge-writes
  the resulting print onto that Person in `trace_store.omi-people`.

### 4. Error handling

- Eagle unavailable/misconfigured (missing license key, binary mismatch for
  the Function's runtime): recognition step logs and no-ops — every cluster
  stays numeric, exactly like today. Never fails the transcription itself.
- Enroll-voice route: chunk/blob lookup failure → 404; nothing is written to
  `trace_store` (no partial print). Re-confirming later simply overwrites
  the print — single-user tool, no versioning needed.

### 5. Cost and setup

- Picovoice licensing/pricing isn't public; needs a real quote (or free-tier
  limits check) before committing — flagged here, not resolved.
- No new per-conversation network call or vendor added to the cost model in
  the original spec's §7 — Eagle runs in-process.

## Open risks

- **No canonical match threshold.** Unlike Deepgram's diarizer (which Deepgram
  tunes), "is this the same person" is a threshold *we* pick and validate
  against real field audio. Expect false accepts/rejects while tuning, same
  as the VAD threshold needed field tuning in phase 1.
- **Eagle's native binary in a Vercel Function.** The SDK ships prebuilt
  binaries per platform; needs verifying against the Function's actual Linux
  runtime before this is more than a paper design.
- **Cold-start gallery.** Every conversation is "unrecognized" until enrollment
  has happened at least once per person — expected, not a bug, but worth
  saying so it isn't mistaken for a broken match step during early testing.
