"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAnalyzedIds, getAnalysisAge } from "@/lib/storage";
import { getAdhdAnalyzedIds, saveAdhdAnalysis } from "@/lib/adhd-storage";
import type { AdhdAnalysis } from "@/lib/adhd";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format";
import { BookIcon, SquareIcon, XIcon, CheckIcon, SparklesIcon, WarningIcon, MicIcon, FolderIcon, RefreshIcon, ClipboardIcon, CalendarIcon, ChevronRightIcon } from "@/components/icons";

const CONVERSATIONS_CACHE_KEY = "conversations";

interface Conversation {
  id: string;
  created_at: string;
  structured?: {
    title?: string;
    overview?: string;
    emoji?: string;
    category?: string;
  };
  folder_name?: string;
}

function LensBadges({ thesis, adhd }: { thesis: boolean; adhd: boolean }) {
  const dot = (on: boolean, label: string) => (
    <span
      title={`${label}: ${on ? "analyzed" : "not analyzed"}`}
      className={`w-5 h-5 rounded-full border text-[10px] font-semibold flex items-center justify-center ${
        // False positive below: the scanner pairs the "off" branch's text-slate-400 with the "on"
        // branch's bg-emerald-500 since both live in one ternary string. Real pairs, both verified:
        // emerald-400/emerald-wash (5.93:1) and slate-400/slate-800 (5.71:1).
        on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" : "bg-slate-800/60 border-slate-700 text-slate-400" // impeccable-disable-line gray-on-color
      }`}
    >
      {label}
    </span>
  );
  return (
    <div className="mt-0.5 flex-shrink-0 flex flex-col gap-1" aria-hidden="true">
      {dot(thesis, "T")}
      {dot(adhd, "A")}
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Lazy initializers, not an effect: both reads are synchronous, SSR-safe
  // (guarded on `typeof window`), and side-effect-free — an effect here would
  // only add a redundant render pass. analyzedIds never changes after mount
  // (thesis analysis happens on a different page), so no setter is needed;
  // adhdIds does change, after a batch ADHD run below.
  const [analyzedIds] = useState<Set<string>>(() => getAnalyzedIds());
  const [adhdIds, setAdhdIds] = useState<Set<string>>(() => getAdhdAnalyzedIds());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, failed: 0 });

  // Revalidate the list over the network and refresh the cache. A refresh
  // forces a fresh pull from Omi; the initial load can reuse the HTTP cache.
  // Cached data stays on screen if an initial load fails, so a network hiccup
  // never blanks the UI.
  const loadConversations = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      const data = await fetchJson<Conversation[]>(
        "/api/conversations",
        mode === "refresh" ? { cache: "no-store" } : undefined
      );
      const list = Array.isArray(data) ? data : [];
      setConversations(list);
      setError(null);
      setLastSynced(new Date().toISOString());
      cacheSet(CONVERSATIONS_CACHE_KEY, list);
    } catch (e) {
      // On an explicit refresh, always report. On the initial load, only surface
      // an error if there was no cached list to fall back on.
      if (mode === "refresh" || !cacheGet(CONVERSATIONS_CACHE_KEY)) {
        setError(e instanceof Error ? e.message : "Failed to reach Omi");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Instant paint from cache (stale-while-revalidate), then revalidate.
    // This can't become a lazy useState initializer like analyzedIds/adhdIds
    // above: the server-rendered HTML always shows an empty list (no
    // localStorage there), so reading the cache during the client's first
    // render would diverge from that SSR output and trigger a hydration
    // mismatch. Reading it here, post-mount, costs one extra render but
    // keeps the first paint hydration-safe.
    const cached = cacheGet<Conversation[]>(CONVERSATIONS_CACHE_KEY);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above; must run post-mount, not as a lazy initializer
      setConversations(cached.data);
      setLoading(false);
    }
    loadConversations("initial");
  }, [loadConversations]);

  const isAnalyzedEither = useCallback(
    (cid: string) => analyzedIds.has(cid) || adhdIds.has(cid),
    [analyzedIds, adhdIds]
  );

  const analyzedCount = conversations.filter((c) => isAnalyzedEither(c.id)).length;

  const filtered = conversations.filter((c) => {
    if (filter === "analyzed") return isAnalyzedEither(c.id);
    if (filter === "unanalyzed") return !isAnalyzedEither(c.id);
    return true;
  });

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // "All selected" must check membership, not just counts — the selection can
  // contain conversations hidden by the current filter.
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  const selectAll = () => {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((c) => c.id)));
    }
  };

  const startGroupAnalysis = useCallback(() => {
    if (selected.size < 2) return;
    const ids = Array.from(selected).join(",");
    router.push(`/analyze-group?ids=${ids}`);
  }, [selected, router]);

  const runBatchAdhd = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: { structured?: { title?: string }; created_at?: string } }>(
          "/api/analyze-adhd",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: ids[i] }),
          }
        );
        // Persist via the storage lib (same shape the conversation page uses).
        saveAdhdAnalysis({
          conversationId: ids[i],
          title: data.conversation?.structured?.title || "Untitled",
          date: data.conversation?.created_at,
          analysis: data.analysis,
        });
      } catch {
        failed++;
      }
      setBatchProgress({ done: i + 1, total: ids.length, failed });
    }
    setAdhdIds(getAdhdAnalyzedIds());
    setBatchRunning(false);
  }, [selected]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-2">
          <BookIcon className="w-7 h-7 text-indigo-400 flex-shrink-0" />
          Thesis Analyzer
        </h1>
        <p className="text-slate-400">
          AI-powered analysis of your Omi conversations through the lens of Pioneer Sovereignty
        </p>

        {/* Sync status + refresh — quiet meta row, read once per visit */}
        <div className="flex items-center justify-between gap-3 mt-4 pb-4 border-b border-slate-800">
          <span className="text-sm text-slate-400" aria-live="polite">
            {refreshing
              ? "Refreshing from Omi…"
              : loading
              ? "Loading…"
              : lastSynced
              ? `Synced ${getAnalysisAge(lastSynced).label}`
              : ""}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/rollup"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
            >
              <CalendarIcon className="w-4 h-4 flex-shrink-0" />
              Daily Rollup
            </Link>
            <button
              onClick={() => loadConversations("refresh")}
              disabled={loading || refreshing}
              aria-label="Refresh conversations from Omi"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <RefreshIcon className={`w-4 h-4 flex-shrink-0 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Onboarding: About this framework — a quiet footnote, not a section */}
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-sm text-slate-500 hover:text-slate-300 transition-colors min-h-[44px] flex items-center gap-1.5">
            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 transition-transform group-open:rotate-90" />
            What is Pioneer Sovereignty?
          </summary>
          <div className="pl-5 pt-1 pb-2 text-sm text-slate-300 space-y-3">
            <p>
              <strong className="text-white">Pioneer Sovereignty</strong> is a concept from a PhD anthropology thesis
              by Ulysses S. Cabayao, SJ (UCL). It examines how ranching families in Montana&apos;s Flathead Valley
              produce, assert, and contest authority over land and herd through everyday social practices.
            </p>
            <p>
              The thesis argues that these families received their land, water, and grazing rights through
              federal instruments (homestead patents, water adjudications) — yet experience that authority
              as self-made and prior to the state that granted it. At the same time, they deny the prior
              and ongoing sovereignty of the Confederated Salish and Kootenai Tribes whose territory they occupy.
            </p>
            <div className="pt-2">
              <p className="font-medium text-slate-200 mb-2">The 8 analysis dimensions:</p>
              <ul className="space-y-1.5 text-slate-400">
                {[
                  { label: "RQ1 — Documentary Record", desc: "Historical-legal acts that constituted authority (patents, water rights)" },
                  { label: "RQ2 — Everyday Practices", desc: "Kinship, inheritance, branding, boundary-maintenance, conflict" },
                  { label: "RQ3 — CSKT Intersection", desc: "How ranching authority intersects with tribal sovereignty" },
                  { label: "RQ4 — Wildness Imaginary", desc: "Frontier mythology as double erasure of Indigenous + federal authority" },
                  { label: "Orienting Conditions", desc: "Which of 5 theoretical conditions are evidenced" },
                  { label: "Rival Hypothesis Test", desc: "Is frontier framing felt subjectivity or instrumental rhetoric?" },
                  { label: "Refutation Signals", desc: "What would disconfirm the concept" },
                  { label: "Forward Thinking", desc: "Research directions and next questions" },
                ].map((dim, i) => (
                  <li key={dim.label} className="flex gap-2">
                    <span
                      className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-semibold flex items-center justify-center"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span>
                      <strong className="text-slate-300">{dim.label}</strong>: {dim.desc}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-slate-500 pt-2">
              This tool analyzes conversations captured by the Omi DK2 wearable device
              and runs them through an AI model grounded in the thesis&apos;s full theoretical framework.
            </p>
          </div>
        </details>

        {/* Scan row: count + filter + group-select entry — tight to the list it governs */}
        {conversations.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-400 whitespace-nowrap">
                {analyzedCount}/{conversations.length} analyzed
              </span>
              <div className="flex gap-1" role="radiogroup" aria-label="Filter conversations by analysis status">
                {(["all", "analyzed", "unanalyzed"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    role="radio"
                    aria-checked={filter === f}
                    aria-label={`Show ${f} conversations`}
                    className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                      filter === f
                        ? "bg-indigo-600 text-white"
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    {f === "all" ? "All" : f === "analyzed" ? "Analyzed" : "Unanalyzed"}
                  </button>
                ))}
              </div>
            </div>
            {!selectMode ? (
              <button
                onClick={() => setSelectMode(true)}
                aria-label="Enable selection mode to analyze multiple conversations as a group"
                className="text-sm min-h-[44px] flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                <SquareIcon className="w-3.5 h-3.5" />
                Select &amp; Analyze Group
              </button>
            ) : (
              <button
                onClick={exitSelectMode}
                aria-label="Cancel selection mode"
                className="text-sm min-h-[44px] flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                <XIcon className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Selection mode toolbar */}
        {selectMode && (
          <div className="mt-3">
            <div
              className="card p-4 border-indigo-500/30 flex flex-wrap items-center justify-between gap-3"
              role="toolbar"
              aria-label="Group analysis toolbar"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={selectAll}
                  disabled={filtered.length === 0}
                  aria-label={allFilteredSelected ? "Deselect all conversations" : "Select all conversations"}
                  className="text-sm min-h-[44px] bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  {allFilteredSelected ? "Deselect All" : "Select All"}
                </button>
                <span className="text-sm text-slate-400 whitespace-nowrap" aria-live="polite">
                  {selected.size} selected
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={startGroupAnalysis}
                  disabled={selected.size < 2 || batchRunning}
                  aria-label={`Group thesis analysis on ${selected.size} conversations`}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium py-2 px-4 min-h-[44px] rounded-lg text-sm transition-colors whitespace-nowrap"
                >
                  <SparklesIcon className="w-4 h-4" />
                  Group Thesis ({selected.size})
                </button>
                <button
                  onClick={runBatchAdhd}
                  disabled={selected.size < 1 || batchRunning}
                  aria-label={`Run ADHD Aid on ${selected.size} conversations`}
                  className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-100 font-medium py-2 px-4 min-h-[44px] rounded-lg text-sm transition-colors whitespace-nowrap"
                >
                  <ClipboardIcon className="w-4 h-4" />
                  {batchRunning ? `Running ${batchProgress.done}/${batchProgress.total}…` : `Run ADHD (${selected.size})`}
                </button>
              </div>
            </div>
            {!batchRunning && batchProgress.total > 0 && batchProgress.failed > 0 && (
              <p className="text-amber-300/90 text-sm mt-2" role="status">
                {batchProgress.failed} of {batchProgress.total} could not be analyzed and {batchProgress.failed === 1 ? "was" : "were"} skipped.
              </p>
            )}
          </div>
        )}
      </header>

      {loading && (
        <div className="space-y-4" aria-label="Loading conversations" role="status">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          {conversations.length > 0 && (
            <p className="text-slate-400 text-sm mt-2">Showing the last loaded conversations below.</p>
          )}
          <button
            onClick={() => loadConversations(conversations.length > 0 ? "refresh" : "initial")}
            disabled={loading || refreshing}
            className="mt-3 text-sm bg-slate-900 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-slate-200 px-4 py-2 min-h-[44px] rounded-lg transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && conversations.length === 0 && (
        <div className="card p-8 text-center">
          <MicIcon className="w-10 h-10 mx-auto mb-4 text-slate-600" />
          <p className="text-slate-300">No conversations found.</p>
          <p className="text-slate-400 text-sm mt-2">Record a conversation with your Omi device, then come back.</p>
        </div>
      )}

      {!loading && filtered.length === 0 && conversations.length > 0 && (
        <div className="card p-8 text-center">
          <p className="text-slate-400">
            {filter === "analyzed" ? "No analyzed conversations yet." : "All conversations have been analyzed!"}
          </p>
          <button onClick={() => setFilter("all")} className="text-indigo-400 text-sm mt-2 hover:underline min-h-[44px] px-2">
            Show all
          </button>
        </div>
      )}

      <div className="space-y-3 conversation-list" role={selectMode ? "listbox" : "list"} aria-label="Conversations" aria-multiselectable={selectMode || undefined}>
        {filtered.map((convo) => {
          const isAnalyzed = analyzedIds.has(convo.id);
          const isSelected = selected.has(convo.id);

          if (selectMode) {
            return (
              <button
                key={convo.id}
                onClick={() => toggleSelect(convo.id)}
                role="option"
                aria-selected={isSelected}
                aria-label={`${isSelected ? "Deselect" : "Select"} "${convo.structured?.title || "Untitled"}" for group analysis${isAnalyzedEither(convo.id) ? " (analyzed)" : ""}`}
                className={`w-full text-left card p-5 transition-colors min-h-[44px] ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-950/30"
                    : "hover:border-slate-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`w-5 h-5 mt-1 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                      isSelected
                        ? "bg-indigo-600 border-indigo-600"
                        : "border-slate-600"
                    }`}
                    aria-hidden="true"
                  >
                    {isSelected && (
                      <CheckIcon className="w-3 h-3 text-white" />
                    )}
                  </div>
                  <LensBadges thesis={isAnalyzed} adhd={adhdIds.has(convo.id)} />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-white truncate">
                      {convo.structured?.title || "Untitled"}
                    </h2>
                    {convo.structured?.overview && (
                      <p className="text-slate-400 text-sm mt-1 line-clamp-1">{convo.structured.overview}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span>{formatDateTime(convo.created_at)}</span>
                      {convo.structured?.category && (
                        <span className="bg-slate-800 px-2 py-0.5 rounded-full">{convo.structured.category}</span>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          }

          return (
            <Link
              key={convo.id}
              href={`/conversation/${convo.id}`}
              aria-label={`${convo.structured?.title || "Untitled conversation"}${isAnalyzedEither(convo.id) ? " (analyzed)" : ""}`}
              className={`card p-5 block transition-colors min-h-[44px] ${
                isAnalyzedEither(convo.id) ? "hover:border-emerald-500/50" : "hover:border-indigo-500/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <LensBadges thesis={isAnalyzed} adhd={adhdIds.has(convo.id)} />
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-white truncate">
                    {convo.structured?.title || "Untitled"}
                  </h2>
                  {convo.structured?.overview && (
                    <p className="text-slate-400 text-sm mt-1 line-clamp-2">{convo.structured.overview}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span>{formatDateTime(convo.created_at)}</span>
                    {convo.structured?.category && (
                      <span className="bg-slate-800 px-2 py-0.5 rounded-full">{convo.structured.category}</span>
                    )}
                    {convo.folder_name && (
                      <span className="flex items-center gap-1 bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full">
                        <FolderIcon className="w-3 h-3" />
                        {convo.folder_name}
                      </span>
                    )}
                  </div>
                </div>
                <svg className="w-5 h-5 text-slate-600 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
