import { NextRequest, NextResponse } from "next/server";
import { chatCompletion, extractJsonObject } from "@/lib/analysis";
import { friendlyError } from "@/lib/api-error";
import { CODEBOOK_SYSTEM_PROMPT, THESIS_FIELDS, buildSuggestPrompt, validateSuggestion } from "@/lib/codebook";

// POST /api/codebook/suggest { title, analysis, codes } → { applications, proposed }
//
// The client sends the analysis text from its own localStorage — the working
// copy — so this route has no store dependency. One model call, JSON mode,
// and every excerpt is checked to be a verbatim substring before it is
// returned; the researcher accepts or discards each one on the page.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const title = typeof body?.title === "string" ? body.title : "Untitled";
    const rawAnalysis = body?.analysis && typeof body.analysis === "object" ? (body.analysis as Record<string, unknown>) : null;
    if (!rawAnalysis) {
      return NextResponse.json({ error: "Select an analyzed conversation to code." }, { status: 400 });
    }
    const analysis: Record<string, string> = {};
    for (const f of THESIS_FIELDS) analysis[f] = typeof rawAnalysis[f] === "string" ? (rawAnalysis[f] as string) : "";
    if (!Object.values(analysis).some((t) => t.trim())) {
      return NextResponse.json({ error: "This conversation has no thesis analysis to code." }, { status: 400 });
    }

    const codes = (Array.isArray(body?.codes) ? (body.codes as Record<string, unknown>[]) : [])
      .filter((c) => typeof c?.id === "string" && typeof c?.name === "string")
      .map((c) => ({ id: c.id as string, name: c.name as string, description: typeof c.description === "string" ? c.description : "" }))
      .slice(0, 60);

    const content = await chatCompletion(
      [
        { role: "system", content: CODEBOOK_SYSTEM_PROMPT },
        { role: "user", content: buildSuggestPrompt(title, analysis, codes) },
      ],
      true,
      "thesis-codebook",
    );

    const suggestion = validateSuggestion(extractJsonObject(content), analysis, new Set(codes.map((c) => c.id)));
    return NextResponse.json(suggestion);
  } catch (err) {
    console.error("codebook suggest failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
