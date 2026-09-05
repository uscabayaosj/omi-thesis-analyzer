"use client";

import { Prose } from "@/components/Prose";
import { useEffect, useState, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import {
  ArrowLeftIcon,
  CompassIcon,
  WarningIcon,
  CheckIcon,
  ExternalLinkIcon,
  DownloadIcon,
  RefreshIcon,
  LoaderIcon,
  LinkIcon,
  ZapIcon,
  TrendingUpIcon,
  PuzzleIcon,
  CogIcon,
} from "@/components/icons";
import { BUTTON_PRIMARY, LINK_BACK, BUTTON_SECONDARY } from "@/lib/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import { schedulePush, pullAndMerge } from "@/lib/sync";

interface ConvoRef {
  id: string;
  title: string;
  date: string;
  emoji: string;
}

interface GroupAnalysis {
  cross_conversation_themes: string;
  contradictions_and_tensions: string;
  evolution_and_patterns: string;
  synthesis: string;
  forward_thinking: string;
}

interface StoredGroupAnalysis {
  id: string;
  conversationIds: string[];
  conversations: ConvoRef[];
  timestamp: string;
  analysis: GroupAnalysis;
  custom?: { prompt: string; result: string; timestamp: string };
}

const STORAGE_KEY = "omi-thesis-group-analyses";

function getStoredGroupAnalyses(): StoredGroupAnalysis[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is StoredGroupAnalysis =>
        a && typeof a === "object" && Array.isArray(a.conversationIds) && !!a.analysis
    );
  } catch {
    return [];
  }
}

function groupKey(ids: string[]): string {
  return [...ids].sort().join(",");
}

function persistGroups(all: StoredGroupAnalysis[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    schedulePush(STORAGE_KEY);
  } catch (e) {
    if (e instanceof DOMException && e.name === "QuotaExceededError") {
      // Keep only the 5 most recent groups and retry once
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all.slice(0, 5)));
        return;
      } catch {
        // fall through
      }
    }
    console.error("Failed to save group analysis to localStorage:", e);
  }
}

function saveGroupAnalysis(data: Omit<StoredGroupAnalysis, "id" | "timestamp">): StoredGroupAnalysis {
  const all = getStoredGroupAnalyses();
  const key = groupKey(data.conversationIds);
  const existing = all.findIndex((a) => groupKey(a.conversationIds) === key);

  const stored: StoredGroupAnalysis = {
    ...data,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };

  if (existing >= 0) {
    if (!stored.custom && all[existing].custom) stored.custom = all[existing].custom;
    stored.id = all[existing].id;
    all[existing] = stored;
  } else {
    all.unshift(stored);
  }

  persistGroups(all);
  return stored;
}

function saveGroupCustom(
  conversationIds: string[],
  custom: { prompt: string; result: string }
) {
  const all = getStoredGroupAnalyses();
  const key = groupKey(conversationIds);
  const existing = all.find((a) => groupKey(a.conversationIds) === key);
  if (existing) {
    existing.custom = { ...custom, timestamp: new Date().toISOString() };
    persistGroups(all);
  }
}

function safeDay(date: string | undefined): string {
  return typeof date === "string" && date.length >= 10 ? date.split("T")[0] : "unknown-date";
}

