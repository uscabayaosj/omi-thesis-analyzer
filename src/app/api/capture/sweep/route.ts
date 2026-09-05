import { NextRequest, NextResponse } from "next/server";
import { sweep } from "@/lib/capture/pipeline";
import { isBearerAuthorized } from "@/lib/capture/auth";

export const maxDuration = 300;

/**
 * Closes sessions that went quiet. POST is the app's call on BLE disconnect
 * (ingest token); GET is the daily cron backstop, authenticated exactly as
 * push/check-rollup is — Vercel sends `Bearer $CRON_SECRET`.
 */
async function run() {
  return NextResponse.json(await sweep());
}

export async function POST(req: NextRequest) {
  if (!isBearerAuthorized(req, process.env.CAPTURE_INGEST_TOKEN)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}

export async function GET(req: NextRequest) {
  if (!isBearerAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return run();
}
