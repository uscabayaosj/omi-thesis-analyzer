import { NextResponse } from "next/server";
import { getConversations } from "@/lib/omi-api";

export async function GET() {
  try {
    const conversations = await getConversations(50);
    return NextResponse.json(conversations);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
