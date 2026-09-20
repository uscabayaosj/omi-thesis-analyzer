import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData } from "@/lib/kv";
import { chatCompletion } from "@/lib/analysis";
import { friendlyError } from "@/lib/api-error";
import {
  ASK_SYSTEM_PROMPT, MAX_QUESTION_CHARS, buildAskPrompt, buildPassages, selectPassages, toSources,
} from "@/lib/ask";

// POST /api/ask { question } → { answer, sources, passageCount }
//
// Reads the thesis and group analyses from the server mirror (the same
// source Search uses), picks the passages that share vocabulary with the
// question, and asks the model for a cited synthesis. One model call per
// request, only on an explicit Ask; the client keeps the result so repeating
// a question costs nothing.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question = typeof body?.question === "string" ? body.question.trim().slice(0, MAX_QUESTION_CHARS) : "";
    if (!question) {
      return NextResponse.json({ error: "Type a question to ask." }, { status: 400 });
    }

    const sql = getStore();
    if (!sql) {
      return NextResponse.json({ configured: false, error: "Ask needs the server-side store configured (the same one used for cross-device sync)." }, { status: 503 });
    }

    const [analysesData, groupsData] = await Promise.all([
      getNamespaceData(sql, "omi-thesis-analyses"),
      getNamespaceData(sql, "omi-thesis-group-analyses"),
    ]);

    const passages = selectPassages(buildPassages(analysesData, groupsData), question);
    if (passages.length === 0) {
      return NextResponse.json({
        answer: "Nothing in the stored analyses shares vocabulary with this question. Try different terms, or run the thesis lens on more conversations first.",
        sources: [],
        passageCount: 0,
        skipped: true,
      });
    }

    const answer = await chatCompletion(
      [
        { role: "system", content: ASK_SYSTEM_PROMPT },
        { role: "user", content: buildAskPrompt(passages, question) },
      ],
      false,
      "thesis-ask",
    );

    return NextResponse.json({ answer: answer.trim(), sources: toSources(passages), passageCount: passages.length });
  } catch (err) {
    console.error("ask failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
