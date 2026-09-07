# Unrecognized Voice Review — Design

**Date:** 2026-09-07
**Status:** approved in conversation; spec for review

## Why

`2026-09-05-speaker-identification-design.md` chose to "piggyback on the
existing pending-suggestions review": an unmatched speaker cluster becomes a
pending card, and confirming a name on it enrolls that voice. The enrollment
half of that works. The review half does not.

`VoicePendingCard` (`src/app/people/page.tsx:1190`) renders exactly two pieces
of information — the words "Unrecognized voice" and a relative age — above a
"Who is this?" picker. The card knows `conversationId` and `speakerId`
(`PendingSuggestion`, `src/lib/people.ts:44`) and displays neither, links
nowhere, and offers no way to hear the voice it is asking about. There is
nothing in it a person could reason from. In the field this produced a Review
queue of 44 identical cards, each unanswerable.

Two separate defects are tangled here:

1. **No evidence.** The card asks a question while withholding every fact that
   would answer it — what this voice said, who else was in the room, which
   conversation it was, what it sounds like.
2. **No consolidation.** `addVoicePending` keys on `(conversationId,
   speakerId)`, so one recurring unrecognized person produces one card per
   conversation. `identifySpeakers` computes an embedding for each unmatched
   cluster and then discards it (`src/lib/capture/pipeline.ts:184`), so nothing
   downstream can tell that 9 of the 44 cards are the same voice.

Fixing (1) without (2) leaves a queue that is answerable but still 44 long.
Fixing (2) without (1) leaves 9 groups that are still unanswerable. Both.

## Goals

1. **A voice card carries its own evidence.** Enough context on the card —
   without navigating away — to name the speaker or decide to ignore them.
2. **A voice can be heard.** On demand, the actual audio of that speaker,
   sliced out of the archive.
3. **One recurring voice is one decision.** The same person across many
   conversations collapses into a single card that names or ignores all of it.
4. **Nothing costs anything until asked for.** No LLM call anywhere in this
   work; no audio assembly, decode, or embedding on page load. Every expensive
   path is behind an explicit tap.
5. **Degrade, never block.** Evidence that fails to load leaves today's card
   working. Audio and grouping are unavailable — not broken — where the store
   or the archive isn't there.

**Non-goals.** Re-transcription or re-diarization of existing conversations;
any UI for correcting a *matched* speaker (that is the conversation page's
`SpeakerLegend`, unchanged); voice search across conversations; identifying a
voice from anything other than the user's own confirmation.

## Decisions taken

| Decision | Choice | Why |
|---|---|---|
| Evidence source | The conversation itself, via `GET /api/conversations/[id]` | The transcript already contains everything needed: that speaker's lines, the names of speakers who *were* matched, the title, and per-segment `start`/`end`. The route is already `private, max-age=86400, immutable` for finished conversations, so re-reads are free. No new data, no new API, no LLM. |
| Which lines to quote | The speaker's three longest segments, shown in chronological order | The first three lines of a cluster are disproportionately "yeah", "mm-hm", "right" — diarization onset noise that identifies nobody. Longest-first selects for substance; chronological display keeps it readable as speech. |
| Evidence fetch fan-out | Module-level promise cache keyed by `conversationId` | 44 cards can span far fewer conversations, and grouping will make several cards share one. One in-flight request per conversation, shared by every card that needs it. |
| Audio delivery | New `GET /api/capture/speaker-audio`, WAV bytes, result cached to a private Blob | The slice is a Blob re-fetch plus an Opus decode of a whole session — too expensive to repeat on every replay. Writing the finished clip to `speaker-clips/{conversationId}/{speakerId}.wav` makes the first play pay and every later play a stream. |
| Audio availability gate | Client renders the play control only when `conversation.source === "trace"` | Omi-imported conversations have no `audio_refs` and never will. `source` is already on the conversation the evidence fetch returned; `audio_refs` is not exposed by the API and does not need to be. A control that cannot work should not render. |
| Clip length | First ~15s of that speaker's voiced audio | Identification is near-instant for a familiar voice. 15s at 16kHz mono is ~480KB of WAV — small enough to serve inline, long enough to be sure. |
| Embedding storage | New capture-side table `voice_clusters`, **not** `PendingSuggestion` | WavLM-base-plus-sv is 512-dimensional: ~9KB of JSON floats per card, ~400KB across 44. `omi-people-pending` is localStorage, re-serializes wholesale on every write, syncs through `/api/store`, and already carries a quota-loss guard (`writeMap`, `src/lib/people.ts:88`). The pending record carries a short `voiceGroupId` string instead. |
| Backfill trigger | An explicit "Group similar voices" button, batched, with progress | Backfilling 44 cards means one audio assembly per distinct conversation plus one inference per speaker. That is real compute with a 300s function ceiling; it runs when the user asks, in batches the ceiling can hold, showing how far along it is. Never on page load. |
| Grouping threshold | `CAPTURE_VOICE_GROUP_THRESHOLD`, default 0.85 — above the 0.8 match threshold | A false *match* mislabels one conversation's segments. A false *group* merges two people into a single decision the user then answers once, wrongly, for both. Grouping should be the more conservative of the two. |
| Enrollment from a group | Enroll once, from the member with the most speech | Enrolling from all N members means N audio assemblies for one button press. The longest sample is the best single one, and `averageEmbeddings` already strengthens the print on every later conversation. |
| Embedding on empty gallery | Remove the "nobody is enrolled yet, skip the model" early return in `identifySpeakers` | That bail (`pipeline.ts:174`) is correct today — with no gallery, no inference can change the labeling. Once embeddings are *stored for grouping*, it is exactly backwards: the empty-gallery case is when every speaker is unmatched and grouping matters most. This is a deliberate reversal with a real cost (one model load plus one inference per cluster on sessions that previously skipped both) and is the price of "you never have to backfill again". |

