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
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white mb-2">📚 Thesis Analyzer</h1>
          {!selectMode ? (
            <button
              onClick={() => setSelectMode(true)}
              className="text-xs bg-indigo-900/40 hover:bg-indigo-800/50 text-indigo-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              ☐ Select & Analyze Group
            </button>
          ) : (
            <button
              onClick={exitSelectMode}
              className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              ✕ Cancel
            </button>
          )}
        </div>
        <p className="text-slate-400">
          AI-powered analysis of your Omi conversations through the lens of Pioneer Sovereignty
        </p>

        {conversations.length > 0 && (
          <div className="flex items-center gap-4 mt-4 text-sm">
            <span className="text-slate-500">
              {analyzedCount}/{conversations.length} analyzed
            </span>
            <div className="flex gap-1">
              {(["all", "analyzed", "unanalyzed"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    filter === f
                      ? "bg-indigo-600 text-white"
                      : "bg-slate-800 text-slate-400 hover:text-slate-200"
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
          <div className="mt-4 card p-4 border-indigo-500/30 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={selectAll}
                className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 px-3 py-1.5 rounded-lg transition-colors"
              >
                {selected.size === filtered.length ? "☐ Deselect All" : "☑ Select All"}
              </button>
              <span className="text-sm text-slate-400">
                {selected.size} selected
              </span>
            </div>
            <button
              onClick={startGroupAnalysis}
              disabled={selected.size < 2}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
            >
              🧠 Analyze Group ({selected.size})
            </button>
          </div>
        )}
      </header>

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50">
          <p className="text-red-400">⚠ {error}</p>
          <p className="text-slate-500 text-sm mt-2">Make sure OMI_API_KEY is set in your environment.</p>
        </div>
      )}

      {!loading && !error && conversations.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-4xl mb-4">🎙️</p>
          <p className="text-slate-300">No conversations found.</p>
          <p className="text-slate-500 text-sm mt-2">Record a conversation with your Omi device, then come back.</p>
        </div>
      )}

      {!loading && filtered.length === 0 && conversations.length > 0 && (
        <div className="card p-8 text-center">
          <p className="text-slate-400">
            {filter === "analyzed" ? "No analyzed conversations yet." : "All conversations have been analyzed!"}
          </p>
          <button onClick={() => setFilter("all")} className="text-indigo-400 text-sm mt-2 hover:underline">
            Show all
          </button>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((convo) => {
          const isAnalyzed = analyzedIds.has(convo.id);
          const isSelected = selected.has(convo.id);

          if (selectMode) {
            return (
              <button
                key={convo.id}
                onClick={() => toggleSelect(convo.id)}
                className={`w-full text-left card p-5 transition-colors ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-950/30"
                    : "hover:border-slate-600"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-5 h-5 mt-1 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
                    isSelected
                      ? "bg-indigo-600 border-indigo-600"
                      : "border-slate-600"
                  }`}>
                    {isSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <span className="text-2xl mt-0.5">{convo.structured?.emoji || "💬"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-white truncate">
                        {convo.structured?.title || "Untitled"}
                      </h2>
                      {isAnalyzed && (
                        <span className="text-emerald-400 text-xs flex-shrink-0">✓</span>
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
              className={`card p-5 block transition-colors ${
                isAnalyzed ? "hover:border-emerald-500/50" : "hover:border-indigo-500/50"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl mt-0.5">{convo.structured?.emoji || "💬"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-white truncate">
                      {convo.structured?.title || "Untitled"}
                    </h2>
                    {isAnalyzed && (
                      <span className="text-emerald-400 text-xs flex-shrink-0">✓</span>
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
                <svg className="w-5 h-5 text-slate-600 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
