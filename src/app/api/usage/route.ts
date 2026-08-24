import { NextRequest, NextResponse } from "next/server";
import { getUsageSummary, isUsageTimezoneKey, DEFAULT_USAGE_TIMEZONE } from "@/lib/usage";

// GET /api/usage → aggregated spend/call-count for the dashboard.
export async function GET(req: NextRequest) {
  const tzParam = req.nextUrl.searchParams.get("tz");
  const tz = isUsageTimezoneKey(tzParam) ? tzParam : DEFAULT_USAGE_TIMEZONE;
  try {
    const summary = await getUsageSummary(tz);
    return NextResponse.json(summary);
  } catch (err) {
    console.error("usage summary failed:", err);
    // Degrade to "not configured" rather than a 500 — same posture as
    // /api/store: a broken usage table should not read as an app-wide error.
    return NextResponse.json({
      configured: false,
      today: { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 },
      thisWeek: { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 },
      thisMonth: { costUsd: null, callCount: 0, promptTokens: 0, completionTokens: 0 },
      byLabel: [],
      byModel: [],
    });
  }
}
