import { NextRequest, NextResponse, after } from "next/server";
import { ingestChunk, closeSession } from "@/lib/capture/pipeline";
import { isBearerAuthorized } from "@/lib/capture/auth";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 300;

/**
 * The phone's upload target: one TRCH chunk per request (spec §2). Bearer
 * auth because this accepts binary from the internet; the chunk id is the
 * idempotency key so a retried upload can never double-ingest.
 */
export async function POST(req: NextRequest) {
  if (!isBearerAuthorized(req, process.env.CAPTURE_INGEST_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const chunkId = req.headers.get("x-chunk-id") ?? "";
  const deviceId = req.headers.get("x-device-id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(chunkId) || !deviceId) {
    return NextResponse.json({ error: "Missing X-Chunk-Id or X-Device-Id" }, { status: 400 });
  }
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const r = await ingestChunk({ chunkId: chunkId.toLowerCase(), deviceId, bytes });
    // Closing means a Deepgram call; the phone's upload should not wait for it.
    if (r.toClose.length) {
      after(async () => {
        for (const id of r.toClose) await closeSession(id);
      });
    }
    return NextResponse.json({
      chunkId, duplicate: r.duplicate, durationMs: r.durationMs, voicedMs: r.voicedMs, sessionId: r.sessionId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("bad chunk")) return NextResponse.json({ error: msg }, { status: 400 });
    if (msg === "store not configured") return NextResponse.json({ error: "Store not configured" }, { status: 503 });
    console.error("capture ingest failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
