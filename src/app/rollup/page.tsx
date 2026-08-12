"use client";

import { useEffect, useState, useCallback, useRef, type ComponentType } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, dayOf } from "@/lib/format";
import type { AdhdAnalysis, Rollup } from "@/lib/adhd";
import type { DayConvoOutput } from "@/lib/rollup";
import {
  getAdhdAnalysis, saveAdhdAnalysis, getRollup, saveRollup, getPreviousRollup,
} from "@/lib/adhd-storage";
import { exportRollupToObsidian, downloadRollupMarkdown } from "@/lib/obsidian";
import {
  ArrowLeftIcon, CalendarIcon, WarningIcon, LoaderIcon, RefreshIcon,
  ExternalLinkIcon, DownloadIcon, CheckIcon, ZapIcon, ClipboardIcon,
  UsersIcon, FileTextIcon, XCircleIcon,
} from "@/components/icons";

interface ConvoLite {
  id: string;
  created_at: string;
  structured?: { title?: string };
}

// Local hour, not UTC — matches how every other timestamp in this app renders.
function timeOfDayLabel(iso: string): string {
  const hour = new Date(iso).getHours();
  if (hour < 5) return "Night";
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  if (hour < 21) return "Evening";
  return "Night";
}

const TIME_OF_DAY_ORDER = ["Morning", "Afternoon", "Evening", "Night"];

// Above this count a flat list stops being scannable at a glance — group by
// time of day instead of asking the user to hold the whole day in view.
const CHUNK_THRESHOLD = 6;

function groupByTimeOfDay(convos: ConvoLite[]): [string, ConvoLite[]][] {
  const map = new Map<string, ConvoLite[]>();
  for (const c of convos) {
    const label = timeOfDayLabel(c.created_at);
    (map.get(label) ?? map.set(label, []).get(label)!).push(c);
  }
  return TIME_OF_DAY_ORDER.filter((label) => map.has(label)).map((label) => [label, map.get(label)!]);
}

const ROLLUP_SECTIONS: { key: keyof Rollup; heading: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "tomorrow_plan", heading: "Tomorrow's plan", icon: ZapIcon },
  { key: "aging_commitments", heading: "Aging commitments", icon: ClipboardIcon },
  { key: "conflicts_at_risk", heading: "Conflicts & at-risk", icon: WarningIcon },
  { key: "social_ledger", heading: "Social ledger", icon: UsersIcon },
  { key: "tomorrow_events", heading: "Tomorrow's events", icon: CalendarIcon },
  { key: "today_paragraph", heading: "Today in one paragraph", icon: FileTextIcon },
  { key: "dropped", heading: "Dropped", icon: XCircleIcon },
];

// A rollup section's model output is a prose string; "None." (or empty) is a
// real empty state and needs to read as one, not as unstyled leftover text.
function RollupSectionBlock({
  icon: Icon, heading, content,
}: {
  icon: ComponentType<{ className?: string }>;
  heading: string;
  content: string;
}) {
  const isEmpty = !content || !content.trim() || content.trim().toLowerCase() === "none.";
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {heading}
        </h3>
        {isEmpty ? (
          <p className="text-sm text-slate-400 mt-3">None.</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm leading-relaxed mt-3">{content}</p>
        )}
      </div>
    </div>
  );
}

