import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData, putNamespaceData } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getSessionByConversationId, getConversationRow } from "@/lib/capture/store";
import { assembleTargetedAudio } from "@/lib/capture/pipeline";
import { groupBySpeaker, segmentsToAbsRanges, int16ToFloat32, averageEmbeddings } from "@/lib/capture/identify";
import { embedAudio } from "@/lib/capture/embed";
import { capSpeakerSegments, EMBED_MAX_MS } from "@/lib/capture/clip";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

interface EnrollBody {
  conversationId: string;
  speakerId: number;
  personId: string;
}

function isEnrollBody(v: unknown): v is EnrollBody {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.conversationId === "string" && typeof r.speakerId === "number" && typeof r.personId === "string";
}

/** Enrolls (or strengthens) a Person's voiceprint from one already-transcribed
 *  conversation's speaker cluster. Triggered by confirming a name on an
 *  "unrecognized voice" pending suggestion (see people-pipeline.ts).
 *
 *  Unauthenticated, like the app's other single-user actions (see
 *  /api/capture/close and the threat-model note on /api/store): it is called
 *  straight from the browser, it only writes the user's own data, and the
 *  `omi-people` namespace it touches is already fully readable and writable
 *  unauthenticated through /api/store. A bearer check here would only mean a
 *  server-only token the browser cannot send — i.e. a feature that never works.
 *
 *  One way this route's exposure is wider than those precedents: it is
 *  unauthenticated *compute*, not just a cheap write — a blob re-fetch, an
 *  Opus decode, a possible cold-start model download and an inference, under
 *  a 300 s ceiling. The single-flight guard below caps that at one enrollment
 *  per function instance at a time, which also covers a double-clicked Add.
 *  It is a per-instance limit, not a global one, and is acknowledged as such. */
let enrollInFlight = false;

export async function POST(req: NextRequest) {
  if (enrollInFlight) {
    return NextResponse.json({ error: "An enrollment is already running — try again in a moment." }, { status: 429 });
  }
  enrollInFlight = true;
  try {
    return await handleEnroll(req);
  } finally {
    enrollInFlight = false;
  }
}

async function handleEnroll(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isEnrollBody(body)) {
    return NextResponse.json({ error: "expected { conversationId, speakerId, personId }" }, { status: 400 });
  }

  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const [session, conversation] = await Promise.all([
      getSessionByConversationId(sql, body.conversationId),
      getConversationRow(sql, body.conversationId),
    ]);
    if (!session || !conversation) {
      return NextResponse.json({ error: "conversation or session not found" }, { status: 404 });
    }

    const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];
    const clusters = groupBySpeaker(
      segments.filter((s) => s.speaker_id === body.speakerId).map((s) => ({ ...s, text: "" }))
    );
    const cluster = clusters[0];
    if (!cluster) {
      return NextResponse.json({ error: `no segments for speaker ${body.speakerId}` }, { status: 404 });
    }

    // Validate the person before the expensive audio re-assembly + embed, so a
    // bad personId fails fast. The namespace is re-read after the embed below:
    // the write must still be the last thing that happens, over fresh data.
    const preRaw = (await getNamespaceData(sql, "omi-people")) as Record<string, unknown> | null;
    const pre = preRaw?.[body.personId] as Record<string, unknown> | undefined;
    if (!pre || typeof pre.name !== "string") {
      return NextResponse.json({ error: `person ${body.personId} not found` }, { status: 404 });
    }

    // Cap to the embedding budget (EMBED_MAX_MS, derived from
    // EMBED_MAX_SAMPLES) BEFORE decoding anything — the segments going in,
    // not the samples coming out — then decode only the chunks that capped
    // audio actually touches. See assembleTargetedAudio's doc comment
    // (pipeline.ts) for why this is not byte-identical to slicing the old
    // full session assembly when a segment spans a chunk boundary.
    const ranges = segmentsToAbsRanges(session.startedAtMs, capSpeakerSegments(cluster.segments, EMBED_MAX_MS));
    const { pcm } = await assembleTargetedAudio(sql, session, ranges);
    const embedding = await embedAudio(int16ToFloat32(pcm));

    const peopleRaw = (await getNamespaceData(sql, "omi-people")) as Record<string, unknown> | null;
    const people = peopleRaw ? { ...peopleRaw } : {};
    const existing = (people[body.personId] as Record<string, unknown> | undefined) ?? pre;

    const existingPrint = Array.isArray(existing.voicePrint) ? (existing.voicePrint as number[]) : undefined;
    const existingCount = typeof existing.voicePrintSamples === "number" ? existing.voicePrintSamples : 0;
    const { embedding: nextPrint, count } = averageEmbeddings(existingPrint, existingCount, embedding);

    people[body.personId] = {
      ...existing,
      voicePrint: nextPrint,
      voicePrintSamples: count,
      voicePrintUpdatedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
    };
    await putNamespaceData(sql, "omi-people", people);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("enroll-voice failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
