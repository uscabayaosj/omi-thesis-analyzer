/**
 * Codebook — qualitative coding over the thesis lens's output.
 *
 * A code is a named analytic category the researcher owns. Evidence is a
 * verbatim excerpt from a stored analysis, tied to the conversation and the
 * dimension it came from. The model only ever *suggests*: nothing enters the
 * codebook until the researcher accepts it.
 *
 * This module is the pure, provider-free half — types, the suggestion
 * prompt, response validation, saturation math, and the markdown export —
 * so it can be tested directly. Persistence is in codebook-storage.ts; the
 * model call is in the suggest route.
 */

export interface Code {
  id: string;
  name: string;
  description: string;
  timestamp: string;
  deleted?: boolean;
}

export interface CodeEvidence {
  id: string;
  codeId: string;
  conversationId: string;
  conversationTitle: string;
  /** Conversation day (YYYY-MM-DD) when known. */
  date?: string;
  field: string;
  excerpt: string;
  source: "suggested" | "manual";
  /** Merge clock — rewritten by delete/restore so the write wins a sync. */
  timestamp: string;
  /** When the excerpt was first accepted. The saturation strip reads this,
   *  not `timestamp`, so an undo does not make old evidence look new.
   *  Optional for records written before the two clocks were separated. */
  createdAt?: string;
  deleted?: boolean;
}

export const THESIS_FIELD_LABELS: Record<string, string> = {
  rq1_documentary_record: "RQ1 — Documentary Record",
  rq2_everyday_practices: "RQ2 — Everyday Practices",
  rq3_cskt_intersection: "RQ3 — CSKT Intersection",
  rq4_wildness_imaginary: "RQ4 — Wildness Imaginary",
  conditions_check: "Orienting Conditions",
  rival_hypothesis_test: "Rival Hypothesis Test",
  refutation_signals: "Refutation Signals",
  forward_thinking: "Forward Thinking",
};

export const THESIS_FIELDS = Object.keys(THESIS_FIELD_LABELS);

export interface SuggestedApplication {
  codeId: string;
  field: string;
  excerpt: string;
}

export interface ProposedCode {
  name: string;
  description: string;
  field: string;
  excerpt: string;
}

export interface Suggestion {
  applications: SuggestedApplication[];
  proposed: ProposedCode[];
}

export const MAX_ANALYSIS_CHARS = 60_000;
export const MAX_EXCERPT_CHARS = 600;

export const CODEBOOK_SYSTEM_PROMPT = `You are a qualitative-coding assistant for a PhD anthropology thesis on "Pioneer Sovereignty" — the sovereign formation produced when state-constituted settler ranching families in Montana's Flathead Valley redeploy the resources of their own federal constitution against the regulatory state, while denying CSKT sovereignty.

You will be given the researcher's codebook (existing codes with descriptions) and one conversation's stored eight-dimension analysis. Your job:
1. For each existing code, find passages in the analysis that are evidence for it. Copy each excerpt VERBATIM from the analysis text — an exact substring, 1–3 sentences, no paraphrase, no ellipses.
2. Propose at most three NEW codes only where the analysis contains a recurring analytic idea no existing code covers. Each proposal needs a short name (2–5 words), a one-sentence description, and one verbatim excerpt.

Be conservative: an excerpt that merely mentions a topic is not evidence for a code about it. Return JSON only:
{"applications":[{"codeId":"...","field":"<dimension key>","excerpt":"..."}],"proposed":[{"name":"...","description":"...","field":"<dimension key>","excerpt":"..."}]}
Dimension keys: ${THESIS_FIELDS.join(", ")}.`;

