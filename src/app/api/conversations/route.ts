import { NextRequest, NextResponse } from "next/server";
import type { Conversation } from "@/lib/conversation-types";
import { getConversations as getOmiConversations } from "@/lib/omi-api";
import { getStore } from "@/lib/kv";
import {
  ensureConversationsSchemaOnce, listConversationsLite, listConversationsLiteBetween, deleteConversations,
} from "@/lib/conversation-store";
import { friendlyError } from "@/lib/api-error";
import { fixturesEnabled, fixtureConversations } from "@/lib/dev-fixtures";

const MAX_DELETE_IDS = 500;

const iso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

function monthWindow(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const DAY = 86_400_000;
  return {
    from: new Date(Date.UTC(y, mo - 1, 1) - DAY).toISOString(),
    to: new Date(Date.UTC(y, mo, 1) + DAY).toISOString(),
  };
}

async function fetchDbRows(window: { from: string; to: string } | null): Promise<Conversation[]> {
  const sql = getStore();
  if (!sql) return [];
  await ensureConversationsSchemaOnce(sql);
  const rows = window
    ? await listConversationsLiteBetween(sql, window.from, window.to)
    : await listConversationsLite(sql, 200);
  return rows.map((r) => ({
    id: r.id,
    created_at: iso(r.created_at) ?? "",
    started_at: iso(r.started_at),
    finished_at: iso(r.finished_at),
    source: r.source,
    structured: (r.structured as Conversation["structured"]) ?? undefined,
    geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
  }));
}

async function fetchOmiRows(): Promise<Conversation[]> {
  if (!process.env.OMI_API_KEY) return [];
  try {
    return await getOmiConversations(100);
  } catch (err) {
    console.error("Omi list failed:", err);
    return [];
  }
}

export async function GET(req: NextRequest) {
  try {
    const monthParam = req.nextUrl.searchParams.get("month");
    const window = monthParam ? monthWindow(monthParam) : null;
    if (monthParam && !window) {
      return NextResponse.json({ error: "Expected month=YYYY-MM." }, { status: 400 });
    }

    const [dbRows, omiRows] = await Promise.all([
      fetchDbRows(window),
      window ? Promise.resolve([]) : fetchOmiRows(),
    ]);

    if (dbRows.length === 0 && omiRows.length === 0 && fixturesEnabled()) {
      const list = fixtureConversations();
      return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
    }

    const byId = new Map<string, Conversation>();
    for (const c of dbRows) byId.set(c.id, c);
    for (const c of omiRows) if (!byId.has(c.id)) byId.set(c.id, c);

    const list = Array.from(byId.values()).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return NextResponse.json(list, {
      headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" },
    });
  } catch (err) {
    console.error("conversations fetch failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === "string") : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "Expected a non-empty ids array." }, { status: 400 });
    }
    if (ids.length > MAX_DELETE_IDS) {
      return NextResponse.json({ error: `Expected at most ${MAX_DELETE_IDS} ids.` }, { status: 400 });
    }

    const sql = getStore();
    if (!sql) {
      return NextResponse.json({ deleted: 0 });
    }
    await ensureConversationsSchemaOnce(sql);
    const deleted = await deleteConversations(sql, ids);
    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("conversations delete failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
