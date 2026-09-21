/**
 * Ask the Corpus — question answering over every stored thesis analysis and
 * group analysis, with citations back to the conversations.
 *
 * Search (search.ts) finds a string; this synthesizes an answer. It reads the
 * same two Neon-mirrored namespaces Search reads, so it covers exactly what
 * the archive holds and nothing that only lives on one device.
 *
 * Token discipline: the corpus is cut into passages (one per conversation per
 * dimension), scored by keyword overlap with the question, and only the top
 * passages under a fixed character budget are sent. A passage that shares no
 * word with the question is never sent. The pure parts (tokenizing, scoring,
 * selecting) live here without any provider dependency so they are testable.
 */

// Unwrap the `{ list: [...] }` transport wrapper (see kv.ts) or accept a bare
// array. Local rather than imported from merge.ts so this module stays
// dependency-free and runnable under node's test runner without a loader.
function toList(v: unknown): Record<string, unknown>[] {
  if (Array.isArray(v)) return v as Record<string, unknown>[];
  if (v && typeof v === "object" && Array.isArray((v as { list?: unknown }).list)) {
    return (v as { list: Record<string, unknown>[] }).list;
  }
  return [];
}

export interface Passage {
  /** Citation tag as it appears in the prompt and the answer: C1, G2, … */
  tag: string;
  kind: "conversation" | "group";
  conversationId?: string;
  conversationIds?: string[];
  title: string;
  date?: string;
  field: string;
  label: string;
  text: string;
}

export interface AskSource {
  tag: string;
  kind: "conversation" | "group";
  conversationId?: string;
  conversationIds?: string[];
  title: string;
  date?: string;
  label: string;
}

export const ASK_PASSAGE_BUDGET_CHARS = 40_000;
export const MAX_QUESTION_CHARS = 1_000;

const THESIS_FIELDS: Record<string, string> = {
  rq1_documentary_record: "RQ1 — Documentary Record",
  rq2_everyday_practices: "RQ2 — Everyday Practices",
  rq3_cskt_intersection: "RQ3 — CSKT Intersection",
  rq4_wildness_imaginary: "RQ4 — Wildness Imaginary",
  conditions_check: "Orienting Conditions",
  rival_hypothesis_test: "Rival Hypothesis Test",
  refutation_signals: "Refutation Signals",
  forward_thinking: "Forward Thinking",
};

const GROUP_FIELDS: Record<string, string> = {
  cross_conversation_themes: "Cross-Conversation Themes",
  contradictions_and_tensions: "Contradictions & Tensions",
  evolution_and_patterns: "Evolution & Patterns",
  synthesis: "Synthesis",
  forward_thinking: "Forward Thinking",
};

const STOP = new Set(
  "a an the and or but of to in on at for with from by as is are was were be been being this that these those it its into about over under what which who whom whose how why when where do does did done have has had not no yes than then there their they them he she his her we our you your i me my can could would should will shall may might must any all some more most much many such very also just only".split(" "),
);

/** Lowercase word tokens with stop words removed and a crude stem
 *  (trailing s/es/ing/ed) so "ranchers" meets "rancher". */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const w = raw.replace(/'/g, "");
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}

/** Keyword-overlap score: each distinct question term found in the passage
 *  counts once, plus a small bonus per extra occurrence so a passage that
 *  is *about* the term outranks one that mentions it in passing. */
