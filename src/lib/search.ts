/**
 * Content search over the thesis lens's stored output — the 8
 * per-conversation dimensions and the 5 group-analysis dimensions. Not
 * transcripts (not stored durably) and not the ADHD lens (the two lenses
 * stay independent — see PRODUCT.md).
 *
 * Matching is a plain case-insensitive substring scan run in Node, not SQL
 * ILIKE: both source namespaces are mirrored to Neon as one JSONB document
 * per namespace (see kv.ts's putNamespaceData/getNamespaceData), not one
 * row per analysis, so there's nothing for ILIKE to filter without a much
 * larger storage restructure. This is the equivalent behavior at this
 * data volume.
 */

export interface SearchMatch {
  field: string;
  label: string;
  snippet: string;
}

export interface ConversationSearchResult {
  conversationId: string;
  title: string;
  date?: string;
  matches: SearchMatch[];
}

export interface GroupSearchResult {
  conversationIds: string[];
  conversationTitles: string[];
  timestamp: string;
  matches: SearchMatch[];
}

const THESIS_FIELD_LABELS: Record<string, string> = {
  rq1_documentary_record: "RQ1 — Documentary Record",
  rq2_everyday_practices: "RQ2 — Everyday Practices",
  rq3_cskt_intersection: "RQ3 — CSKT Intersection",
  rq4_wildness_imaginary: "RQ4 — Wildness Imaginary",
  conditions_check: "Orienting Conditions",
  rival_hypothesis_test: "Rival Hypothesis Test",
  refutation_signals: "Refutation Signals",
  forward_thinking: "Forward Thinking",
  "custom.result": "Custom Question",
};

const GROUP_FIELD_LABELS: Record<string, string> = {
  cross_conversation_themes: "Cross-Conversation Themes",
  contradictions_and_tensions: "Contradictions & Tensions",
  evolution_and_patterns: "Evolution & Patterns",
  synthesis: "Synthesis",
  forward_thinking: "Forward Thinking",
  "custom.result": "Custom Question",
};

/** Both omi-thesis-analyses and omi-thesis-group-analyses are pushed to Neon
 *  wrapped as { list: [...] } (see sync.ts's isArrayNamespace/schedulePush) —
 *  the bare-array branch here is a defensive fallback only, not the expected
 *  shape. */
function unwrapList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { list?: unknown }).list)) {
    return (value as { list: unknown[] }).list;
  }
  return [];
}

const SNIPPET_RADIUS = 60; // chars of context on each side of the first match

/** Returns a snippet centered on the first case-insensitive match of `query`
 *  in `text`, or null if there's no match. */
function snippetFor(text: string, query: string): string | null {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - SNIPPET_RADIUS);
  const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/** Scans `fieldLabels`' keys against `record`, returning one SearchMatch per
 *  matching field. `"custom.result"` is looked up as record.custom?.result. */
function matchFields(
  record: Record<string, unknown>,
  fieldLabels: Record<string, string>,
  query: string
): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const [field, label] of Object.entries(fieldLabels)) {
    const value =
      field === "custom.result"
        ? (record.custom as { result?: unknown } | undefined)?.result
        : record[field];
    if (typeof value !== "string" || !value) continue;
    const snippet = snippetFor(value, query);
    if (snippet !== null) matches.push({ field, label, snippet });
  }
  return matches;
}

/** `analysesData` is the raw JSONB value of the omi-thesis-analyses
 *  namespace: expected shape { list: StoredConversation[] } (see
 *  unwrapList's doc comment), where each StoredConversation is
 *  { conversationId, current: StoredAnalysis, versions } — the searchable
 *  fields live under `.current`, not at the top level. */
export function searchAnalyses(analysesData: unknown, query: string): ConversationSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: ConversationSearchResult[] = [];
  for (const raw of unwrapList(analysesData)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const conversationId = record.conversationId;
    const current = record.current;
    if (typeof conversationId !== "string" || !current || typeof current !== "object") continue;
    const currentRecord = current as Record<string, unknown>;

    const matches = matchFields(currentRecord, THESIS_FIELD_LABELS, trimmed);
    if (matches.length === 0) continue;
    results.push({
      conversationId,
      title: typeof currentRecord.title === "string" && currentRecord.title ? currentRecord.title : "Untitled",
      date: typeof currentRecord.date === "string" ? currentRecord.date : undefined,
      matches,
    });
  }

  return results.sort((a, b) => {
    if (b.matches.length !== a.matches.length) return b.matches.length - a.matches.length;
    return (b.date ?? "").localeCompare(a.date ?? "");
  });
}

/** `groupsData` is the raw JSONB value of the omi-thesis-group-analyses
 *  namespace: expected shape { list: StoredGroupAnalysis[] } (see
 *  unwrapList's doc comment). */
export function searchGroupAnalyses(groupsData: unknown, query: string): GroupSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const results: GroupSearchResult[] = [];
  for (const raw of unwrapList(groupsData)) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as Record<string, unknown>;
    const analysis = record.analysis;
    if (!analysis || typeof analysis !== "object") continue;

    // custom lives on the outer record in StoredGroupAnalysis, not inside
    // `analysis` — matchFields reads record.custom, so pass the outer
    // record's custom through onto a combined view for the lookup.
    const combined = { ...(analysis as Record<string, unknown>), custom: record.custom };
    const matches = matchFields(combined, GROUP_FIELD_LABELS, trimmed);
    if (matches.length === 0) continue;

    const conversationIds = Array.isArray(record.conversationIds)
      ? (record.conversationIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const conversations = Array.isArray(record.conversations) ? (record.conversations as unknown[]) : [];
    const conversationTitles = conversations
      .map((c) => (c && typeof c === "object" ? (c as { title?: unknown }).title : undefined))
      .filter((t): t is string => typeof t === "string" && t.length > 0);

    results.push({
      conversationIds: [...new Set(conversationIds)].sort(),
      conversationTitles,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : "",
      matches,
    });
  }

  return results.sort((a, b) => {
    if (b.matches.length !== a.matches.length) return b.matches.length - a.matches.length;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