function buildGroupMarkdown(stored: StoredGroupAnalysis): { markdown: string; filename: string } {
  const dates = stored.conversations.map((c) => safeDay(c.date));
  const dateRange =
    dates.length > 1 ? `${dates[0]} to ${dates[dates.length - 1]}` : dates[0] ?? "unknown-date";
  const titles = stored.conversations.map((c) => c.title || "Untitled").join(", ");
  const safeName = (titles || "Untitled group").replace(/[\/\\:*?"<>|]/g, "-").substring(0, 80);

  const convoLinks = stored.conversations
    .map((c) => {
      const d = safeDay(c.date);
      return `- [[${d} - ${(c.title || "Untitled").replace(/[\/\\:*?"<>|]/g, "-")}]]`;
    })
    .join("\n");

  const markdown = `---
title: "Group Analysis: ${titles.replace(/"/g, '\\"').substring(0, 100)}"
date: ${dateRange}
analyzed: ${stored.timestamp}
type: group-analysis
source: Omi DK2
tags:
  - omi-analysis
  - fieldwork
  - group-analysis
  - pioneer-sovereignty
---

# Group Analysis

> [!info] ${stored.conversations.length} conversations analyzed together on ${new Date(stored.timestamp).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}.

## Conversations in this group

${convoLinks}

## 🔗 Cross-Conversation Themes

${stored.analysis.cross_conversation_themes}

## ⚡ Contradictions & Tensions

${stored.analysis.contradictions_and_tensions}

## 📈 Evolution & Patterns

${stored.analysis.evolution_and_patterns}

## 🧩 Synthesis

${stored.analysis.synthesis}

## 🚀 Forward Thinking

${stored.analysis.forward_thinking}
${stored.custom ? `
## ⚙️ Custom Analysis

> **Prompt:** ${stored.custom.prompt}

${stored.custom.result}` : ""}
---
*Generated by [[TRACE]] — Pioneer Sovereignty fieldwork analysis.*
`;

  return { markdown, filename: `Group - ${safeName}` };
}

function exportGroupToObsidian(stored: StoredGroupAnalysis): string {
  const { markdown, filename } = buildGroupMarkdown(stored);

  const params = new URLSearchParams({
    vault: "PhDVault",
    name: `Fieldwork/Omi Analysis/${filename}`,
    content: markdown,
    append: "false",
  });

  return `obsidian://advanced-uri?${params.toString()}`;
}

function downloadGroupMarkdown(stored: StoredGroupAnalysis): void {
  const { markdown, filename } = buildGroupMarkdown(stored);
  const blob = new Blob([markdown], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function GroupAnalysisContent() {
  const searchParams = useSearchParams();
  const idsParam = searchParams.get("ids") ?? "";
  // Memoize on the raw string — a fresh array every render would re-trigger
  // every effect and callback that depends on it.
  const ids = useMemo(
    () => Array.from(new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean))),
    [idsParam]
  );

  const [analysis, setAnalysis] = useState<GroupAnalysis | null>(null);
  const [conversations, setConversations] = useState<ConvoRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [customAnalyzing, setCustomAnalyzing] = useState(false);
  const [exported, setExported] = useState(false);
  const [customResult, setCustomResult] = useState<string | null>(null);
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    // Can't be a lazy useState initializer: this must re-run whenever `ids`
    // changes (navigating to a different group on the same mounted route),
    // and localStorage isn't available during the server-rendered first
    // paint — reading it before mount would cause a hydration mismatch.
    const key = groupKey(ids);
    const applyStored = (): boolean => {
      const stored = getStoredGroupAnalyses();
      const existing = stored.find((a) => groupKey(a.conversationIds) === key);
      if (!existing) return false;
      setAnalysis(existing.analysis);
      setConversations(existing.conversations);
      if (existing.custom) {
        setCustomPrompt(existing.custom.prompt);
        setCustomResult(existing.custom.result);
      }
      return true;
    };

    const foundLocally = applyStored();
    if (foundLocally) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }

    // Not found on this device yet — it may exist server-side (e.g. this
    // page was reached via a server-side search result on a group first
    // created on another device). Force a pull even if an earlier page this
    // session already pulled once (pullAndMerge's once-per-session latch
    // would otherwise skip a group that appeared server-side after that
    // first pull) and re-check before showing "not analyzed yet".
    pullAndMerge(true).then((changed) => {
      if (changed) applyStored();
      setLoading(false);
    });
  }, [ids]);

  const runAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const data = await fetchJson<{
        analysis: GroupAnalysis;
        conversations: ConvoRef[];
        skipped?: number;
      }>("/api/analyze-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: ids }),
      });
      setAnalysis(data.analysis);
      setConversations(data.conversations);
      setSkipped(data.skipped ?? 0);
      saveGroupAnalysis({
        conversationIds: ids,
        conversations: data.conversations,
        analysis: data.analysis,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  }, [ids]);

  const runCustom = useCallback(async () => {
    if (!customPrompt.trim()) return;
    setCustomAnalyzing(true);
    setError(null);
    try {
      const data = await fetchJson<{ result: string }>("/api/analyze-group/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationIds: ids, prompt: customPrompt }),
      });
      saveGroupCustom(ids, { prompt: customPrompt, result: data.result });
      setCustomResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Custom analysis failed");
    } finally {
      setCustomAnalyzing(false);
    }
  }, [ids, customPrompt]);

  const findStoredGroup = useCallback(() => {
    const stored = getStoredGroupAnalyses();
    const key = groupKey(ids);
    return stored.find((a) => groupKey(a.conversationIds) === key);
  }, [ids]);

  const handleExportObsidian = () => {
    const existing = findStoredGroup();
    if (existing) {
      const uri = exportGroupToObsidian(existing);
      if (uri.length > 30_000) {
        // Very long custom-scheme URIs get silently dropped on some platforms
        downloadGroupMarkdown(existing);
      } else {
        window.open(uri, "_blank");
      }
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    }
  };

  const handleDownloadGroup = () => {
    const existing = findStoredGroup();
    if (existing) {
      downloadGroupMarkdown(existing);
      setExported(true);
      setTimeout(() => setExported(false), 2000);
    }
  };

  const sections = analysis
    ? [
        { icon: LinkIcon, title: "Cross-Conversation Themes", subtitle: "Recurring ideas and shared concerns", content: analysis.cross_conversation_themes },
        { icon: ZapIcon, title: "Contradictions & Tensions", subtitle: "Where conversations diverge or conflict", content: analysis.contradictions_and_tensions },
        { icon: TrendingUpIcon, title: "Evolution & Patterns", subtitle: "How ideas change over time", content: analysis.evolution_and_patterns },
        { icon: PuzzleIcon, title: "Synthesis", subtitle: "The bigger picture across all conversations", content: analysis.synthesis },
        { icon: CompassIcon, title: "Forward Thinking", subtitle: "Research directions from cross-conversation patterns", content: analysis.forward_thinking },
      ]
    : [];

  if (ids.length < 2) {
    return (
      <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
        <Link href="/" className={LINK_BACK}>
          <ArrowLeftIcon className="w-4 h-4" />
          Back to conversations
        </Link>
        <div className="card p-8 text-center">
          <CompassIcon className="w-8 h-8 mx-auto mb-3 text-slate-400" />
          <h1 className="font-bold text-white mb-2">Group analysis needs at least 2 conversations</h1>
          <p className="text-slate-400 text-sm mb-6">
            Use &ldquo;Select &amp; Analyze Group&rdquo; on the conversations list to pick two or more, then come back here.
          </p>
          <Link
            href="/"
            className={`${BUTTON_PRIMARY} py-2 px-5 inline-flex items-center`}
          >
            Choose conversations
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      {/* Group analyses keep no version history, so a re-run is unrecoverable —
          the same guard the single-conversation lenses carry. */}
      {showRerunConfirm && (
        <ConfirmDialog
          title="Replace this group analysis?"
          tone="danger"
          body={
            <>
              Group analyses keep no version history, so the current one for these{" "}
              {conversations.length} conversations will be gone. Any custom analysis saved alongside it is kept.
            </>
          }
          confirmLabel="Replace it"
          onConfirm={() => {
            setShowRerunConfirm(false);
            runAnalysis();
          }}
          onCancel={() => setShowRerunConfirm(false)}
        />
      )}
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
          Synthesis
        </p>
        <h1 className="font-bold text-white mb-2 flex items-center gap-2">
          <CompassIcon className="w-6 h-6 text-cyan-400 flex-shrink-0" />
          Group Analysis
        </h1>
        <p className="text-slate-400 font-serif italic text-sm">
          {ids.length} conversations selected for cross-conversation analysis
        </p>
        {skipped > 0 && (
          <p
            className={`text-sm mt-1 ${skipped >= ids.length / 2 ? "font-semibold text-red-300" : "text-amber-300/90"}`}
            role="status"
          >
            {skipped >= ids.length / 2 ? "⚠ " : ""}
            {skipped} of {ids.length} conversation{ids.length === 1 ? "" : "s"} could not be loaded and {skipped === 1 ? "was" : "were"} left out
            {skipped >= ids.length / 2 ? " — this synthesis covers less than half of the selected group and should not be treated as complete." : " of this analysis."}
          </p>
        )}
        {conversations.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3" role="list" aria-label="Conversations in this group">
            {conversations.map((c) => (
              <span key={c.id} className="font-serif text-sm bg-slate-800 text-slate-300 px-3 py-1.5 rounded-md" role="listitem">
                <span aria-hidden="true">{c.emoji}</span> {c.title}
              </span>
            ))}
          </div>
        )}
      </header>

      {loading && (
        <div className="space-y-4" role="status" aria-label="Loading group analysis">
          <div className="skeleton h-8 w-3/4" />
          <div className="skeleton h-4 w-1/2" />
          <div className="skeleton h-32 w-full" />
          <div className="skeleton h-32 w-full" />
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          <button
            onClick={() => setError(null)}
            className="mt-2 text-sm text-slate-400 hover:text-white min-h-[44px] px-2"
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Analyze button */}
      {!analysis && !loading && (
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          aria-label={`Run group analysis on ${ids.length} conversations`}
          className="w-full card p-6 text-center hover:border-cyan-500/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mb-8 min-h-[44px]"
        >
          {analyzing ? (
            <div className="flex items-center justify-center gap-3">
              <LoaderIcon className="w-6 h-6 text-cyan-400 animate-spin flex-shrink-0" />
              <div>
                <p className="font-semibold text-white">Analyzing {ids.length} conversations...</p>
                <p className="text-slate-400 font-serif italic text-sm mt-1">Running cross-conversation analysis</p>
              </div>
            </div>
          ) : (
            <div>
              <CompassIcon className="w-7 h-7 mx-auto mb-2 text-cyan-400" />
              <p className="font-semibold text-white">Run Group Analysis</p>
              <p className="text-slate-400 font-serif italic text-sm mt-1">Find patterns across {ids.length} conversations</p>
            </div>
          )}
        </button>
      )}

      {/* Analysis results */}
      {sections.length > 0 && (
        <section className="mb-8" aria-label="Cross-conversation analysis results">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
            <h2 className="font-bold text-white flex items-center gap-2 flex-wrap">
              <CompassIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
              Cross-Conversation Analysis
              <span className="font-mono text-xs bg-cyan-900/50 text-cyan-200 px-2 py-0.5 rounded-full font-normal">saved</span>
            </h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleExportObsidian}
                aria-label="Export group analysis to Obsidian vault"
                className={`${BUTTON_SECONDARY} whitespace-nowrap`}
              >
                <span key={exported ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                  {exported ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5" />
                      Saved
                    </>
                  ) : (
                    <>
                      <ExternalLinkIcon className="w-3.5 h-3.5" />
                      Send to Obsidian
                    </>
                  )}
                </span>
              </button>
              <button
                onClick={handleDownloadGroup}
                aria-label="Download group analysis as markdown file"
                className={`${BUTTON_SECONDARY} whitespace-nowrap`}
              >
                <DownloadIcon className="w-3.5 h-3.5" />
                Download .md
              </button>
              <button
                onClick={() => setShowRerunConfirm(true)}
                disabled={analyzing}
                aria-label="Re-run group analysis"
                className="text-slate-400 hover:text-cyan-400 disabled:opacity-50 transition-colors p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <RefreshIcon className={`w-4 h-4 ${analyzing ? "animate-spin" : ""}`} />
              </button>
            </div>
          </div>
          <div className="stagger-in space-y-6">
            {sections.map((section) => (
              <div key={section.title} className="card p-6">
                <div className="analysis-section">
                  <h3 className="flex items-center gap-2">
                    <section.icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
                    {section.title}
                  </h3>
                  <p className="text-xs text-slate-400 font-serif italic mb-3">{section.subtitle}</p>
                  <Prose text={section.content} className="text-sm leading-relaxed" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Custom group analysis */}
      <section className="mb-8" aria-label="Custom group analysis">
        <button
          onClick={() => setShowCustom(!showCustom)}
          aria-expanded={showCustom}
          aria-controls="custom-group-panel"
          className="w-full card p-5 text-left hover:border-amber-500/50 transition-colors cursor-pointer flex items-center justify-between min-h-[44px]"
        >
          <div className="flex items-center gap-3">
            <CogIcon className="w-5 h-5 text-slate-400 flex-shrink-0" />
            <div>
              <p className="font-semibold text-white">Custom Group Analysis</p>
              <p className="text-slate-400 font-serif italic text-sm">Ask a question across all selected conversations</p>
            </div>
          </div>
          <svg className={`w-5 h-5 text-slate-400 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${showCustom ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {showCustom && (
          <div id="custom-group-panel" className="enter-rise card mt-2 p-6 border-amber-500/30">
            <label className="block mb-3">
              <span className="text-sm font-medium text-slate-300 mb-2 block">What do you want to explore across these conversations?</span>
              <textarea
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="e.g., How do different speakers frame land ownership? What shared assumptions about 'the good life' emerge?"
                aria-label="Custom group analysis question"
                maxLength={2000}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-400 focus:border-amber-500 focus:outline-none resize-none"
                rows={3}
              />
              <div className="text-xs text-slate-400 text-right mt-1">{customPrompt.length}/2000</div>
            </label>
            <div className="flex flex-wrap gap-2 mb-3" role="group" aria-label="Quick prompt suggestions">
              {[
                "How do speakers frame land ownership differently?",
                "What shared assumptions about 'the good life' emerge?",
                "Where does resistance to outside authority appear?",
                "What role does family legacy play across conversations?",
              ].map((p) => (
                <button
                  key={p}
                  onClick={() => setCustomPrompt(p)}
                  aria-label={`Use prompt: ${p}`}
                  className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white px-3 py-2 min-h-[44px] rounded-md transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={runCustom}
              disabled={customAnalyzing || !customPrompt.trim()}
              aria-label="Run custom group analysis"
              className={`${BUTTON_PRIMARY} px-5`}
            >
              {customAnalyzing ? (
                <span className="flex items-center gap-2">
                  <LoaderIcon className="w-4 h-4 animate-spin" />
                  Analyzing...
                </span>
              ) : (
                "Run Custom Group Analysis"
              )}
            </button>
          </div>
        )}

        {customResult && (
          <div className="enter-rise card mt-2 p-6 border-amber-500/30">
            <div className="analysis-section" style={{ background: "var(--custom-analysis-bg, rgba(245, 158, 11, 0.06))" }}>
              <h3 className="flex items-center gap-2" style={{ color: "var(--custom-analysis-text)" }}>
                <CogIcon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
                Custom Group Analysis
              </h3>
              <p className="text-xs text-slate-400 font-serif italic mb-1">Prompt: &ldquo;{customPrompt}&rdquo;</p>
              <Prose text={customResult} className="text-sm leading-relaxed mt-3" />
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default function GroupAnalysisPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto px-4 py-8" role="status" aria-label="Loading">
          <div className="space-y-4">
            <div className="skeleton h-8 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-32 w-full" />
          </div>
        </div>
      }
    >
      <GroupAnalysisContent />
    </Suspense>
  );
}