## Architecture

Three phases. Phase 1 is self-contained and ships alone; 2 and 3 each add a
server capability behind it.

```
Phase 1  VoicePendingCard ──▶ voice-evidence.ts ──▶ GET /api/conversations/[id]
(client)                        (cache + pure selection)      (existing, cached)

Phase 2  play button ──────▶ GET /api/capture/speaker-audio
(server)                        │
                                ├─ blob hit  ──▶ stream speaker-clips/{cid}/{sid}.wav
                                └─ blob miss ──▶ assembleSessionAudio → extractSpeakerPcm
                                                 → encodeWav → put(blob) → stream

Phase 3  "Group similar voices" ──▶ POST /api/capture/cluster-voices  (batched loop)
(server)                                │
                                        ├─ per conversation: assembleSessionAudio once,
                                        │  embedAudio per unmatched speaker → voice_clusters
                                        └─ greedy cosine clustering → { groups, remaining }

         accept/ignore on a group ──▶ resolves every member
         after any enrollment     ──▶ POST /api/capture/rematch-voices clears siblings
```

### Phase 1 — the card shows its evidence

**New file `src/lib/voice-evidence.ts`.** Two responsibilities, both testable
without a browser:

- `loadConversationCached(id): Promise<Conversation>` — module-level
  `Map<string, Promise<Conversation>>`. A rejected promise is evicted so a
  retry is possible; a resolved one is kept for the page's lifetime (the HTTP
  response is `immutable` anyway).
- `buildVoiceEvidence(conversation, speakerId): VoiceEvidence` — pure, and the
  unit under test:

  ```ts
  interface VoiceEvidence {
    title: string;          // structured.title, else "Sunday, 6:40 PM"
    quotes: string[];       // ≤3, longest segments, chronological, ≤140 chars each
    othersPresent: string[];// distinct speaker_name on other speakers' segments
    lineCount: number;
    speechSeconds: number;  // Σ(end − start) over this speaker's segments
    canPlay: boolean;       // source === "trace"
  }
  ```

  Quote truncation cuts on a word boundary and appends "…". `speechSeconds` is
  0 when segments carry no `start`/`end` (Omi-imported transcripts), and the
  duration line is omitted rather than showing "~0 min".

**New file `src/components/VoicePendingCard.tsx`**, moved out of
`src/app/people/page.tsx`. The page is 1337 lines and this card is about to
grow an evidence block, an audio control, and group members; it should not
grow them in there. The move is lift-and-shift plus the new block — no
behavioural change to accept/ignore, which stay as handlers passed in from the
page.

Card layout, top to bottom:

1. **"Unrecognized voice"** and age — unchanged.
2. **Evidence block.** Conversation title as a link to `/conversation/{id}`;
   "12 lines · ~2 min of speech"; the quotes, set as quotations; "Also here:
   Ana, Marco" or "No one else was recognized in this conversation."
3. Error line — unchanged.
4. Picker, new-name input, Add, Ignore — unchanged.

While the fetch is in flight the evidence block is a skeleton of the right
height, so the picker does not jump under a thumb already reaching for it. If
the fetch fails the block is dropped entirely and the card behaves exactly as
it does today — evidence is an enhancement, never a precondition for
answering.

### Phase 2 — play this voice

**Export `readBlob`** from `src/lib/capture/pipeline.ts` (currently
module-private, line 44).

**New route `src/app/api/capture/speaker-audio/route.ts`**, `GET`, query
`conversationId` and `speakerId`, `maxDuration = 300`:

1. `getStore()`; null → 503, same as every other capture route.
2. Try `readBlob("speaker-clips/{cid}/{sid}.wav")`. Hit → stream it with
   `Cache-Control: private, max-age=31536000, immutable`. Done.
3. Miss → `getSessionByConversationId` + `getConversationRow`; either missing →
   404.
4. Filter `transcript_segments` to `speaker_id === speakerId`, `groupBySpeaker`,
   take the leading segments until ~15s of speech has accumulated. No segments
   → 404.
5. `assembleSessionAudio` → `extractSpeakerPcm` → `encodeWav`.
6. `put` to the clip path (`access: "private"`, `addRandomSuffix: false`), then
   stream the same bytes back. A failed `put` is logged and swallowed — the
   user still gets their audio, the next play just pays again.

Unauthenticated, on the same basis `enroll-voice` documents at length: called
straight from the browser, single-user app, reads only the user's own data. It
is narrower than `enroll-voice` in one way (read-only — it writes no namespace)
and identical in the way that matters (unauthenticated compute), so it carries
the same per-instance single-flight guard: one assembly at a time per function
instance, 429 otherwise. Cached clips skip the guard, since a blob read is not
the thing being protected.

**Client.** A play/pause button in the evidence block, rendered only when
`canPlay`. An `<audio>` element created on first tap with
`src="/api/capture/speaker-audio?..."`; while it loads, the button shows a
spinner. A 429 shows "Another clip is loading — try again in a moment"; any
other failure shows the friendly error inline and leaves the rest of the card
usable. Nothing is preloaded, ever — 44 cards must not mean 44 assemblies.

### Phase 3 — collapse repeats

**Schema.** One table, added to the existing DDL in
`src/lib/capture/store.ts:85`:

```sql
CREATE TABLE IF NOT EXISTS voice_clusters (
  conversation_id TEXT NOT NULL,
  speaker_id      INT  NOT NULL,
  embedding       JSONB,          -- null = unembeddable (no session or audio)
  group_id        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, speaker_id)
);
```

**Write-on-capture.** In `identifySpeakers`, every cluster that ends up
unmatched gets its embedding written here alongside the existing
`unmatchedSpeakers` return. This requires dropping the empty-gallery early
return (see Decisions) so that a first-ever session, where nothing can match,
still records embeddings. From this change forward, no conversation ever needs
backfilling.

**Backfill.** `POST /api/capture/cluster-voices`, body
`{ voices: [{conversationId, speakerId}], maxConversations?: number }`
(default 2, which comfortably fits the 300s ceiling):

1. Read `voice_clusters` for every submitted pair; partition into known and
   unknown.
2. Take up to `maxConversations` distinct conversations from the unknown set,
   oldest first so progress is deterministic across calls. For each: one
   `assembleSessionAudio`, then `extractSpeakerPcm` + `embedAudio` per
   unmatched speaker in that conversation — the assembly, which is the
   expensive part, is paid once per conversation rather than once per speaker.
   Write the rows.
3. Cluster **all** rows for the submitted set: greedy single-link over cosine
   similarity at `CAPTURE_VOICE_GROUP_THRESHOLD`, iterating in
   conversation-date order so group membership is stable between calls. A
   group's `group_id` is its earliest member's `{conversationId}:{speakerId}`.
   Persist `group_id` back to the rows.
4. Return `{ processed, remaining, groups: { "cid:sid": "groupId" } }`, where
   `processed` and `remaining` both count *distinct conversations* — the unit
   of work and the unit of progress.

A conversation whose session or audio is gone (imported from Omi, blobs
missing) is recorded as unembeddable — a `group_id` of its own key and a null
embedding — so the loop does not retry it forever. Those cards stay
individual, which is correct: without audio there is nothing to cluster on.

**Client loop.** The "Group similar voices" button, in the Review header
beside the existing "Add all N" affordance, posts repeatedly while
`remaining > 0`, updating "Grouping voices — 12 of 31 conversations…" and writing each
returned `groupId` onto its pending record via a new
`setVoiceGroup(id, groupId)` in `src/lib/people.ts`. The loop is abortable; a
failed call stops it with the friendly error and keeps whatever groups were
already assigned. The button is hidden when no voice card lacks a group, and
when the store is unavailable.

**Group rendering.** Voice cards are bucketed by `voiceGroupId` (an absent one
is its own bucket) and each bucket renders one card:

- Header: "This voice · 9 conversations", the age of the most recent.
- Evidence: from the member with the most speech, plus "Also heard in Tuesday's
  field visit, Thursday's interview, …" as links.
- Accept: enrolls once from that longest member, then removes **all** members.
  A failed enroll removes nothing.
- Ignore: removes all members, undoable through the existing `restorePending`
  path.