function RegenerateConfirmDialog({
  onConfirm, onCancel, dayLabel,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  dayLabel: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);

  // Play a fast exit transition instead of vanishing instantly — the dialog
  // should leave the way it arrived, just quicker, since the decision is
  // already made. Guarded so a second trigger during the exit is a no-op.
  const requestClose = useCallback((action: () => void) => {
    setClosing((already) => {
      if (already) return already;
      setTimeout(action, 100);
      return true;
    });
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose(onCancel);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, requestClose]);

  return (
    <div
      className={`overlay-backdrop fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 ${closing ? "overlay-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Confirm regenerate rollup"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onCancel);
      }}
    >
      <div className={`overlay-panel card p-6 max-w-md w-full border-red-500/30 ${closing ? "overlay-closing" : ""}`}>
        <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <WarningIcon className="w-5 h-5 text-red-400 flex-shrink-0" />
          Replace this day&apos;s rollup?
        </h3>
        <p className="text-sm text-slate-400 mb-4">
          <strong className="text-slate-200">{dayLabel}</strong> already has a saved rollup. Regenerating replaces
          it — rollups keep no version history, so the current one will be gone. If a later day&apos;s rollup
          already chained off this one, it won&apos;t pick up the change unless you regenerate that day too.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelRef}
            onClick={() => requestClose(onCancel)}
            className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-200 px-4 py-2 min-h-[44px] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => requestClose(onConfirm)}
            className="text-sm bg-red-600 hover:bg-red-500 text-white font-medium px-4 py-2 min-h-[44px] rounded-lg transition-colors"
          >
            Replace it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RollupPage() {
  const [convos, setConvos] = useState<ConvoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [exported, setExported] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

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
    setProgress({ done: 0, total: 0, failed: 0 });
    const existing = getRollup(day);
    setRollup(existing ? existing.rollup : null);
  }, []);

  const generate = useCallback(async (dayConvos: ConvoLite[], day: string) => {
    setRunning(true);
    setError(null);

    // 1. Ensure each conversation has an ADHD analysis. A single conversation
    // failing (most commonly: no transcript, which the route 404s on) must not
    // abort the whole day — it's skipped and counted, and the run continues.
    const outputs: DayConvoOutput[] = [];
    const total = dayConvos.length;
    let failed = 0;
    setProgress({ done: 0, total, failed: 0 });
    for (let i = 0; i < dayConvos.length; i++) {
      const c = dayConvos[i];
      try {
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
          doneKeys: stored.doneKeys,
        });
      } catch {
        failed++;
      }
      setProgress({ done: i + 1, total, failed });
    }

    if (outputs.length === 0) {
      setError("None of this day's conversations could be analyzed, so there is nothing to roll up.");
      setRunning(false);
      return;
    }

    // 2. Roll up whatever succeeded, chaining to the prior day's rollup.
    try {
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
              <li key={day} className="list-none">
                <button
                  onClick={() => selectDay(day)}
                  disabled={running}
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
              </li>
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

            <div className="mt-3 space-y-3" role="list" aria-label="Conversations this day">
              {(selectedConvos.length > CHUNK_THRESHOLD
                ? groupByTimeOfDay(selectedConvos)
                : ([[null, selectedConvos]] as [string | null, ConvoLite[]][])
              ).map(([label, group]) => (
                <div key={label ?? "all"}>
                  {label && <p className="text-xs font-semibold text-slate-400 mb-1.5">{label}</p>}
                  <div className="space-y-1.5">
                    {group.map((c) => {
                      const analyzed = !!getAdhdAnalysis(c.id);
                      return (
                        <div key={c.id} role="listitem" className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/60">
                          <span className="text-sm text-slate-300 truncate min-w-0">{c.structured?.title || "Untitled"}</span>
                          {analyzed ? (
                            <span className="text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded-full flex-shrink-0">analyzed</span>
                          ) : (
                            <span className="text-xs bg-slate-800/60 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full flex-shrink-0">not yet</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div
              className={
                selectedConvos.length > CHUNK_THRESHOLD
                  ? "sticky bottom-0 mt-4 pt-3 pb-3 border-t border-slate-700 bg-[#0f172a]"
                  : "mt-4"
              }
            >
              <button
                onClick={() => {
                  if (rollup) setShowRegenConfirm(true);
                  else generate(selectedConvos, selectedDay);
                }}
                disabled={running || selectedConvos.length === 0}
                className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center justify-center gap-2"
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
              {!running && progress.total > 0 && progress.failed > 0 && (
                <p className="text-amber-300/90 text-sm mt-2" role="status">
                  {progress.failed} of {progress.total} could not be analyzed and {progress.failed === 1 ? "was" : "were"} skipped.
                </p>
              )}
            </div>
          </div>

          {showRegenConfirm && (
            <RegenerateConfirmDialog
              dayLabel={formatDateTime(`${selectedDay}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
              onCancel={() => setShowRegenConfirm(false)}
              onConfirm={() => {
                setShowRegenConfirm(false);
                generate(selectedConvos, selectedDay);
              }}
            />
          )}

          {rollup && (
            <section aria-label="Daily rollup">
              <div className="flex items-center justify-end gap-2 mb-4">
                <button onClick={doExport} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
                  <span key={exported ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                    {exported ? <><CheckIcon className="w-3.5 h-3.5" /> Saved</> : <><ExternalLinkIcon className="w-3.5 h-3.5" /> Send to Obsidian</>}
                  </span>
                </button>
                <button onClick={doDownload} className="text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5">
                  <DownloadIcon className="w-3.5 h-3.5" /> Download .md
                </button>
              </div>
              <div className="stagger-in space-y-6">
                {ROLLUP_SECTIONS.map(({ key, heading, icon }) => (
                  <RollupSectionBlock key={key} icon={icon} heading={heading} content={rollup[key]} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
