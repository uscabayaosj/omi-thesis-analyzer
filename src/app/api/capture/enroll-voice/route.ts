import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData, putNamespaceData } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getSessionByConversationId, getConversationRow } from "@/lib/capture/store";
import { assembleSessionAudio } from "@/lib/capture/pipeline";
import { isBearerAuthorized } from "@/lib/capture/auth";
import { groupBySpeaker, extractSpeakerPcm, int16ToFloat32, averageEmbeddings } from "@/lib/capture/identify";
import { embedAudio } from "@/lib/capture/embed";
import { friendlyError } from "@/lib/api-error";

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
 *  "unrecognized voice" pending suggestion (see people-pipeline.ts). */
export async function POST(req: NextRequest) {
  if (!isBearerAuthorized(req, process.env.CAPTURE_INGEST_TOKEN)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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

    const { assembled } = await assembleSessionAudio(sql, session);
    const pcm = extractSpeakerPcm(assembled, session.startedAtMs, cluster);
    const embedding = await embedAudio(int16ToFloat32(pcm));

    const peopleRaw = (await getNamespaceData(sql, "omi-people")) as Record<string, unknown> | null;
    const people = peopleRaw ? { ...peopleRaw } : {};
    const existing = people[body.personId] as Record<string, unknown> | undefined;
    if (!existing || typeof existing.name !== "string") {
      return NextResponse.json({ error: `person ${body.personId} not found` }, { status: 404 });
    }

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
