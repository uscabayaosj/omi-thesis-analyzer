import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/kv";
import {
  ensureCaptureSchemaOnce,
  getSessionByConversationId,
  getConversationRow,
  getConversationCreatedAt,
  getVoiceClusters,
  upsertVoiceCluster,
  setVoiceClusterGroups,
  type VoiceClusterRow,
} from "@/lib/capture/store";
import { assembleSessionAudio, voiceGroupThreshold } from "@/lib/capture/pipeline";
import { groupBySpeaker, extractSpeakerPcm, int16ToFloat32 } from "@/lib/capture/identify";
import { embedAudio } from "@/lib/capture/embed";
import { clusterEmbeddings, voiceKey, type ClusterItem } from "@/lib/capture/cluster";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

/** Two conversations per call: one audio assembly plus one inference per
 *  speaker each, comfortably inside the 300s ceiling with headroom for a cold
 *  model load. The client loops until `remaining` is 0. */
const DEFAULT_MAX_CONVERSATIONS = 2;

/** How many times a caught embed exception may leave a pair owing before it
 *  settles as a permanent null. This buys retries across transient failures
 *  (cold-start OOM, a model hiccup) while capping a deterministic failure
 *  (malformed PCM, a segment that always throws) to a bounded number of
 *  attempts — without the cap, the same pair reoccupies the same batch slot
 *  on every call (the batch is a prefix of the oldest-owing set) and the
 *  client's loop never sees `remaining` reach 0. */
const MAX_EMBED_ATTEMPTS = 3;

interface Voice {
  conversationId: string;
  speakerId: number;
}

interface Body {
  voices: Voice[];
  maxConversations?: number;
}

function isBody(v: unknown): v is Body {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  if (!Array.isArray(r.voices)) return false;
  if (r.maxConversations !== undefined && !(Number.isInteger(r.maxConversations) && (r.maxConversations as number) > 0)) {
    return false;
  }
  return r.voices.every(
    (x) =>
      !!x &&
      typeof x === "object" &&
      typeof (x as Voice).conversationId === "string" &&
      Number.isInteger((x as Voice).speakerId)
  );
}

/** Backfills embeddings for unrecognized voices captured before anyone was
 *  enrolled (identifySpeakers bails before the model when the gallery is
 *  empty), then groups every submitted voice so one recurring person is one
 *  review card instead of N. Batched and explicitly triggered: this is the
 *  most expensive thing in the app, and it must never run on page load.
 *
 *  Unauthenticated for the same reasons as /api/capture/enroll-voice, and with
 *  the same per-instance single-flight guard over the same kind of exposure —
 *  unauthenticated compute. */
let clusterInFlight = false;

export async function POST(req: NextRequest) {
  if (clusterInFlight) {
    return NextResponse.json({ error: "Grouping is already running — try again in a moment." }, { status: 429 });
  }
  clusterInFlight = true;
  try {
    return await handle(req);
  } finally {
    clusterInFlight = false;
  }
}

