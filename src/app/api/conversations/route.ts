import { NextRequest, NextResponse } from "next/server";
import type { Conversation } from "@/lib/conversation-types";
import { getStore } from "@/lib/kv";
import {
  ensureCaptureSchemaOnce, listConversationsLite, listConversationsLiteBetween, deleteConversations,
} from "@/lib/capture/store";
import { friendlyError } from "@/lib/api-error";
import { fixturesEnabled, fixtureConversations } from "@/lib/dev-fixtures";

// A malformed or absent-minded client could otherwise send an unbounded array
// in one request; this is a sanity clamp, not a real usage limit (a bulk clear
// from the UI is at most one day's or one search's worth of ignored rows).
const MAX_DELETE_IDS = 500;

const iso = (v: unknown): string | undefined =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : undefined;

/**
 * The UTC window for a `YYYY-MM` month, widened by a day on each side. Day
 * grouping happens on the client in local time, so a month's first and last
 * local days can start or end up to a day away in UTC; the margin makes the
 * client's month complete whatever the timezone. Null for a malformed value.
 */
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

/**
 * Conversations from TRACE's own store, without transcripts.
 *
 * Bare: the newest 200 — enough for the day-to-day list. With `?month=YYYY-MM`:
 * everything in that month. The calendar and the rollup's day picker used to
 * treat the newest 200 as the whole archive, so a day two weeks back said "No
 * conversations on…" for a day that had twenty.
 */
export async function GET(req: NextRequest) {
  try {
    const monthParam = req.nextUrl.searchParams.get("month");
    const window = monthParam ? monthWindow(monthParam) : null;
    if (monthParam && !window) {
      return NextResponse.json({ error: "Expected month=YYYY-MM." }, { status: 400 });
    }

    const sql = getStore();
    if (!sql) {
      const all = fixturesEnabled() ? fixtureConversations() : [];
      const list = window ? all.filter((c) => c.created_at >= window.from && c.created_at < window.to) : all;
      return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
    }
    await ensureCaptureSchemaOnce(sql);
    const rows = window
      ? await listConversationsLiteBetween(sql, window.from, window.to)
      : await listConversationsLite(sql, 200);
    const list: Conversation[] = rows.map((r) => ({
      id: r.id,
      created_at: iso(r.created_at) ?? "",
      started_at: iso(r.started_at),
      finished_at: iso(r.finished_at),
      source: r.source,
      structured: (r.structured as Conversation["structured"]) ?? undefined,
      geolocation: (r.geolocation as Conversation["geolocation"]) ?? null,
      unmatched_speakers: (r.unmatched_speakers as Conversation["unmatched_speakers"]) ?? undefined,
    }));
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return NextResponse.json(list, {
      headers: {
        // Per-user data: let the browser reuse a recent list and revalidate
        // in the background rather than re-invoking the function each visit.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=300",
      },
    });
  } catch (err) {
    console.error("conversations fetch failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}

/**
 * Bulk permanent delete, e.g. the home page's "Clear all ignored". No undo
 * here — the client defers this call until its own undo window has closed
 * (see page.tsx), so by the time this runs the user has already had their
 * chance to back out.
 */
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
      // Not provisioned (or dev-fixtures only, which aren't real rows) —
      // nothing durable to delete, so report success on zero rows rather
      // than erroring for a feature the user may simply not have turned on.
      return NextResponse.json({ deleted: 0 });
    }
    await ensureCaptureSchemaOnce(sql);
    const deleted = await deleteConversations(sql, ids);
    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("conversations delete failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
