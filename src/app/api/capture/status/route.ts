import { NextResponse } from "next/server";
import { getStore } from "@/lib/kv";
import { captureStatus, ensureCaptureSchemaOnce } from "@/lib/capture/store";
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

/** Read-only feed for the /capture page. */
export async function GET() {
  const sql = getStore();
  if (!sql) return NextResponse.json({ configured: false });
  try {
    await ensureCaptureSchemaOnce(sql);
    return NextResponse.json(
      { configured: true, decoder: decoderCheck(), ...(await captureStatus(sql)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("capture status failed:", err);
    return NextResponse.json({ configured: true, error: "read failed" }, { status: 500 });
  }
}
