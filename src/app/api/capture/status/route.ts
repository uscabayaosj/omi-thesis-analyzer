import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/kv";
import { captureStatus, ensureCaptureSchemaOnce, listOpenSessions } from "@/lib/capture/store";
import { decodeFrames } from "@/lib/capture/decode";

/** Proves the WASM decoder loads in this deployment — the one dependency
 *  that can silently go missing from a function bundle. A 20 ms Opus
 *  silence packet is enough to exercise the loader. */
function decoderCheck(): string {
  try {
    const pcm = decodeFrames([new Uint8Array([0xfc, 0xff, 0xfe])], 0x15);
    return pcm.length === 320 ? "ok" : `unexpected length ${pcm.length}`;
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** Proves the native onnxruntime binding loads in this deployment — the
 *  other dependency that can silently go missing from a function bundle,
 *  and the one the speaker-identification model sits on. Its index requires
 *  the platform `.node` addon on import, so the import itself is the
 *  dlopen; nothing else about the model needs to load to answer this.
 *  A failure here would otherwise be invisible: identifySpeakers catches it
 *  per cluster and the session still completes, just with no names. */
async function onnxruntimeCheck(): Promise<string> {
  try {
    const ort = await import("onnxruntime-node");
    return ort.InferenceSession ? "ok" : "loaded without InferenceSession";
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Read-only feed for the /capture page — and, with `?scope=open`, for the
 * home page's capture banner.
 *
 * The banner polls once a minute and needs only the open sessions. Before
 * the scope existed every poll ran the full report: five queries, an Opus
 * decode, and a dynamic import of onnxruntime-node (a 34 MB native addon on
 * a cold instance) — all to answer "is anything being captured right now".
 */
export async function GET(req: NextRequest) {
  const sql = getStore();
  if (!sql) return NextResponse.json({ configured: false });
  const scope = req.nextUrl.searchParams.get("scope");
  try {
    await ensureCaptureSchemaOnce(sql);
    if (scope === "open") {
      return NextResponse.json(
        { configured: true, open: await listOpenSessions(sql) },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      {
        configured: true,
        decoder: decoderCheck(),
        onnxruntime: await onnxruntimeCheck(),
        ...(await captureStatus(sql)),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("capture status failed:", err);
    return NextResponse.json({ configured: true, error: "read failed" }, { status: 500 });
  }
}
