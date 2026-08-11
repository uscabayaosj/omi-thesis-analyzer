"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format";
import type { AdhdAnalysis, Rollup } from "@/lib/adhd";
import {
  getAdhdAnalysis, saveAdhdAnalysis, getRollup, saveRollup, getPreviousRollup,
} from "@/lib/adhd-storage";
import { exportRollupToObsidian, downloadRollupMarkdown } from "@/lib/obsidian";
import {
  ArrowLeftIcon, CalendarIcon, WarningIcon, LoaderIcon, RefreshIcon,
  ExternalLinkIcon, DownloadIcon, CheckIcon,
} from "@/components/icons";

interface ConvoLite {
  id: string;
  created_at: string;
  structured?: { title?: string };
}

function dayOf(iso: string): string {
  return iso.length >= 10 ? iso.split("T")[0] : "unknown-date";
}

const ROLLUP_SECTIONS: { key: keyof Rollup; heading: string }[] = [
  { key: "tomorrow_plan", heading: "🌅 Tomorrow's plan" },
  { key: "aging_commitments", heading: "⏳ Aging commitments" },
  { key: "conflicts_at_risk", heading: "⚠️ Conflicts & at-risk" },
  { key: "social_ledger", heading: "👥 Social ledger" },
  { key: "tomorrow_events", heading: "📅 Tomorrow's events" },
  { key: "today_paragraph", heading: "🧠 Today in one paragraph" },
  { key: "dropped", heading: "🗑 Dropped" },
];