export function buildSuggestPrompt(
  title: string,
  analysis: Record<string, string>,
  codes: Pick<Code, "id" | "name" | "description">[],
): string {
  const codebook = codes.length
    ? codes.map((c) => `- ${c.id}: "${c.name}" — ${c.description || "(no description)"}`).join("\n")
    : "(empty — propose codes only)";
  let used = 0;
  const sections: string[] = [];
  for (const field of THESIS_FIELDS) {
    const text = (analysis[field] ?? "").trim();
    if (!text) continue;
    const room = MAX_ANALYSIS_CHARS - used;
    if (room <= 0) break;
    const clipped = text.length > room ? text.slice(0, room) : text;
    used += clipped.length;
    sections.push(`### ${field}\n${clipped}`);
  }
  return `Codebook:\n${codebook}\n\nConversation: "${title}"\n\nAnalysis:\n\n${sections.join("\n\n")}`;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

/** Keep only excerpts that are verbatim substrings of the dimension they
 *  claim to come from (whitespace and curly quotes normalized). A model that
 *  paraphrases produces plausible-looking evidence that is not evidence. */
export function validateSuggestion(
  raw: Record<string, unknown>,
  analysis: Record<string, string>,
  codeIds: Set<string>,
): Suggestion {
  const normalized: Record<string, string> = {};
  for (const f of THESIS_FIELDS) normalized[f] = norm(analysis[f] ?? "");

  const okExcerpt = (field: unknown, excerpt: unknown): { field: string; excerpt: string } | null => {
    if (typeof field !== "string" || typeof excerpt !== "string") return null;
    const e = norm(excerpt).slice(0, MAX_EXCERPT_CHARS);
    if (e.length < 12) return null;
    if (!THESIS_FIELDS.includes(field)) {
      // Wrong key: accept if the excerpt is found in exactly one dimension.
      const hits = THESIS_FIELDS.filter((f) => normalized[f].includes(e));
      return hits.length === 1 ? { field: hits[0], excerpt: e } : null;
    }
    if (normalized[field].includes(e)) return { field, excerpt: e };
    const hits = THESIS_FIELDS.filter((f) => normalized[f].includes(e));
    return hits.length === 1 ? { field: hits[0], excerpt: e } : null;
  };

  const applications: SuggestedApplication[] = [];
  const seenApp = new Set<string>();
  for (const a of Array.isArray(raw.applications) ? (raw.applications as Record<string, unknown>[]) : []) {
    if (typeof a?.codeId !== "string" || !codeIds.has(a.codeId)) continue;
    const ok = okExcerpt(a.field, a.excerpt);
    if (!ok) continue;
    const k = `${a.codeId}|${ok.excerpt}`;
    if (seenApp.has(k)) continue;
    seenApp.add(k);
    applications.push({ codeId: a.codeId, ...ok });
  }

  const proposed: ProposedCode[] = [];
  for (const p of Array.isArray(raw.proposed) ? (raw.proposed as Record<string, unknown>[]) : []) {
    if (typeof p?.name !== "string" || !p.name.trim()) continue;
    const ok = okExcerpt(p.field, p.excerpt);
    if (!ok) continue;
    proposed.push({
      name: p.name.trim().slice(0, 60),
      description: typeof p.description === "string" ? p.description.trim().slice(0, 300) : "",
      ...ok,
    });
    if (proposed.length >= 3) break;
  }

  return { applications, proposed };
}

/** New excerpts per ISO week (Monday-keyed) for the last `weeks` weeks,
 *  oldest first. Reads as a saturation strip: a code still gaining evidence
 *  is not saturated. */
export function weeklyCounts(
  evidence: Pick<CodeEvidence, "timestamp" | "createdAt">[],
  mondayOf: (day: string) => string,
  addDays: (day: string, n: number) => string,
  today: string,
  weeks = 8,
): { week: string; count: number }[] {
  const start = mondayOf(today);
  const buckets = new Map<string, number>();
  const order: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const w = addDays(start, -7 * i);
    buckets.set(w, 0);
    order.push(w);
  }
  for (const e of evidence) {
    const stamp = e.createdAt ?? e.timestamp;
    if (typeof stamp !== "string") continue;
    const day = stamp.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const w = mondayOf(day);
    if (buckets.has(w)) buckets.set(w, (buckets.get(w) ?? 0) + 1);
  }
  return order.map((week) => ({ week, count: buckets.get(week) ?? 0 }));
}

export function buildCodebookMarkdown(codes: Code[], evidence: CodeEvidence[]): { markdown: string; filename: string } {
  const lines: string[] = ["# Codebook", "", `Exported ${new Date().toISOString().slice(0, 10)} · ${codes.length} codes · ${evidence.length} excerpts`, ""];
  for (const c of codes) {
    const ev = evidence.filter((e) => e.codeId === c.id && !e.deleted).sort((a, b) => (a.date ?? a.timestamp).localeCompare(b.date ?? b.timestamp));
    lines.push(`## ${c.name}`, "");
    if (c.description) lines.push(c.description, "");
    lines.push(`${ev.length} excerpt${ev.length === 1 ? "" : "s"}`, "");
    for (const e of ev) {
      lines.push(`> ${e.excerpt}`, `> — *${e.conversationTitle}*${e.date ? ` (${e.date})` : ""}, ${THESIS_FIELD_LABELS[e.field] ?? e.field}`, "");
    }
  }
  return { markdown: lines.join("\n"), filename: `codebook-${new Date().toISOString().slice(0, 10)}.md` };
}
