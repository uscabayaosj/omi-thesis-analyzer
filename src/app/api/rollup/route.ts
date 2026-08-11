import { NextRequest, NextResponse } from "next/server";
import { generateRollup, type DayConvoOutput } from "@/lib/rollup";
import type { Rollup } from "@/lib/adhd";
import { friendlyError } from "@/lib/api-error";

export async function POST(req: NextRequest) {
  try {
    const { day, conversations, previousRollup } = await req.json();

    if (typeof day !== "string" || !day) {
      return NextResponse.json({ error: "Missing day for rollup." }, { status: 400 });
    }
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return NextResponse.json(
        { error: "No conversation outputs to roll up for this day." },
        { status: 400 }
      );
    }

    const rollup = await generateRollup(
      day,
      conversations as DayConvoOutput[],
      (previousRollup as Rollup | undefined) ?? undefined
    );

    return NextResponse.json({ rollup });
  } catch (err) {
    console.error("rollup failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
