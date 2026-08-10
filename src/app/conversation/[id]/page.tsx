"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  getStoredAnalysis,
  getAnalysisVersions,
  getAnalysisAge,
  saveAnalysis,
  saveCustomAnalysis,
  type StoredAnalysis,
  type AnalysisVersion,
} from "@/lib/storage";
import { exportToObsidian, downloadMarkdown } from "@/lib/obsidian";
import { cacheGet, cacheSet } from "@/lib/cache";
import { RefreshIcon } from "@/components/icons";

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
  rq1_documentary_record: string;
  rq2_everyday_practices: string;
  rq3_cskt_intersection: string;
  rq4_wildness_imaginary: string;
  conditions_check: string;
  rival_hypothesis_test: string;
  refutation_signals: string;
  forward_thinking: string;
}

// ── Components ──

// Renders the full transcript. Long text wraps (min-w-0 + break-words) instead
// of overflowing horizontally, and there is no inner scroll box — the whole
// transcript flows in the page so it scrolls naturally (never frozen on touch).
function TranscriptViewer({ segments }: { segments: TranscriptSegment[] }) {
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => (
        <div key={i} className="flex gap-3 text-sm">
          <span className="text-slate-500 font-mono w-20 flex-shrink-0 text-right">
            {seg.speaker_name || `S${seg.speaker_id ?? 0}`}
          </span>
          <span className="flex-1 min-w-0 break-words whitespace-pre-wrap text-slate-300">
            {seg.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function AnalysisSection({
  icon,
  title,
  subtitle,
  content,
}: {
  icon: string;
  title: string;
  subtitle: string;
  content: string;
}) {
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3>
          <span aria-hidden="true">{icon}</span> {title}
        </h3>
        <p className="text-xs text-slate-500 mb-3">{subtitle}</p>
        <div className="whitespace-pre-wrap text-sm leading-relaxed">{content}</div>
      </div>
    </div>
  );
}

function AnalysisAgeBadge({ timestamp }: { timestamp: string }) {
  const { label, isStale } = getAnalysisAge(timestamp);

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full font-normal ${
        isStale
          ? "bg-amber-900/50 text-amber-300"
          : "bg-indigo-900/50 text-indigo-200"
      }`}
      title={`Analyzed on ${new Date(timestamp).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`}
    >
      {isStale ? "⚠ " : ""}{label}
    </span>
  );
}

function VersionHistory({
  versions,
  onSelect,
}: {
  versions: AnalysisVersion[];
  onSelect: (version: AnalysisVersion) => void;
}) {
  if (versions.length === 0) return null;

  return (
    <details className="card mt-4">
      <summary className="p-4 cursor-pointer text-sm text-slate-400 hover:text-slate-200 transition-colors min-h-[44px] flex items-center">
        📋 Previous versions ({versions.length})
      </summary>
      <div className="px-4 pb-4 space-y-2">
        {versions.map((v, i) => (
          <button
            key={v.id}
            onClick={() => onSelect(v)}
            className="w-full text-left p-3 rounded-lg bg-slate-900 hover:bg-slate-800 transition-colors min-h-[44px]"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">
                Version {versions.length - i}
              </span>
              <span className="text-xs text-slate-500">
                {new Date(v.timestamp).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">Click to view this version</p>
          </button>
        ))}
      </div>
    </details>
  );
}

function ConfirmRerunDialog({
  onConfirm,
  onCancel,
  analyzedLabel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  analyzedLabel: string;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm re-run analysis"
    >
      <div className="card p-6 max-w-md w-full border-amber-500/30">
        <h3 className="text-lg font-semibold text-white mb-2">
          ⚠️ Replace existing analysis?
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          This conversation was last analyzed <strong className="text-slate-200">{analyzedLabel}</strong>.
          Re-running will replace the current analysis. A copy will be saved in version history (last 3 versions kept).
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 min-h-[44px] text-sm text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 min-h-[44px] text-sm text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            Re-analyze
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [storedAnalysis, setStoredAnalysis] = useState<StoredAnalysis | null>(null);
  const [versions, setVersions] = useState<AnalysisVersion[]>([]);
  const [viewingVersion, setViewingVersion] = useState<AnalysisVersion | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [customAnalyzing, setCustomAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exported, setExported] = useState(false);
  const [customResult, setCustomResult] = useState<string | null>(null);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);

  // Load stored analysis
  useEffect(() => {
    const stored = getStoredAnalysis(id);
    if (stored) {
      setStoredAnalysis(stored);
      setAnalysis({
        rq1_documentary_record: stored.rq1_documentary_record,
        rq2_everyday_practices: stored.rq2_everyday_practices,
        rq3_cskt_intersection: stored.rq3_cskt_intersection,
        rq4_wildness_imaginary: stored.rq4_wildness_imaginary,
        conditions_check: stored.conditions_check,
        rival_hypothesis_test: stored.rival_hypothesis_test,
        refutation_signals: stored.refutation_signals,
        forward_thinking: stored.forward_thinking,
      });
      if (stored.custom) {
        setCustomPrompt(stored.custom.prompt);
        setCustomResult(stored.custom.result);
      }
    }
    setVersions(getAnalysisVersions(id));
  }, [id]);

  // Load a conversation (with transcript) from Omi.
  //   • initial: a finished transcript is immutable, so serve the cached copy
  //     instantly and skip the network; only fetch on a cache miss.
  //   • refresh: force a fresh pull from Omi and write it through to the cache.
  const loadConversation = useCallback(async (mode: "initial" | "refresh") => {
    const cacheKey = `conversation:${id}`;

    if (mode === "initial") {
      const cached = cacheGet<Conversation>(cacheKey);
      if (cached) {
        setConversation(cached.data);
        setLastSynced(new Date(Date.now() - cached.ageMs).toISOString());
        setLoading(false);
        return;
      }
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const res = await fetch(
        `/api/conversations/${id}`,
        mode === "refresh" ? { cache: "no-store" } : undefined
      );
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setConversation(data);
        setError(null);
        setLastSynced(new Date().toISOString());
        if (data.transcript_segments?.length) cacheSet(cacheKey, data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach Omi");
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    loadConversation("initial");
  }, [loadConversation]);

  const executeAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    setViewingVersion(null);
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
        if (data.conversation) {
          setConversation(data.conversation);
          if (data.conversation.transcript_segments?.length) {
            cacheSet(`conversation:${id}`, data.conversation);
          }
        }
        const stored = saveAnalysis({
          conversationId: id,
          title: data.conversation?.structured?.title || conversation?.structured?.title || "Untitled",
          category: data.conversation?.structured?.category,
          date: data.conversation?.created_at,
          ...data.analysis,
        });
        setStoredAnalysis(stored);
        setVersions(getAnalysisVersions(id));
        // Tuck the verification/custom cards away now that results are up.
        setTranscriptOpen(false);
        setShowCustom(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
      setShowRerunConfirm(false);
    }
  }, [id, conversation]);

  const handleAnalyzeClick = useCallback(() => {
    if (storedAnalysis) {
      setShowRerunConfirm(true);
    } else {
      executeAnalysis();
    }
  }, [storedAnalysis, executeAnalysis]);

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
        setCustomResult(data.result);
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

  const viewVersion = useCallback((version: AnalysisVersion) => {
    setViewingVersion(version);
    setAnalysis(version.analysis);
  }, []);

  const viewCurrent = useCallback(() => {
    setViewingVersion(null);
    if (storedAnalysis) {
      setAnalysis({
        rq1_documentary_record: storedAnalysis.rq1_documentary_record,
        rq2_everyday_practices: storedAnalysis.rq2_everyday_practices,
        rq3_cskt_intersection: storedAnalysis.rq3_cskt_intersection,
        rq4_wildness_imaginary: storedAnalysis.rq4_wildness_imaginary,
        conditions_check: storedAnalysis.conditions_check,
        rival_hypothesis_test: storedAnalysis.rival_hypothesis_test,
        refutation_signals: storedAnalysis.refutation_signals,
        forward_thinking: storedAnalysis.forward_thinking,
      });
    }
  }, [storedAnalysis]);

  const sections = analysis
    ? [
        { icon: "📜", title: "RQ1 — Documentary Record", subtitle: "Historical-legal constitution of authority: patents, water rights, allotments, grazing permits", content: analysis.rq1_documentary_record },
        { icon: "🏚️", title: "RQ2 — Everyday Practices", subtitle: "Kinship, inheritance, branding, boundary-maintenance, conflict — how authority is produced daily", content: analysis.rq2_everyday_practices },
        { icon: "🪶", title: "RQ3 — CSKT Intersection", subtitle: "How ranching authority intersects with, depends on, and is contested by CSKT sovereignty", content: analysis.rq3_cskt_intersection },
        { icon: "🐎", title: "RQ4 — Wildness Imaginary", subtitle: "Frontier mythology as double-erasure instrument (4A: Indigenous erasure, 4B: federal erasure)", content: analysis.rq4_wildness_imaginary },
        { icon: "🎯", title: "Orienting Conditions", subtitle: "Which of the five conditions are evidenced in this conversation?", content: analysis.conditions_check },
        { icon: "⚖️", title: "Rival Hypothesis Test", subtitle: "Is frontier framing public/strategic or intimate? Felt subjectivity or instrumental rhetoric?", content: analysis.rival_hypothesis_test },
        { icon: "❌", title: "Refutation Signals", subtitle: "Does anything challenge or complicate the pioneer sovereignty concept?", content: analysis.refutation_signals },
        { icon: "🚀", title: "Forward Thinking", subtitle: "Research directions, questions to pursue, connections to other data", content: analysis.forward_thinking },
      ]
    : [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <Link href="/" className="text-slate-400 hover:text-white text-sm inline-flex items-center gap-1 min-h-[44px] py-2">
          ← Back to conversations
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400" aria-live="polite">
            {refreshing ? "Refreshing…" : lastSynced ? `Synced ${getAnalysisAge(lastSynced).label}` : ""}
          </span>
          <button
            onClick={() => loadConversation("refresh")}
            disabled={loading || refreshing}
            aria-label="Refresh this conversation and transcript from Omi"
            className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
          >
            <RefreshIcon className={`w-4 h-4 flex-shrink-0 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {loading && (
        <div className="space-y-4" role="status" aria-label="Loading conversation">
          <div className="skeleton h-8 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-32 w-full" />
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400">⚠ {error}</p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-sm text-slate-400 hover:text-white min-h-[44px] px-2"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {conversation && (
        <>
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-white mb-2">
              <span aria-hidden="true">{conversation.structured?.emoji || "💬"}</span>{" "}
              {conversation.structured?.title || "Untitled"}
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

          {/* Analyze button */}
          {!analysis && (
            <button
              onClick={handleAnalyzeClick}
              disabled={analyzing}
              aria-label="Run Pioneer Sovereignty analysis on this conversation"
              className="w-full card p-6 text-center hover:border-indigo-500/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mb-8 min-h-[44px]"
            >
              {analyzing ? (
                <div className="flex items-center justify-center gap-3">
                  <span className="pulse-dot text-2xl" aria-hidden="true">⏳</span>
                  <div>
                    <p className="font-semibold text-white">Analyzing conversation...</p>
                    <p className="text-slate-400 text-sm mt-1">Running 8-dimension Pioneer Sovereignty analysis</p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="text-2xl mb-2" aria-hidden="true">🧠</p>
                  <p className="font-semibold text-white">Run Pioneer Sovereignty Analysis</p>
                  <p className="text-slate-400 text-sm mt-1">4 research questions + conditions + rival hypothesis + refutation</p>
                </div>
              )}
            </button>
          )}

          {/* Analysis results */}
          {sections.length > 0 && (
            <section className="mb-8" aria-label="Pioneer Sovereignty analysis results">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-2 flex-wrap">
                  🧠 Pioneer Sovereignty Analysis
                  {storedAnalysis && (
                    <AnalysisAgeBadge timestamp={storedAnalysis.timestamp} />
                  )}
                  {viewingVersion && (
                    <span className="text-xs bg-rose-900/50 text-rose-300 px-2 py-0.5 rounded-full font-normal">
                      viewing previous version
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2">
                  {viewingVersion && (
                    <button
                      onClick={viewCurrent}
                      aria-label="Return to current analysis"
                      className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors"
                    >
                      ← Current
                    </button>
                  )}
                  {storedAnalysis && !viewingVersion && (
                    <>
                      <button
                        onClick={handleExportObsidian}
                        aria-label="Export analysis to Obsidian vault"
                        className="text-sm bg-purple-900/40 hover:bg-purple-800/50 text-purple-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors"
                      >
                        {exported ? "✓ Saved" : "📓 Send to Obsidian"}
                      </button>
                      <button
                        onClick={handleDownload}
                        aria-label="Download analysis as markdown file"
                        className="text-sm bg-amber-900/40 hover:bg-amber-800/50 text-amber-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors"
                      >
                        ⬇ Download .md
                      </button>
                    </>
                  )}
                  {!viewingVersion && (
                    <button
                      onClick={handleAnalyzeClick}
                      disabled={analyzing}
                      aria-label="Re-run analysis"
                      className="text-sm text-slate-400 hover:text-indigo-400 transition-colors px-2 py-2 min-h-[44px]"
                    >
                      🔄
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-6">
                {sections.map((section) => (
                  <AnalysisSection key={section.title} {...section} />
                ))}
              </div>

              {/* Version history */}
              {!viewingVersion && (
                <VersionHistory versions={versions} onSelect={viewVersion} />
              )}
            </section>
          )}

          {/* Re-run confirmation dialog */}
          {showRerunConfirm && storedAnalysis && (
            <ConfirmRerunDialog
              onConfirm={executeAnalysis}
              onCancel={() => setShowRerunConfirm(false)}
              analyzedLabel={getAnalysisAge(storedAnalysis.timestamp).label}
            />
          )}

          {/* Custom analysis — collapsed by default; auto-collapses after an
              analysis runs so it tucks away without disappearing. */}
          <section className="mb-8" aria-label="Custom analysis">
            <button
              onClick={() => setShowCustom(!showCustom)}
              aria-expanded={showCustom}
              aria-controls="custom-analysis-panel"
              className="w-full card p-5 text-left hover:border-amber-500/50 transition-colors cursor-pointer flex items-center justify-between min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <span className="text-xl" aria-hidden="true">⚙️</span>
                <div>
                  <p className="font-semibold text-white">Custom Analysis</p>
                  <p className="text-slate-500 text-sm">
                    {customResult
                      ? `Last: "${customPrompt.substring(0, 50)}..."`
                      : "Ask any question about this conversation through the lens of Pioneer Sovereignty"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {customResult && <span className="text-xs bg-amber-900/40 text-amber-200 px-2 py-0.5 rounded-full">saved</span>}
                <svg
                  className={`w-5 h-5 text-slate-500 transition-transform ${showCustom ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {showCustom && (
              <div id="custom-analysis-panel" className="card mt-2 p-6 border-amber-500/30">
                <label className="block mb-3">
                  <span className="text-sm font-medium text-slate-300 mb-2 block">What do you want to explore?</span>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="e.g., Does the double erasure appear here? Is this public or intimate register? What would Rifkin's 'settler common sense' say?"
                    aria-label="Custom analysis question"
                    maxLength={2000}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-600 focus:border-amber-500 focus:outline-none resize-none"
                    rows={3}
                  />
                  <div className="text-xs text-slate-600 text-right mt-1">{customPrompt.length}/2000</div>
                </label>
                <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Quick prompt suggestions">
                  {[
                    "Does the double erasure appear here?",
                    "Is this public or intimate register?",
                    "What would Rifkin's 'settler common sense' say?",
                    "How does the wildness imaginary operate in this scene?",
                    "Is there evidence of refrontierisation?",
                    "What would disconfirm pioneer sovereignty here?",
                  ].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setCustomPrompt(preset)}
                      aria-label={`Use prompt: ${preset}`}
                      className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white px-3 py-2 min-h-[44px] rounded-md transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <button
                  onClick={runCustomAnalysis}
                  disabled={customAnalyzing || !customPrompt.trim()}
                  aria-label="Run custom analysis"
                  className="bg-amber-600 hover:bg-amber-500 disabled:bg-slate-700 disabled:text-white text-white font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors"
                >
                  {customAnalyzing ? (
                    <span className="flex items-center gap-2"><span className="pulse-dot" aria-hidden="true">⏳</span> Analyzing...</span>
                  ) : (
                    "Run Custom Analysis"
                  )}
                </button>
              </div>
            )}

            {customResult && (
              <div className="card mt-2 p-6 border-amber-500/30">
                <div className="analysis-section" style={{ background: "var(--custom-analysis-bg, rgba(245, 158, 11, 0.06))" }}>
                  <h3 style={{ color: "var(--custom-analysis-text, #fbbf24)" }}>
                    <span aria-hidden="true">⚙️</span> Custom Analysis
                  </h3>
                  <p className="text-xs text-slate-500 mb-1">Prompt: &ldquo;{customPrompt}&rdquo;</p>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed mt-3">{customResult}</div>
                </div>
              </div>
            )}
          </section>

          {/* Transcript — collapsed by default; auto-collapses after an
              analysis runs. Expands to the full, page-scrollable transcript. */}
          {conversation.transcript_segments && conversation.transcript_segments.length > 0 && (
            <details
              className="card"
              open={transcriptOpen}
              onToggle={(e) => setTranscriptOpen(e.currentTarget.open)}
            >
              <summary className="p-5 cursor-pointer font-semibold text-white hover:text-indigo-300 transition-colors min-h-[44px] flex items-center">
                📄 Transcript ({conversation.transcript_segments.length} segments)
              </summary>
              <div className="px-5 pb-5">
                <TranscriptViewer segments={conversation.transcript_segments} />
              </div>
            </details>
          )}
        </>
      )}
    </main>
  );
}
