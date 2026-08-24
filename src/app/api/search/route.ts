import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData } from "@/lib/kv";
import { searchAnalyses, searchGroupAnalyses } from "@/lib/search";

// GET /api/search?q=<term> → substring search across stored thesis and
// group analyses. See src/lib/search.ts for why this isn't SQL ILIKE.
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ configured: true, conversationResults: [], groupResults: [] });
  }

  const sql = getStore();
  if (!sql) {
    return NextResponse.json({ configured: false, conversationResults: [], groupResults: [] });
  }

  try {
    const [analysesData, groupsData] = await Promise.all([
      getNamespaceData(sql, "omi-thesis-analyses"),
      getNamespaceData(sql, "omi-thesis-group-analyses"),
    ]);

    return NextResponse.json({
      configured: true,
      conversationResults: searchAnalyses(analysesData, query),
      groupResults: searchGroupAnalyses(groupsData, query),
    });
  } catch (err) {
    console.error("search failed:", err);
    // Degrade rather than error — a broken store should cost search
    // results, not surface a 500 for what's ultimately an optional feature.
    return NextResponse.json({ configured: false, conversationResults: [], groupResults: [] });
  }
}
