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

    // created_at for every conversation in play — used both to order the
    // owing batch below and to keep clustering order stable further down.
    // A light accessor (id + created_at only) stands in for the full row
    // fetch here since neither use needs transcript_segments.
    const createdAtById = await getConversationCreatedAt(sql, conversationIds);

    // Conversations still owing at least one embedding, oldest first so the
    // client's loop makes deterministic progress across calls.
    const owing = [...new Set([...wanted.values()].filter((v) => !known.has(voiceKey(v.conversationId, v.speakerId))).map((v) => v.conversationId))];
    const byCreated = owing
      .slice()
      .sort((a, b) => (createdAtById.get(a) ?? "").localeCompare(createdAtById.get(b) ?? ""));

    const limit = Math.max(1, Math.min(body.maxConversations ?? DEFAULT_MAX_CONVERSATIONS, 5));
    const batch = byCreated.slice(0, limit);

    for (const conversationId of batch) {
      const speakers = [...wanted.values()]
        .filter((v) => v.conversationId === conversationId && !known.has(voiceKey(conversationId, v.speakerId)))
        .map((v) => v.speakerId);

      const [session, conversation] = await Promise.all([
        getSessionByConversationId(sql, conversationId),
        getConversationRow(sql, conversationId),
      ]);

      // No session or no conversation means no audio to embed — ever. Record
      // that as a null embedding so the loop stops retrying it forever.
      if (!session || !conversation) {
        for (const speakerId of speakers) {
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
        }
        continue;
      }

      // The assembly is the expensive half, so it is paid once per
      // conversation and reused for every speaker in it.
      const { assembled } = await assembleSessionAudio(sql, session);
      const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];

      for (const speakerId of speakers) {
        const cluster = groupBySpeaker(
          segments.filter((s) => s.speaker_id === speakerId).map((s) => ({ ...s, text: "" }))
        )[0];
        if (!cluster) {
          // No segments cluster for this speaker in this conversation — a
          // real business case (not a failure), so the null is permanent.
          const row: VoiceClusterRow = { conversationId, speakerId, embedding: null, groupId: null };
          await upsertVoiceCluster(sql, row);
          known.set(voiceKey(conversationId, speakerId), row);
          continue;
        }

        let embedding: number[];
        try {
          embedding = await embedAudio(int16ToFloat32(extractSpeakerPcm(assembled, session.startedAtMs, cluster)));
        } catch (e) {
          // Transient failure (cold-start OOM, model hiccup, etc.). Write
          // nothing: this pair stays owing, so a later run retries it,
          // instead of a permanent null exiling it from grouping forever.
          console.error(`backfill embed failed for ${conversationId}:${speakerId}:`, e);
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

    return NextResponse.json({
      processed: batch.length,
      remaining: Math.max(0, byCreated.length - batch.length),
      groups,
    });
  } catch (err) {
    console.error("cluster-voices failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
