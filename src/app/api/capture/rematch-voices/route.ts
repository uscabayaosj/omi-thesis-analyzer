import { NextRequest, NextResponse } from "next/server";
import { getStore, getNamespaceData } from "@/lib/kv";
import { ensureCaptureSchemaOnce, getVoiceClusters } from "@/lib/capture/store";
import { bestMatch } from "@/lib/capture/identify";
import { voiceMatchThreshold } from "@/lib/capture/pipeline";
import { voiceKey } from "@/lib/capture/cluster";
import { friendlyError } from "@/lib/api-error";

export const maxDuration = 60;

interface Voice {
  conversationId: string;
  speakerId: number;
}

function isBody(v: unknown): v is { voices: Voice[] } {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.voices) &&
    r.voices.every(
      (x) =>
        !!x &&
        typeof x === "object" &&
        typeof (x as Voice).conversationId === "string" &&
        Number.isInteger((x as Voice).speakerId)
    )
  );
}

/** After a voice is named, the cards that were also that voice are no longer
 *  unrecognized. This compares their stored embeddings against the freshly
 *  updated gallery and reports the ones that now match — no audio, no model,
 *  just cosine over rows that already exist, so it is cheap enough to run on
 *  every enrollment. Voices with no stored embedding are simply absent from
 *  the result: the sweep is an optimization, not a correctness requirement. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isBody(body)) {
    return NextResponse.json({ error: "expected { voices: [{ conversationId, speakerId }] }" }, { status: 400 });
  }

  try {
    const sql = getStore();
    if (!sql) return NextResponse.json({ error: "store not configured" }, { status: 503 });
    await ensureCaptureSchemaOnce(sql);

    const raw = (await getNamespaceData(sql, "omi-people")) as Record<string, unknown> | null;
    const gallery: { personId: string; embedding: number[] }[] = [];
    for (const [id, v] of Object.entries(raw ?? {})) {
      if (id.startsWith("__") || !v || typeof v !== "object") continue;
      const r = v as Record<string, unknown>;
      if ("deleted" in r || typeof r.name !== "string") continue;
      if (Array.isArray(r.voicePrint)) gallery.push({ personId: id, embedding: r.voicePrint as number[] });
    }
    if (gallery.length === 0) return NextResponse.json({ matched: [] });

    const wanted = new Map(body.voices.map((v) => [voiceKey(v.conversationId, v.speakerId), v]));
    const rows = await getVoiceClusters(sql, [...new Set(body.voices.map((v) => v.conversationId))]);
    const threshold = voiceMatchThreshold();

    const matched: { conversationId: string; speakerId: number; personId: string }[] = [];
    for (const row of rows) {
      const key = voiceKey(row.conversationId, row.speakerId);
      if (!wanted.has(key) || !row.embedding) continue;
      const hit = bestMatch(row.embedding, gallery, threshold);
      if (hit) matched.push({ conversationId: row.conversationId, speakerId: row.speakerId, personId: hit.personId });
    }

    return NextResponse.json({ matched });
  } catch (err) {
    console.error("rematch-voices failed:", err);
    const { error, status } = friendlyError(err);
    return NextResponse.json({ error }, { status });
  }
}
