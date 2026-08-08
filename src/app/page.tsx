"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAnalyzedIds, getStoredAnalyses } from "@/lib/storage";

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");

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

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">📚 Thesis Analyzer</h1>
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
                      <span className="text-emerald-400 text-xs flex-shrink-0" title="Analyzed">✓</span>
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