**Sibling sweep.** After any successful enrollment,
`POST /api/capture/rematch-voices` takes the still-pending pairs, reads their
stored embeddings, compares against the freshly updated gallery at the normal
match threshold, and returns the ones that now match a person. The client
removes them and reports "Also cleared 7 cards that were the same voice", with
undo, matching how `acceptAllConfident` already handles bulk resolution. Pairs
with no stored embedding are simply not returned — the sweep is an
optimization, not a correctness requirement.

## Data model changes

| Where | Change |
|---|---|
| `PendingSuggestion` (`src/lib/people.ts`) | `voiceGroupId?: string`. Optional; absent means ungrouped, which is every record predating phase 3. `isPendingRecord` is unchanged — a missing group is valid. |
| `src/lib/people.ts` | New `setVoiceGroup(id, groupId)`; `removePending` already tombstones, so group removal is N existing calls. |
| Capture schema | New `voice_clusters` table (above). Additive; `ensureCaptureSchemaOnce` creates it. |
| Conversation API | None. `source` is already returned; `audio_refs` deliberately stays server-side. |

## Error handling

- **Evidence fetch fails** → block omitted, card fully usable. The failure is
  not surfaced as an error; a missing enhancement is not an error state.
- **Clip 404 (no session/segments/blobs)** → "No audio was kept for this
  conversation." The play button then hides for that card.
- **Clip 429** → "Another clip is loading — try again in a moment."
- **Clip 5xx** → `friendlyError` inline; card stays usable.
- **Backfill call fails mid-loop** → loop stops, error shown, groups assigned
  so far are kept. Pressing the button again resumes where it stopped, because
  `voice_clusters` rows are the progress marker.
- **Enroll fails on a group** → nothing removed, existing per-card error path.
- **Store unavailable (local dev — `getStore()` refuses `DATABASE_URL` outside
  prod builds)** → phases 2 and 3 return 503; the play button and the grouping
  button do not render. Phase 1 works wherever conversations load, fixtures
  included.

## Testing

`node --test test/**/*.test.mts`, following the existing pure-function style.

- `test/voice-evidence.test.mts` — `buildVoiceEvidence`: longest-three
  selection, chronological output order, word-boundary truncation, others-
  present dedup and exclusion of the target speaker, `speechSeconds` when
  `start`/`end` are absent, `canPlay` by source, a speaker with one segment,
  a conversation where every other speaker is also unmatched.
- `test/voice-clip.test.mts` — the 15s segment-capping helper: exact boundary,
  a single segment longer than the cap, an empty cluster.
- `test/voice-cluster.test.mts` — the clustering function over synthetic
  embeddings: two clear groups, a below-threshold pair staying separate,
  determinism under input reordering, stable `group_id` across two runs where
  the second adds a member.
- `test/capture-identify.test.mts` — extended for embeddings recorded on an
  empty gallery.

Routes are covered by their pure helpers; no HTTP-level tests exist in this
repo and this work does not add the harness for them.

## Rollout

Phase 1 is a client-only change and lands first — it is most of the value and
carries none of the compute. Phase 2 adds the route and the play control.
Phase 3 lands the schema and write-on-capture together (so new conversations
start recording embeddings immediately), then the backfill button and group
rendering, then the sibling sweep.

## Open risks

- **Backfill cost is unmeasured.** One assembly per distinct conversation plus
  one inference per speaker, over an unknown number of conversations behind the
  44 cards. Batching at 2 conversations per call keeps any single invocation
  under the ceiling, but the total is whatever it is. It is opt-in and
  resumable, which is the mitigation; a hard cap is not specified because
  stopping halfway leaves a half-grouped queue.
- **Dropping the empty-gallery bail costs every future first session.** A model
  load plus one inference per cluster on sessions that previously skipped both.
  Accepted deliberately (see Decisions); if it proves painful the bail can come
  back at the cost of needing backfill forever.
- **0.85 is a guess.** The grouping threshold has no calibration behind it, only
  the argument that it should exceed the 0.8 match threshold. It is an env var
  for that reason. A too-low value merges two people into one card; the user
  would see it as a group whose quotes do not sound like one person, and the
  only recovery is re-running the grouping after raising it.
- **Group membership can shift between backfill runs.** Greedy single-link is
  order-dependent, and adding members can bridge two previously separate
  groups. Fixed iteration order makes a single run reproducible, not stable
  across runs on a growing set. Acceptable because a group is a review
  convenience, not stored identity — the identity is the `Person` created when
  the user names it.
- **The sibling sweep can be wrong.** It applies the same 0.8 threshold the
  original matching used, so it is exactly as trustworthy as recognition
  already is — but it removes cards without asking. Undo is the mitigation.