async function handle(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isBody(body)) {
    return NextResponse.json(
      { error: "expected { voices: [{ conversationId, speakerId }], maxConversations?: positive integer }" },
      { status: 400 }
    );
  }

  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const wanted = new Map(body.voices.map((v) => [voiceKey(v.conversationId, v.speakerId), v]));
    const conversationIds = [...new Set(body.voices.map((v) => v.conversationId))];
    const existing = await getVoiceClusters(sql, conversationIds);
    const known = new Map(existing.map((r) => [voiceKey(r.conversationId, r.speakerId), r]));

    // A pair is owing when it has no row at all, or it has a null-embedding
    // row that hasn't yet spent its retries. A row with an embedding, or a
    // null row at the attempt cap, is settled and never revisited — that's
    // what guarantees the owing set shrinks on every call (see the route's
    // doc comment / task report for the termination argument).
    const isOwing = (v: Voice): boolean => {
      const row = known.get(voiceKey(v.conversationId, v.speakerId));
      if (!row) return true;
      return row.embedding === null && (row.attempts ?? 0) < MAX_EMBED_ATTEMPTS;
    };

    // created_at for every conversation in play — used both to order the
    // owing batch below and to keep clustering order stable further down.
    // A light accessor (id + created_at only) stands in for the full row
    // fetch here since neither use needs transcript_segments.
    const createdAtById = await getConversationCreatedAt(sql, conversationIds);

    // Conversations still owing at least one embedding, oldest first so the
    // client's loop makes deterministic progress across calls.
    const owing = [...new Set([...wanted.values()].filter(isOwing).map((v) => v.conversationId))];
    const byCreated = owing
      .slice()
      .sort((a, b) => (createdAtById.get(a) ?? "").localeCompare(createdAtById.get(b) ?? ""));

    const limit = Math.max(1, Math.min(body.maxConversations ?? DEFAULT_MAX_CONVERSATIONS, 5));
    const batch = byCreated.slice(0, limit);

    for (const conversationId of batch) {
      const speakers = [...wanted.values()]
        .filter((v) => v.conversationId === conversationId && isOwing(v))
        .map((v) => v.speakerId);

      const [session, conversation] = await Promise.all([
        getSessionByConversationId(sql, conversationId),
        getConversationRow(sql, conversationId),
      ]);

      // No session or no conversation means no audio to embed — ever. Record
      // that as a null embedding at the attempt cap so it is settled
      // immediately and the loop never retries it.
      if (!session || !conversation) {
        for (const speakerId of speakers) {
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null, attempts: MAX_EMBED_ATTEMPTS };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
        }
        continue;
      }

      // The assembly is the expensive half, so it is paid once per
      // conversation and reused for every speaker in it.
      let assembled: Awaited<ReturnType<typeof assembleSessionAudio>>["assembled"];
      try {
        ({ assembled } = await assembleSessionAudio(sql, session));
      } catch (e) {
        // readBlob (a non-200 Blob read) or parseChunk (corrupt bytes) throws
        // here — a session whose blobs are missing or damaged, the failure
        // mode this backfill is most likely to hit. Left unguarded, this used
        // to escape the loop entirely: the rest of the batch was skipped, no
        // group_id was ever written, and the same conversation (oldest-first)
        // was reselected and re-thrown on every subsequent call with no way
        // out. Settle this conversation's owing speakers exactly like the
        // per-speaker embed catch below: could be transient (a Blob hiccup)
        // or permanent (chunks genuinely gone), so attempts is bumped rather
        // than jumped to the cap — a later call retries it, and a
        // deterministic failure still settles once MAX_EMBED_ATTEMPTS is hit.
        console.error(`backfill assembly failed for ${conversationId}:`, e);
        for (const speakerId of speakers) {
          const priorAttempts = known.get(voiceKey(conversationId, speakerId))?.attempts ?? 0;
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null, attempts: priorAttempts + 1 };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
        }
        continue;
      }
      const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];

      for (const speakerId of speakers) {
        const cluster = groupBySpeaker(
          segments.filter((s) => s.speaker_id === speakerId).map((s) => ({ ...s, text: "" }))
        )[0];
        if (!cluster) {
          // No segments cluster for this speaker in this conversation — a
          // real business case (not a failure), so the null is permanent
          // (attempts at the cap: it can never succeed, so it must not be
          // retried at all).
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null, attempts: MAX_EMBED_ATTEMPTS };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
          continue;
        }

        let embedding: number[];
        try {
          embedding = await embedAudio(int16ToFloat32(extractSpeakerPcm(assembled, session.startedAtMs, cluster)));
        } catch (e) {
          // Could be transient (cold-start OOM, model hiccup) or deterministic
          // (malformed PCM, a segment that always throws) — we can't tell
          // which from here. Write a null embedding with attempts bumped from
          // whatever this pair already had (0 if no row yet): still owing
          // below the cap, so a later run retries it, but settled once the
          // cap is hit so a permanently-failing pair can't occupy the same
          // batch slot forever.
          const priorAttempts = known.get(voiceKey(conversationId, speakerId))?.attempts ?? 0;
          console.error(`backfill embed failed for ${conversationId}:${speakerId} (attempt ${priorAttempts + 1}):`, e);
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null, attempts: priorAttempts + 1 };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
          continue;
        }
        const row: VoiceClusterRow = { conversationId, speakerId, embedding, groupId: null };
        await upsertVoiceCluster(sql, row);
        known.set(voiceKey(conversationId, speakerId), row);
      }
    }

    // Cluster everything the client asked about, in conversation-date order so
    // group ids stay stable between calls. Ties (same conversation, or no
    // created_at on record) break on conversation id then speaker id so the
    // order — and therefore the resulting group ids — is deterministic
    // regardless of how the client happened to submit `voices`.
    const items: ClusterItem[] = [...wanted.entries()]
      .map(([key, v]) => ({ key, v, row: known.get(key) }))
      .filter((x) => !!x.row)
      .sort((a, b) => {
        const byDate = (createdAtById.get(a.v.conversationId) ?? "").localeCompare(createdAtById.get(b.v.conversationId) ?? "");
        if (byDate !== 0) return byDate;
        const byConversation = a.v.conversationId.localeCompare(b.v.conversationId);
        if (byConversation !== 0) return byConversation;
        return a.v.speakerId - b.v.speakerId;
      })
      .map((x) => ({ key: x.key, embedding: x.row!.embedding }));

    const groups = clusterEmbeddings(items, voiceGroupThreshold());
    await setVoiceClusterGroups(
      sql,
      Object.entries(groups).map(([key, groupId]) => {
        const v = wanted.get(key)!;
        return { conversationId: v.conversationId, speakerId: v.speakerId, groupId };
      })
    );

    // `remaining` is a post-processing count, not the pre-processing
    // `byCreated.length - batch.length` gap: that snapshot is 0 whenever the
    // whole owing set fit in one batch (always true of the last call, often
    // true of the first), which would hide a pair that just landed below the
    // attempts cap in a catch branch and is still genuinely owing. `known`
    // was kept current by every write above, so re-filtering `wanted` with
    // the same `isOwing` predicate that chose the batch reports what actually
    // still needs work, and the two can never disagree about what "owing"
    // means.
    //
    // Termination: call C the number of distinct conversations in `wanted` and
    // `limit` the clamped batch size (1-5) for this call. Every call that
    // finds anything owing processes a non-empty batch, and every owing pair
    // it touches either settles this call (an embedding is written, or a
    // structural null at the cap) or has its `attempts` strictly incremented
    // by a catch branch (assembly or per-speaker embed). Since a conversation
    // stays in the owing set until every one of its speakers has settled, and
    // batches are drawn oldest first from that set, the oldest `limit` owing
    // conversations are reselected on every subsequent call until they
    // settle — which, even in the worst case where every speaker in them fails
    // deterministically on every attempt, takes at most MAX_EMBED_ATTEMPTS
    // calls (attempts climbs 1, 2, ... to the cap, at which point isOwing goes
    // false). So the owing set is retired `limit` conversations at a time,
    // each batch taking at most MAX_EMBED_ATTEMPTS calls, for a worst-case
    // total of ceil(C / limit) * MAX_EMBED_ATTEMPTS calls before `remaining`
    // is 0 and the client's loop exits.
    const stillOwing = new Set([...wanted.values()].filter(isOwing).map((v) => v.conversationId));

    return NextResponse.json({
      processed: batch.length,
      remaining: stillOwing.size,
      groups,
    });
  } catch (err) {
    console.error("cluster-voices failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
