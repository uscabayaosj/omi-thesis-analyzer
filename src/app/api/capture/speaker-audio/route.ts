import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getStore } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getSessionByConversationId, getConversationRow } from "@/lib/capture/store";
import { assembleTargetedAudio, readBlob } from "@/lib/capture/pipeline";
import { groupBySpeaker, segmentsToAbsRanges } from "@/lib/capture/identify";
import { encodeWav } from "@/lib/capture/assemble";
import { capSpeakerSegments } from "@/lib/capture/clip";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

const clipPath = (conversationId: string, speakerId: number) =>
  `speaker-clips/${conversationId}/${speakerId}.wav`;

function wav(bytes: Uint8Array): NextResponse {
  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "audio/wav",
      "Content-Length": String(bytes.byteLength),
      // The clip is derived from an archived session that never changes.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

/** Serves ~15s of one diarized speaker's audio, sliced back out of the
 *  archived session — the one signal that settles "who is this?" when the
 *  transcript context isn't enough (see the review card, and the spec at
 *  docs/superpowers/specs/2026-09-07-unrecognized-voice-review-design.md).
 *
 *  Unauthenticated on the same basis /api/capture/enroll-voice documents at
 *  length: called straight from the browser in a single-user app, reading only
 *  the user's own data. It is strictly narrower than that route — read-only,
 *  writing no namespace — but shares its one real exposure, unauthenticated
 *  *compute*: a Blob re-fetch plus an Opus decode of a whole session. Hence
 *  the same per-instance single-flight guard below, and hence the Blob cache,
 *  which makes every replay a stream rather than a second decode. */
let clipInFlight = false;

export async function GET(req: NextRequest) {
  const conversationId = req.nextUrl.searchParams.get("conversationId");
  const speakerRaw = req.nextUrl.searchParams.get("speakerId");
  const speakerId = Number(speakerRaw);
  if (!conversationId || speakerRaw === null || !Number.isInteger(speakerId)) {
    return NextResponse.json({ error: "expected conversationId and integer speakerId" }, { status: 400 });
  }

  const path = clipPath(conversationId, speakerId);

  // Cache hit skips the guard: a Blob read is not the thing being protected.
  try {
    return wav(await readBlob(path));
  } catch {
    // Miss. Fall through and build it.
  }

  if (clipInFlight) {
    return NextResponse.json({ error: "Another clip is loading — try again in a moment." }, { status: 429 });
  }
  clipInFlight = true;
  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const [session, conversation] = await Promise.all([
      getSessionByConversationId(sql, conversationId),
      getConversationRow(sql, conversationId),
    ]);
    if (!session || !conversation) {
      return NextResponse.json({ error: "No audio was kept for this conversation." }, { status: 404 });
    }

    const segments = (conversation.transcript_segments as { speaker_id: number; start: number; end: number }[]) ?? [];
    const clusters = groupBySpeaker(
      segments.filter((s) => s.speaker_id === speakerId).map((s) => ({ ...s, text: "" }))
    );
    const cluster = clusters[0];
    if (!cluster) {
      return NextResponse.json({ error: `no segments for speaker ${speakerId}` }, { status: 404 });
    }

    // Cap to CLIP_MAX_MS (~15s) BEFORE decoding anything — the segments going
    // in, not the samples coming out — then decode only the chunks that
    // capped audio actually touches. See assembleTargetedAudio's doc comment
    // (pipeline.ts) for why this is not byte-identical to slicing the old
    // full session assembly when a segment spans a chunk boundary.
    const ranges = segmentsToAbsRanges(session.startedAtMs, capSpeakerSegments(cluster.segments));
    const { pcm } = await assembleTargetedAudio(sql, session, ranges);
    const bytes = encodeWav(pcm);

    // Best-effort: the user gets their audio either way, the next play just
    // pays for the decode again.
    try {
      await put(path, Buffer.from(bytes), {
        access: "private",
        addRandomSuffix: false,
        contentType: "audio/wav",
      });
    } catch (e) {
      console.error("speaker clip cache write failed:", e);
    }

    return wav(bytes);
  } catch (err) {
    console.error("speaker-audio failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  } finally {
    clipInFlight = false;
  }
}
