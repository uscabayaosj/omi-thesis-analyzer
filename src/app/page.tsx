"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAnalyzedIds } from "@/lib/storage";

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

export default function Home() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setAnalyzedIds(getAnalyzedIds());

    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setConversations(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const analyzedCount = conversations.filter((c) => analyzedIds.has(c.id)).length;

  const filtered = conversations.filter((c) => {
    if (filter === "analyzed") return analyzedIds.has(c.id);
    if (filter === "unanalyzed") return !analyzedIds.has(c.id);
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

  const selectAll = () => {
    if (selected.size === filtered.length) {
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

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white mb-2">📚 Thesis Analyzer</h1>
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              aria-label="Enable selection mode to analyze multiple conversations as a group"
              className="text-sm min-h-[44px] bg-indigo-900/40 hover:bg-indigo-800/50 text-indigo-200 px-4 py-2 rounded-lg transition-colors border border-indigo-700/30"
            >
              ☐ Select &amp; Analyze Group
            </button>
          ) : (
            <button
              onClick={exitSelectMode}
              aria-label="Cancel selection mode"
              className="text-sm min-h-[44px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors"
            >
              ✕ Cancel
            </button>
          )}
        </div>
        <p className="text-slate-400">
          AI-powered analysis of your Omi conversations through the lens of Pioneer Sovereignty
        </p>

        {/* Onboarding: About this framework */}
        <details className="mt-4 card">
          <summary className="p-4 cursor-pointer text-sm text-slate-400 hover:text-slate-200 transition-colors min-h-[44px] flex items-center justify-between">
            <span>📖 What is Pioneer Sovereignty?</span>
            <span className="text-xs text-slate-600">For collaborators & first-time users</span>
          </summary>
          <div className="px-4 pb-4 text-sm text-slate-300 space-y-3">
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
                <li>📜 <strong className="text-slate-300">RQ1 — Documentary Record</strong>: Historical-legal acts that constituted authority (patents, water rights)</li>
                <li>🏚️ <strong className="text-slate-300">RQ2 — Everyday Practices</strong>: Kinship, inheritance, branding, boundary-maintenance, conflict</li>
                <li>🪶 <strong className="text-slate-300">RQ3 — CSKT Intersection</strong>: How ranching authority intersects with tribal sovereignty</li>
                <li>🐎 <strong className="text-slate-300">RQ4 — Wildness Imaginary</strong>: Frontier mythology as double erasure of Indigenous + federal authority</li>
                <li>🎯 <strong className="text-slate-300">Orienting Conditions</strong>: Which of 5 theoretical conditions are evidenced</li>
                <li>⚖️ <strong className="text-slate-300">Rival Hypothesis Test</strong>: Is frontier framing felt subjectivity or instrumental rhetoric?</li>
                <li>❌ <strong className="text-slate-300">Refutation Signals</strong>: What would disconfirm the concept</li>
                <li>🚀 <strong className="text-slate-300">Forward Thinking</strong>: Research directions and next questions</li>
              </ul>
            </div>
            <p className="text-xs text-slate-500 pt-2">
              This tool analyzes conversations captured by the Omi DK2 wearable device
              and runs them through an AI model grounded in the thesis&apos;s full theoretical framework.
            </p>
          </div>
        </details>

        {conversations.length > 0 && (
          <div className="flex items-center gap-4 mt-4 text-sm">
            <span className="text-slate-400">
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
                  {f === "all" ? "All" : f === "analyzed" ? "✓ Analyzed" : "○ Unanalyzed"}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selection mode toolbar */}
        {selectMode && (
          <div
            className="mt-4 card p-4 border-indigo-500/30 flex items-center justify-between"
            role="toolbar"
            aria-label="Group analysis toolbar"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={selectAll}
                aria-label={selected.size === filtered.length ? "Deselect all conversations" : "Select all conversations"}
                className="text-sm min-h-[44px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors"
              >
                {selected.size === filtered.length ? "☐ Deselect All" : "☑ Select All"}
              </button>
              <span className="text-sm text-slate-400" aria-live="polite">
                {selected.size} selected
              </span>
            </div>
            <button
              onClick={startGroupAnalysis}
              disabled={selected.size < 2}
              aria-label={`Analyze ${selected.size} selected conversations as a group`}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-white text-white font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors"
            >
              🧠 Analyze Group ({selected.size})
            </button>
          </div>
        )}
      </header>

      {loading && (
        <div className="space-y-4" aria-label="Loading conversations" role="status">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50" role="alert">
          <p className="text-red-400">⚠ {error}</p>
          <p className="text-slate-300 text-sm mt-2">Make sure OMI_API_KEY is set in your environment.</p>
        </div>
      )}

      {!loading && !error && conversations.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-4xl mb-4">🎙️</p>
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
                aria-label={`${isSelected ? "Deselect" : "Select"} "${convo.structured?.title || "Untitled"}" for group analysis`}
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
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-2xl mt-0.5" aria-hidden="true">{convo.structured?.emoji || "💬"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white truncate">
                        {convo.structured?.title || "Untitled"}
                      </h2>
                      {isAnalyzed && (
                        <span className="text-emerald-400 text-xs flex-shrink-0" aria-label="Previously analyzed">✓</span>
                      )}
                    </div>
                    {convo.structured?.overview && (
                      <p className="text-slate-400 text-sm mt-1 line-clamp-1">{convo.structured.overview}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                      <span>
                        {new Date(convo.created_at).toLocaleDateString("en-GB", {
                          day: "numeric", month: "short", year: "numeric",
                          hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
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
              aria-label={`${convo.structured?.title || "Untitled conversation"}${isAnalyzed ? " (analyzed)" : ""}`}
              className={`card p-5 block transition-colors min-h-[44px] ${
                isAnalyzed ? "hover:border-emerald-500/50" : "hover:border-indigo-500/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5" aria-hidden="true">{convo.structured?.emoji || "💬"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-white truncate">
                      {convo.structured?.title || "Untitled"}
                    </h2>
                    {isAnalyzed && (
                      <span className="text-emerald-400 text-xs flex-shrink-0" aria-label="Analyzed">✓</span>
                    )}
                  </div>
                  {convo.structured?.overview && (
                    <p className="text-slate-400 text-sm mt-1 line-clamp-2">{convo.structured.overview}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                    <span>
                      {new Date(convo.created_at).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                        hour: "2-digit", minute: "2-digit",
                      })}
                    </span>
                    {convo.structured?.category && (
                      <span className="bg-slate-800 px-2 py-0.5 rounded-full">{convo.structured.category}</span>
                    )}
                    {convo.folder_name && (
                      <span className="bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full">
                        📁 {convo.folder_name}
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
