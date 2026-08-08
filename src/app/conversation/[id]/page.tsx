"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getStoredAnalysis,
  saveAnalysis,
  saveCustomAnalysis,
  type StoredAnalysis,
} from "@/lib/storage";
import { exportToObsidian, downloadMarkdown } from "@/lib/obsidian";

interface TranscriptSegment {
  text: string;
  speaker_id?: number;
  speaker_name?: string;
}

interface Conversation {
  id: string;
  created_at: string;
  structured?: {
    title?: string;
    overview?: string;
    emoji?: string;
    category?: string;
  };
  transcript_segments?: TranscriptSegment[];
}

interface Analysis {
  thesis_relevance: string;
  meanings: string;
  summary: string;
  forward_thinking: string;
}

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [storedAnalysis, setStoredAnalysis] = useState<StoredAnalysis | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [customAnalyzing, setCustomAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);

  // Load stored analysis on mount
  useEffect(() => {
    const stored = getStoredAnalysis(id);
    if (stored) {
      setStoredAnalysis(stored);
      setAnalysis({
        thesis_relevance: stored.thesis_relevance,
        meanings: stored.meanings,
        summary: stored.summary,
        forward_thinking: stored.forward_thinking,
      });
      if (stored.custom) {
        setCustomPrompt(stored.custom.prompt);
      }
    }
  }, [id]);

  // Fetch conversation
  useEffect(() => {
    fetch(`/api/conversations/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setConversation(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        setAnalysis(data.analysis);
        if (data.conversation) setConversation(data.conversation);

        // Persist to localStorage
        const stored = saveAnalysis({
          conversationId: id,
          title: data.conversation?.structured?.title || conversation?.structured?.title || "Untitled",
          category: data.conversation?.structured?.category,
          date: data.conversation?.created_at,
          thesis_relevance: data.analysis.thesis_relevance,
          meanings: data.analysis.meanings,
          summary: data.analysis.summary,
          forward_thinking: data.analysis.forward_thinking,
        });
        setStoredAnalysis(stored);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [id, conversation]);

  const runCustomAnalysis = useCallback(async () => {
    if (!customPrompt.trim()) return;
    setCustomAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, prompt: customPrompt }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
      else {
        const custom = { prompt: customPrompt, result: data.result };
        saveCustomAnalysis(id, custom);
        setStoredAnalysis((prev) =>
          prev ? { ...prev, custom: { ...custom, timestamp: new Date().toISOString() } } : prev
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Custom analysis failed");
    } finally {
      setCustomAnalyzing(false);
    }
  }, [id, customPrompt]);

  const handleExportObsidian = useCallback(() => {
    if (!storedAnalysis) return;
    const { uri } = exportToObsidian(storedAnalysis);
    window.open(uri, "_blank");
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [storedAnalysis]);

  const handleDownload = useCallback(() => {
    if (!storedAnalysis) return;
    downloadMarkdown(storedAnalysis);
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [storedAnalysis]);

  const sections = analysis
    ? [
        { icon: "🎯", title: "Thesis Relevance", subtitle: 'Connection to "Pioneer Sovereignty"', content: analysis.thesis_relevance },
        { icon: "🔍", title: "Derived Meanings", subtitle: "Deeper patterns and insights", content: analysis.meanings },
        { icon: "📝", title: "Summary", subtitle: "Comprehensive overview", content: analysis.summary },
        { icon: "🚀", title: "Forward Thinking", subtitle: "Next steps and research directions", content: analysis.forward_thinking },
      ]
    : [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1">
        ← Back to conversations
      </Link>

      {loading && <div className="skeleton h-64 w-full" />}

      {error && (
        <div className="card p-6 border-red-500/50 mb-6">
          <p className="text-red-400">⚠ {error}</p>
        </div>
      )}

      {conversation && (
        <>
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-white mb-2">
              {conversation.structured?.emoji || "💬"} {conversation.structured?.title || "Untitled"}
            </h1>
            {conversation.structured?.overview && (
              <p className="text-slate-400">{conversation.structured.overview}</p>
            )}
            <p className="text-slate-500 text-sm mt-2">
              {new Date(conversation.created_at).toLocaleDateString("en-GB", {
                weekday: "long", day: "numeric", month: "long", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
          </header>

          {/* Analyze button — only shown if no stored analysis */}
          {!analysis && (
            <button
              onClick={runAnalysis}
              disabled={analyzing}
              className="w-full card p-6 text-center hover:border-indigo-500/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mb-8"
            >
              {analyzing ? (
                <div className="flex items-center justify-center gap-3">
                  <span className="pulse-dot text-2xl">⏳</span>
                  <div>
                    <p className="font-semibold text-white">Analyzing conversation...</p>
                    <p className="text-slate-400 text-sm mt-1">Running 4-dimension analysis</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-2xl mb-2">🧠</p>
                  <p className="font-semibold text-white">Run Thesis Analysis</p>
                  <p className="text-slate-400 text-sm mt-1">Analyze through the lens of Pioneer Sovereignty</p>
                </div>
              )}
            </button>
          )}

          {/* Analysis results */}
          {sections.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  🧠 Analysis
                  <span className="text-xs bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full font-normal">saved</span>
                </h2>
                <div className="flex items-center gap-2">
                  {storedAnalysis && (
                    <>
                      <button
                        onClick={handleExportObsidian}
                        className="text-xs bg-purple-900/40 hover:bg-purple-800/50 text-purple-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                      >
                        {exported ? "✓ Saved" : "📓 Send to Obsidian"}
                      </button>
                      <button
                        onClick={handleDownload}
                        className="text-xs bg-amber-900/40 hover:bg-amber-800/50 text-amber-300 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                      >
                        ⬇ Download .md
                      </button>
                    </>
                  )}
                  <button
                    onClick={runAnalysis}
                    disabled={analyzing}
                    className="text-xs text-slate-500 hover:text-indigo-400 transition-colors px-2 py-1.5"
                  >
                    🔄 Re-analyze
                  </button>
                </div>
              </div>
              <div className="space-y-6">
                {sections.map((section) => (
                  <div key={section.title} className="card p-6">
                    <div className="analysis-section">
                      <h3>{section.icon} {section.title}</h3>
                      <p className="text-xs text-slate-500 mb-3">{section.subtitle}</p>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed">{section.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fifth: Custom Analysis (toggle) */}
          <div className="mb-8">
            <button
              onClick={() => setShowCustom(!showCustom)}
              className="w-full card p-5 text-left hover:border-amber-500/50 transition-colors cursor-pointer flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl">⚙️</span>
                <div>
                  <p className="font-semibold text-white">Custom Analysis</p>
                  <p className="text-slate-500 text-sm">
                    {storedAnalysis?.custom
                      ? `Last: "${storedAnalysis.custom.prompt.substring(0, 50)}..."`
                      : "Write your own analysis prompt for ad-hoc needs"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {storedAnalysis?.custom && (
                  <span className="text-xs bg-amber-900/40 text-amber-300 px-2 py-0.5 rounded-full">saved</span>
                )}
                <svg
                  className={`w-5 h-5 text-slate-500 transition-transform ${showCustom ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {showCustom && (
              <div className="card mt-2 p-6 border-amber-500/30">
                <label className="block mb-3">
                  <span className="text-sm font-medium text-slate-300 mb-2 block">What do you want to explore?</span>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="e.g., What power dynamics are at play? How does this relate to land sovereignty? What would James Scott say?"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-600 focus:border-amber-500 focus:outline-none resize-none"
                    rows={4}
                  />
                </label>
                <div className="flex items-center gap-3">
                  <button
                    onClick={runCustomAnalysis}
                    disabled={customAnalyzing || !customPrompt.trim()}
                    className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-slate-500 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
                  >
                    {customAnalyzing ? (
                      <span className="flex items-center gap-2"><span className="pulse-dot">⏳</span> Analyzing...</span>
                    ) : (
                      "Run Custom Analysis"
                    )}
                  </button>
                </div>

                {/* Preset prompts */}
                <div className="mt-4 pt-4 border-t border-slate-800">
                  <p className="text-xs text-slate-500 mb-2">Quick prompts:</p>
                  <div className="flex flex-wrap gap-2">
                    {[
                      "What power dynamics are at play?",
                      "How does this relate to land sovereignty?",
                      "What would James Scott say about this?",
                      "Identify implicit knowledge and local epistemologies",
                      "What are the economic undercurrents?",
                      "How does place shape this conversation?",
                    ].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => setCustomPrompt(preset)}
                        className="text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 px-2 py-1 rounded-md transition-colors"
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Custom analysis result */}
            {storedAnalysis?.custom && (
              <div className="card mt-2 p-6 border-amber-500/30">
                <div className="analysis-section" style={{ borderLeftColor: "#f59e0b" }}>
                  <h3 style={{ color: "#fbbf24" }}>⚙️ Custom Analysis</h3>
                  <p className="text-xs text-slate-500 mb-1">Prompt: &ldquo;{storedAnalysis.custom.prompt}&rdquo;</p>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed mt-3">
                    {storedAnalysis.custom.result}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Transcript */}
          {conversation.transcript_segments && conversation.transcript_segments.length > 0 && (
            <details className="card">
              <summary className="p-5 cursor-pointer font-semibold text-white hover:text-indigo-300 transition-colors">
                📄 Transcript ({conversation.transcript_segments.length} segments)
              </summary>
              <div className="px-5 pb-5 space-y-2 max-h-96 overflow-y-auto">
                {conversation.transcript_segments.map((seg, i) => (
                  <div key={i} className="flex gap-3 text-sm">
                    <span className="text-slate-500 font-mono w-20 flex-shrink-0 text-right">
                      {seg.speaker_name || `S${seg.speaker_id ?? 0}`}
                    </span>
                    <span className="text-slate-300">{seg.text}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </main>
  );
}