export default function RollupPage() {
  const [convos, setConvos] = useState<ConvoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [exported, setExported] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchJson<ConvoLite[]>("/api/conversations");
        setConvos(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to reach Omi");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Group conversations by calendar day, newest day first.
  const days = Array.from(
    convos.reduce((m, c) => {
      const d = dayOf(c.created_at);
      (m.get(d) ?? m.set(d, []).get(d)!).push(c);
      return m;
    }, new Map<string, ConvoLite[]>())
  ).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const selectDay = useCallback((day: string) => {
    setSelectedDay(day);
    setProgress({ done: 0, total: 0 });
    const existing = getRollup(day);
    setRollup(existing ? existing.rollup : null);
  }, []);

  const generate = useCallback(async (dayConvos: ConvoLite[], day: string) => {
    setRunning(true);
    setError(null);
    try {
      // 1. Ensure each conversation has an ADHD analysis.
      const outputs: { title: string; date: string; analysis: AdhdAnalysis }[] = [];
      const total = dayConvos.length;
      setProgress({ done: 0, total });
      for (let i = 0; i < dayConvos.length; i++) {
        const c = dayConvos[i];
        let stored = getAdhdAnalysis(c.id);
        if (!stored) {
          const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: { structured?: { title?: string }; created_at?: string } }>(
            "/api/analyze-adhd",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ conversationId: c.id }),
            }
          );
          stored = saveAdhdAnalysis({
            conversationId: c.id,
            title: data.conversation?.structured?.title || c.structured?.title || "Untitled",
            date: data.conversation?.created_at || c.created_at,
            analysis: data.analysis,
          });
        }
        outputs.push({
          title: stored.title,
          date: stored.date || c.created_at,
          analysis: stored.analysis,
        });
        setProgress({ done: i + 1, total });
      }

      // 2. Roll up, chaining to the prior day's rollup.
      const prev = getPreviousRollup(day);
      const data = await fetchJson<{ rollup: Rollup }>("/api/rollup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          day,
          conversations: outputs,
          previousRollup: prev?.rollup,
        }),
      });
      saveRollup({ day, conversationIds: dayConvos.map((c) => c.id), rollup: data.rollup });
      setRollup(data.rollup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollup failed");
    } finally {
      setRunning(false);
    }
  }, []);

  const doExport = useCallback(() => {
    if (!selectedDay) return;
    const stored = getRollup(selectedDay);
    if (!stored) return;
    const { uri, uriTooLong } = exportRollupToObsidian(stored);
    if (uriTooLong) downloadRollupMarkdown(stored);
    else window.open(uri, "_blank");
    setExported(true);
    setTimeout(() => setExported(false), 2000);
  }, [selectedDay]);

  const doDownload = useCallback(() => {
    if (!selectedDay) return;
    const stored = getRollup(selectedDay);
    if (stored) downloadRollupMarkdown(stored);
  }, [selectedDay]);

  const selectedConvos = selectedDay ? (days.find((d) => d[0] === selectedDay)?.[1] ?? []) : [];

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2">
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-indigo-400 flex-shrink-0" />
          Daily Rollup
        </h1>
        <p className="text-slate-400 text-sm">
          Pick a day to merge its conversations into one plan for tomorrow. Aging carries across days automatically.
        </p>
      </header>

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          <button onClick={() => setError(null)} className="mt-2 text-sm text-slate-400 hover:text-white min-h-[44px] px-2">Dismiss</button>
        </div>
      )}

      {loading && (
        <div className="space-y-3" role="status" aria-label="Loading days">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-16 w-full" />)}
        </div>
      )}

      {!loading && !selectedDay && (
        <div className="space-y-3" role="list" aria-label="Days with conversations">
          {days.map(([day, list]) => {
            const hasRollup = !!getRollup(day);
            return (
              <button
                key={day}
                onClick={() => selectDay(day)}
                disabled={running}
                role="listitem"
                className="w-full text-left card p-5 hover:border-indigo-500/50 transition-colors min-h-[44px] flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div>
                  <p className="font-semibold text-white">{formatDateTime(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                  <p className="text-slate-400 text-sm mt-1">{list.length} conversation{list.length === 1 ? "" : "s"}</p>
                </div>
                {hasRollup && (
                  <span className="text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded-full">rollup saved</span>
                )}
              </button>
            );
          })}
          {days.length === 0 && (
            <div className="card p-8 text-center">
              <p className="text-slate-400">No conversations to roll up yet.</p>
            </div>
          )}
        </div>
      )}

      {selectedDay && (
        <>
          <button onClick={() => { setSelectedDay(null); setRollup(null); }} disabled={running} className="text-slate-400 hover:text-white text-sm mb-4 inline-flex items-center gap-1.5 min-h-[44px] py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <ArrowLeftIcon className="w-4 h-4" /> All days
          </button>

          <div className="card p-5 mb-6">
            <p className="font-semibold text-white">{formatDateTime(`${selectedDay}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <p className="text-slate-400 text-sm mt-1">{selectedConvos.length} conversation{selectedConvos.length === 1 ? "" : "s"} this day</p>
            <button
              onClick={() => generate(selectedConvos, selectedDay)}
              disabled={running || selectedConvos.length === 0}
              className="mt-4 w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center justify-center gap-2"
            >
              {running ? (
                <>
                  <LoaderIcon className="w-4 h-4 animate-spin" />
                  {progress.total ? `Analyzing ${progress.done}/${progress.total}…` : "Generating…"}
                </>
              ) : rollup ? (
                <><RefreshIcon className="w-4 h-4" /> Regenerate rollup</>
              ) : (
                <><CalendarIcon className="w-4 h-4" /> Generate rollup</>
              )}
            </button>
          </div>

          {rollup && (
            <section aria-label="Daily rollup">
              <div className="flex items-center justify-end gap-2 mb-4">
                <button onClick={doExport} className="text-sm bg-purple-900/40 hover:bg-purple-800/50 text-purple-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
                  {exported ? <><CheckIcon className="w-3.5 h-3.5" /> Saved</> : <><ExternalLinkIcon className="w-3.5 h-3.5" /> Send to Obsidian</>}
                </button>
                <button onClick={doDownload} className="text-sm bg-amber-900/40 hover:bg-amber-800/50 text-amber-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
                  <DownloadIcon className="w-3.5 h-3.5" /> Download .md
                </button>
              </div>
              <div className="space-y-6">
                {ROLLUP_SECTIONS.map(({ key, heading }) => (
                  <div key={key} className="card p-6">
                    <div className="analysis-section">
                      <h3>{heading}</h3>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed mt-3">{rollup[key]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
