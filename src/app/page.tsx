"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setConversations(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          📚 Thesis Analyzer
        </h1>
        <p className="text-slate-400">
          AI-powered analysis of your Omi conversations through the lens of
          Pioneer Sovereignty
        </p>
      </header>

      {loading && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-24 w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50">
          <p className="text-red-400">⚠ {error}</p>
          <p className="text-slate-500 text-sm mt-2">
            Make sure OMI_API_KEY is set in your environment.
          </p>
        </div>
      )}

      {!loading && !error && conversations.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-4xl mb-4">🎙️</p>
          <p className="text-slate-300">No conversations found.</p>
          <p className="text-slate-500 text-sm mt-2">
            Record a conversation with your Omi device, then come back.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {conversations.map((convo) => (
          <Link
            key={convo.id}
            href={`/conversation/${convo.id}`}
            className="card p-5 block hover:border-indigo-500/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl mt-0.5">
                {convo.structured?.emoji || "💬"}
              </span>
              <div className="flex-1 min-w-0">
                <h2 className="font-semibold text-white truncate">
                  {convo.structured?.title || "Untitled"}
                </h2>
                {convo.structured?.overview && (
                  <p className="text-slate-400 text-sm mt-1 line-clamp-2">
                    {convo.structured.overview}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                  <span>
                    {new Date(convo.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {convo.structured?.category && (
                    <span className="bg-slate-800 px-2 py-0.5 rounded-full">
                      {convo.structured.category}
                    </span>
                  )}
                  {convo.folder_name && (
                    <span className="bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full">
                      📁 {convo.folder_name}
                    </span>
                  )}
                </div>
              </div>
              <svg
                className="w-5 h-5 text-slate-600 mt-1 flex-shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