export function scorePassage(questionTerms: Set<string>, text: string): number {
  if (questionTerms.size === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) {
    if (questionTerms.has(t)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let score = 0;
  for (const n of counts.values()) score += 1 + Math.min(n - 1, 4) * 0.1;
  return score;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** Passages from the raw `omi-thesis-analyses` and `omi-thesis-group-analyses`
 *  namespace values (wrapped or bare). Tags are assigned after selection so
 *  the prompt numbers them 1..n in the order sent. */
export function buildPassages(analysesData: unknown, groupsData: unknown): Passage[] {
  const out: Passage[] = [];

  for (const rec of toList(analysesData)) {
    if (!rec || typeof rec !== "object") continue;
    const current = (rec.current ?? rec) as Record<string, unknown>;
    if (!current || typeof current !== "object") continue;
    const conversationId = str(rec.conversationId) || str(current.conversationId);
    if (!conversationId) continue;
    const title = str(current.title) || "Untitled";
    const date = str(current.date) || undefined;
    for (const [field, label] of Object.entries(THESIS_FIELDS)) {
      const text = str(current[field]).trim();
      if (text) out.push({ tag: "", kind: "conversation", conversationId, title, date, field, label, text });
    }
    const custom = current.custom as { prompt?: unknown; result?: unknown } | undefined;
    if (custom && typeof custom.result === "string" && custom.result.trim()) {
      out.push({
        tag: "", kind: "conversation", conversationId, title, date,
        field: "custom.result", label: `Custom: ${str(custom.prompt).slice(0, 60)}`, text: custom.result,
      });
    }
  }

  for (const rec of toList(groupsData)) {
    if (!rec || typeof rec !== "object") continue;
    const analysis = rec.analysis as Record<string, unknown> | undefined;
    if (!analysis || typeof analysis !== "object") continue;
    const ids = Array.isArray(rec.conversationIds) ? (rec.conversationIds as unknown[]).filter((x): x is string => typeof x === "string") : [];
    if (!analysis || ids.length === 0) continue;
    const convos = Array.isArray(rec.conversations) ? (rec.conversations as { title?: string }[]) : [];
    const title = convos.map((c) => str(c.title)).filter(Boolean).join(", ") || `${ids.length} conversations`;
    const date = str(rec.timestamp) || undefined;
    for (const [field, label] of Object.entries(GROUP_FIELDS)) {
      const text = str(analysis[field]).trim();
      if (text) out.push({ tag: "", kind: "group", conversationIds: ids, title, date, field, label, text });
    }
  }

  return out;
}

/** Top-scoring passages under the character budget, tagged C1…/G1… in
 *  rank order. Zero-score passages are dropped, so an unrelated question
 *  against a large archive sends little rather than everything. */
export function selectPassages(
  passages: Passage[],
  question: string,
  budgetChars = ASK_PASSAGE_BUDGET_CHARS,
): Passage[] {
  const terms = new Set(tokenize(question));
  const scored = passages
    .map((p) => ({ p, s: scorePassage(terms, p.text) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.p.date ?? "").localeCompare(a.p.date ?? ""));

  const chosen: Passage[] = [];
  let used = 0;
  let c = 0;
  let g = 0;
  for (const { p } of scored) {
    // A single oversized passage is trimmed rather than skipped, so the best
    // match is never lost to its own length.
    const text = p.text.length > 6_000 ? `${p.text.slice(0, 6_000)}…` : p.text;
    if (used + text.length > budgetChars) {
      if (chosen.length > 0) break;
    }
    const tag = p.kind === "conversation" ? `C${++c}` : `G${++g}`;
    chosen.push({ ...p, text, tag });
    used += text.length;
    if (used >= budgetChars) break;
  }
  return chosen;
}

export function toSources(passages: Passage[]): AskSource[] {
  return passages.map(({ tag, kind, conversationId, conversationIds, title, date, label }) => ({
    tag, kind, conversationId, conversationIds, title, date, label,
  }));
}

export const ASK_SYSTEM_PROMPT = `You are a research assistant for a PhD anthropology thesis on "Pioneer Sovereignty" — the sovereign formation produced when state-constituted settler ranching families in Montana's Flathead Valley redeploy the resources of their own federal constitution against the regulatory state, while denying CSKT sovereignty.

You will be given numbered passages drawn from the researcher's own stored analyses of recorded fieldwork conversations, then a question. Answer the question from the passages only. Every claim must cite its passage tag in square brackets, e.g. [C2] or [G1], immediately after the sentence it supports. If the passages do not answer the question, say what is missing rather than guessing. Write 2–5 plain paragraphs. No headings, no bullet lists, no preamble.`;

export function buildAskPrompt(passages: Passage[], question: string): string {
  const body = passages
    .map((p) => {
      const where = p.kind === "conversation" ? `Conversation "${p.title}"${p.date ? ` (${p.date.slice(0, 10)})` : ""}` : `Group analysis of ${p.title}`;
      return `[${p.tag}] ${where} — ${p.label}\n${p.text}`;
    })
    .join("\n\n");
  return `Passages:\n\n${body}\n\nQuestion: ${question}`;
}

/** Normalized form of a question, for "you asked this before" matching. */
export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
