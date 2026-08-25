"use client";

import { useEffect, useState, useCallback, Suspense, type ComponentType } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, dayOf } from "@/lib/format";
import type { AdhdAnalysis, Rollup } from "@/lib/adhd";
import type { DayConvoOutput } from "@/lib/rollup";
import type { RollupJobState } from "@/lib/rollup-job";
import {
  getAdhdAnalysis, saveAdhdAnalysis, getRollup, saveRollup, getPreviousRollup,
} from "@/lib/adhd-storage";
import { pullAndMerge } from "@/lib/sync";
import { exportRollupToObsidian, downloadRollupMarkdown } from "@/lib/obsidian";
import {
  ArrowLeftIcon, CalendarIcon, WarningIcon, LoaderIcon, RefreshIcon,
  ExternalLinkIcon, DownloadIcon, CheckIcon, ZapIcon, ClipboardIcon,
  UsersIcon, FileTextIcon, XCircleIcon, BellIcon,
} from "@/components/icons";
import { isPushSupported, getPushSubscriptionState, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Prose } from "@/components/Prose";
import { BUTTON_PRIMARY } from "@/lib/ui";

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
  { key: "aging_commitments", heading: "Still open from before", icon: ClipboardIcon },
  { key: "conflicts_at_risk", heading: "Needs a decision", icon: WarningIcon },
  { key: "social_ledger", heading: "People to get back to", icon: UsersIcon },
  { key: "tomorrow_events", heading: "Tomorrow's schedule", icon: CalendarIcon },
  { key: "today_paragraph", heading: "Today in one paragraph", icon: FileTextIcon },
  { key: "dropped", heading: "Let go today", icon: XCircleIcon },
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
          <Prose text={content} className="text-sm leading-relaxed mt-3" />
        )}
      </div>
    </div>
  );
}


function RollupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [convos, setConvos] = useState<ConvoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dayParam = searchParams.get("day");
  const [selectedDay, setSelectedDay] = useState<string | null>(
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null
  );
  const [rollup, setRollup] = useState<Rollup | null>(null);
  const [running, setRunning] = useState(false);
  // Whether the in-flight run is a server-side job (survives closing the
  // tab) or the tab-bound fallback loop (only used when no durable store is
  // configured). Only the fallback needs the close-tab warning below.
  const [viaServer, setViaServer] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [exported, setExported] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- support/permission checks require browser APIs unavailable during SSR, so this can't be a lazy initializer
    setPushSupported(isPushSupported());
    getPushSubscriptionState().then(setPushEnabled).catch(() => setPushEnabled(false));
  }, []);

  const togglePush = async () => {
    setPushBusy(true);
    setPushError(null);
    try {
      if (pushEnabled) {
        await unsubscribeFromPush();
        setPushEnabled(false);
      } else {
        await subscribeToPush();
        setPushEnabled(true);
      }
    } catch (e) {
      setPushError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setPushBusy(false);
    }
  };

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
    setRunning(false);
    setViaServer(false);
    const existing = getRollup(day);
    setRollup(existing ? existing.rollup : null);
  }, []);

  // Mirror the open day into the URL so a reload or PWA relaunch returns to
  // the day being worked on rather than the day picker. `replace`, not `push`:
  // Back should leave the page, not walk back through each day opened.
  // No-ops when the URL already matches, so this can't re-fire itself.
  useEffect(() => {
    const next = selectedDay ? `/rollup?day=${selectedDay}` : "/rollup";
    if (next === window.location.pathname + window.location.search) return;
    router.replace(next, { scroll: false });
  }, [selectedDay, router]);

  // Warn before an accidental close/reload mid-run — but only for the
  // tab-bound fallback loop. A server-side job keeps running after the tab
  // closes, so there's nothing to lose there.
  useEffect(() => {
    if (!running || viaServer) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running, viaServer]);

  // Restore the saved rollup when the page opens straight into a day via ?day=,
  // and pick up a server job left running from an earlier visit (this tab or
  // another device) rather than only noticing it once one is started here.
  useEffect(() => {
    if (!selectedDay) return;
    const existing = getRollup(selectedDay);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is unavailable during SSR, so this can't be a lazy initializer
    setRollup(existing ? existing.rollup : null);

    let cancelled = false;
    (async () => {
      try {
        const { job } = await fetchJson<{ job: RollupJobState | null }>(`/api/rollup/job?day=${selectedDay}`);
        if (cancelled || !job || job.status !== "running") return;
        setProgress({ done: job.done, total: job.total, failed: job.failed });
        setRunning(true);
        setViaServer(true);
      } catch {
        // No durable store, or a transient error — nothing in flight to resume.
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDay]);

  // While a server job is running, poll its status instead of driving the
  // batch from this tab — the job keeps going on the server even if this
  // effect never gets to see it finish (tab closed, phone locked, etc.).
  useEffect(() => {
    if (!running || !viaServer || !selectedDay) return;
    const day = selectedDay;
    let cancelled = false;

    const poll = async () => {
      try {
        const { job } = await fetchJson<{ job: RollupJobState | null }>(`/api/rollup/job?day=${day}`);
        if (cancelled || !job) return;
        setProgress({ done: job.done, total: job.total, failed: job.failed });
        if (job.status === "done") {
          if (job.rollup) setRollup(job.rollup);
          await pullAndMerge(true);
          if (!cancelled) { setRunning(false); setViaServer(false); }
        } else if (job.status === "error") {
          setError(job.error || "Rollup failed.");
          if (!cancelled) { setRunning(false); setViaServer(false); }
        }
      } catch {
        // Transient network hiccup — the job is server-side, so just retry
        // on the next tick instead of giving up on it.
      }
    };

    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [running, viaServer, selectedDay]);

  // Runs the whole batch in this tab: only used when no durable store is
  // configured server-side (so /api/rollup/job can't run anything past this
  // request), i.e. local dev without DATABASE_URL, or a fork without it set.
  const generateLocally = useCallback(async (dayConvos: ConvoLite[], day: string) => {
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

  // Entry point: hand the whole batch to a server-side job so it survives
  // this tab closing, and only fall back to running it here if no durable
  // store is configured to back that job (POST responds 501).
  const generate = useCallback(async (dayConvos: ConvoLite[], day: string) => {
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: dayConvos.length, failed: 0 });

    let res: Response;
    try {
      res = await fetch("/api/rollup/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, conversations: dayConvos }),
      });
    } catch {
      setError("Network error — check your connection and try again.");
      setRunning(false);
      return;
    }

    if (res.status === 501) {
      await generateLocally(dayConvos, day);
      return;
    }

    if (!res.ok) {
      setError(`Rollup job failed to start (error ${res.status}).`);
      setRunning(false);
      return;
    }

    let job: RollupJobState | undefined;
    try {
      ({ job } = (await res.json()) as { job?: RollupJobState });
    } catch {
      // Started successfully (2xx) but the body was unreadable — the polling
      // effect below will still find and follow the job by day, so this
      // isn't fatal, just missing the immediate progress snapshot.
    }
    if (job) setProgress({ done: job.done, total: job.total, failed: job.failed });
    setViaServer(true); // hands control to the polling effect above
  }, [generateLocally]);

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
        <h1 className="font-bold text-white mb-2 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-cyan-400 flex-shrink-0" />
          Daily Rollup
        </h1>
        <p className="text-slate-400 text-sm">
          Pick a day to turn its conversations into one short plan for tomorrow. Anything still open carries over on its own.
        </p>
        {pushSupported ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={togglePush}
              disabled={pushBusy}
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              aria-pressed={pushEnabled}
            >
              <BellIcon className="w-4 h-4 flex-shrink-0" />
              {pushEnabled ? "Reminders on" : "Remind me if I forget today's rollup"}
            </button>
            {pushError && <span className="text-xs text-red-400">{pushError}</span>}
          </div>
        ) : (
          <p className="text-xs text-slate-500 mt-3">
            Push reminders aren&apos;t supported in this browser.
          </p>
        )}
        <Link
          href="/rollup/week"
          className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 -ml-3 mt-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors w-fit"
        >
          <CalendarIcon className="w-4 h-4 flex-shrink-0" />
          This Week
        </Link>
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
        <ul className="space-y-3 list-none" aria-label="Days with conversations">
          {days.map(([day, list]) => {
            const hasRollup = !!getRollup(day);
            return (
              <li key={day}>
                <button
                  onClick={() => selectDay(day)}
                  disabled={running}
                  className="w-full text-left card p-5 hover:border-cyan-500/50 transition-colors min-h-[44px] flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
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
            <li className="card p-8 text-center">
              <p className="text-slate-400">No conversations to roll up yet.</p>
            </li>
          )}
        </ul>
      )}

      {selectedDay && (
        <>
          <button onClick={() => { setSelectedDay(null); setRollup(null); }} disabled={running} className="text-slate-400 hover:text-white text-sm mb-4 inline-flex items-center gap-1.5 min-h-[44px] py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <ArrowLeftIcon className="w-4 h-4" /> All days
          </button>

          <div className="card p-5 mb-6">
            <p className="font-semibold text-white">{formatDateTime(`${selectedDay}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <p className="text-slate-400 text-sm mt-1">{selectedConvos.length} conversation{selectedConvos.length === 1 ? "" : "s"} this day</p>

            {/* One list per time-of-day group rather than a single outer list:
                a role="list" may only own listitems, and the group wrappers in
                between were breaking that ownership for assistive tech. */}
            <div className="mt-3 space-y-3">
              {(selectedConvos.length > CHUNK_THRESHOLD
                ? groupByTimeOfDay(selectedConvos)
                : ([[null, selectedConvos]] as [string | null, ConvoLite[]][])
              ).map(([label, group]) => (
                <div key={label ?? "all"}>
                  {label && <p className="text-xs font-semibold text-slate-400 mb-1.5">{label}</p>}
                  <div className="space-y-1.5" role="list" aria-label={label ? `${label} conversations` : "Conversations this day"}>
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
                  ? "sticky bottom-0 mt-4 pt-3 pb-3 border-t border-slate-700 bg-[var(--card)]"
                  : "mt-4"
              }
            >
              <button
                onClick={() => {
                  if (rollup) setShowRegenConfirm(true);
                  else generate(selectedConvos, selectedDay);
                }}
                disabled={running || selectedConvos.length === 0}
                className={`${BUTTON_PRIMARY} w-full py-2 px-5 inline-flex items-center justify-center gap-2`}
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
            <ConfirmDialog
              title="Replace this day's rollup?"
              tone="danger"
              body={
                <>
                  <strong className="text-slate-200">
                    {formatDateTime(`${selectedDay}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                  </strong>{" "}
                  already has a saved rollup. Regenerating replaces it — rollups keep no version history, so the
                  current one will be gone. If a later day&apos;s rollup already chained off this one, it won&apos;t
                  pick up the change unless you regenerate that day too.
                </>
              }
              confirmLabel="Replace it"
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

// useSearchParams (for the ?day= binding) opts this route into client-side
// rendering, which Next requires a Suspense boundary around.
export default function RollupPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="space-y-3" aria-label="Loading rollup" role="status">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 w-full" />)}
          </div>
        </main>
      }
    >
      <RollupPageInner />
    </Suspense>
  );
}
