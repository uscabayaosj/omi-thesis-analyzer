import { NextRequest, NextResponse } from "next/server";
import { generateWeeklyRollup, type DayRollupInput } from "@/lib/weekly-rollup";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { weekStart, dailyRollups } = await req.json();

    if (typeof weekStart !== "string" || !weekStart) {
      return NextResponse.json({ error: "Missing weekStart for weekly rollup." }, { status: 400 });
    }
    if (!Array.isArray(dailyRollups) || dailyRollups.length === 0) {
      return NextResponse.json(
        { error: "No daily rollups to synthesize for this week." },
        { status: 400 }
      );
    }

    const validRollups = (dailyRollups as unknown[]).every(
      (d) => d && typeof d === "object" && typeof (d as { day?: unknown }).day === "string" && !!(d as { rollup?: unknown }).rollup
    );
    if (!validRollups) {
      return NextResponse.json({ error: "Malformed daily rollup data." }, { status: 400 });
    }

    const rollup = await generateWeeklyRollup(weekStart, dailyRollups as DayRollupInput[]);

    return NextResponse.json({ rollup });
  } catch (err) {
    console.error("weekly rollup failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
