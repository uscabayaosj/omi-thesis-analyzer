import { NextResponse } from "next/server";
import { getStore } from "@/lib/kv";
import { captureStatus, ensureCaptureSchemaOnce } from "@/lib/capture/store";

/** Read-only feed for the /capture page. */
export async function GET() {
  const sql = getStore();
  if (!sql) return NextResponse.json({ configured: false });
  try {
    await ensureCaptureSchemaOnce(sql);
    return NextResponse.json(
      { configured: true, ...(await captureStatus(sql)) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("capture status failed:", err);
    return NextResponse.json({ configured: true, error: "read failed" }, { status: 500 });
  }
}
