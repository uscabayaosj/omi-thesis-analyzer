"use client";

import { useEffect, useState, useCallback, useMemo, useRef, Suspense, type ComponentType } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, dayOf } from "@/lib/format";
import type { AdhdAnalysis, Rollup, RollupPlanStep } from "@/lib/adhd";
import type { DayConvoOutput } from "@/lib/rollup";
import type { RollupJobState } from "@/lib/rollup-job";
import {
  getAdhdAnalysis, saveAdhdAnalysis, getRollup, saveRollup, getPreviousRollup, getRollupDays, togglePlanStepDone,
} from "@/lib/adhd-storage";
import { pullAndMerge } from "@/lib/sync";
import { countOpen } from "@/lib/commitments";
import { exportRollupToObsidian, downloadRollupMarkdown } from "@/lib/obsidian";
import {
  ArrowLeftIcon, CalendarIcon, WarningIcon, LoaderIcon, RefreshIcon,
  ExternalLinkIcon, DownloadIcon, CheckIcon, ZapIcon, ClipboardIcon,
  UsersIcon, FileTextIcon, XCircleIcon, BellIcon, CheckSquareIcon, SquareIcon,
} from "@/components/icons";
import { isPushSupported, getPushSubscriptionState, subscribeToPush, unsubscribeFromPush } from "@/lib/push";
import ConfirmDialog from "@/components/ConfirmDialog";
import PlanChecklist from "@/components/PlanChecklist";
import { Prose } from "@/components/Prose";
import { BUTTON_PRIMARY, BUTTON_GHOST, LINK_BACK, BUTTON_SECONDARY } from "@/lib/ui";

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

const ROLLUP_SECTIONS: { key: Exclude<keyof Rollup, "plan_steps">; heading: string; icon: ComponentType<{ className?: string }> }[] = [
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
  icon: Icon, heading, content, lead = false,
}: {
  icon: ComponentType<{ className?: string }>;
  heading: string;
  content: string;
  /** The day's answer. Rendered on the copper treatment so it does not sit at
   *  the same visual weight as the six supporting sections. */
  lead?: boolean;
}) {
  const isEmpty = !content || !content.trim() || content.trim().toLowerCase() === "none.";
  return (
    <div className={`card p-6${lead ? " border-cyan-500/40" : ""}`}>
      <div className="analysis-section">
        {/* h2, not h3: this is the first heading level under the page h1, and
            jumping straight to h3 left /rollup and /rollup/week with a broken
            outline on the two routes that have the most to skim. */}
        <h2 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {heading}
        </h2>
        {isEmpty ? (
          <p className="text-sm text-slate-400 mt-3">None.</p>
        ) : (
          <Prose text={content} className="text-sm leading-relaxed mt-3" />
        )}
      </div>
    </div>
  );
}


function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

/**
 * A plain-language forecast of what pressing the button will spend.
 *
 * Deliberately a range and deliberately vague about money: the real figure
 * depends on transcript length and is reconciled on /usage afterwards. The
 * point is that the user knows the order of magnitude — one call or twenty —
 * before committing, instead of finding out from the bill.
 */
function estimateRun(total: number, alreadyAnalyzed: number): string {
  const toAnalyze = Math.max(0, total - alreadyAnalyzed);
  const calls = toAnalyze + 1; // per-conversation passes, plus the rollup itself
  const lowMin = Math.max(1, Math.round((calls * 12) / 60));
  const highMin = Math.max(lowMin + 1, Math.round((calls * 30) / 60));
  const reused = alreadyAnalyzed > 0
    ? `${alreadyAnalyzed} already analysed and reused, `
    : "";
  return `${reused}${calls} API call${calls === 1 ? "" : "s"} to run — roughly ${lowMin}–${highMin} min.`;
}

function RollupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [convos, setConvos] = useState<ConvoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dayParam = searchParams.get("day");
  const [selectedDay, setSelectedDay] = useState<string | null>(
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : null
  );
  const [planDone, setPlanDone] = useState<Set<string>>(new Set());
  /* A day-close over 27 conversations is minutes of real time and real money,
     and it used to be uninterruptible with no elapsed indication — the user
     was asked to wait an unknown amount for an unstated cost. `startedAt`
     drives the clock; the abort controller makes Stop actually stop. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const togglePlanStep = useCallback((key: string) => {
    if (!selectedDay) return;
    setPlanDone(new Set(togglePlanStepDone(selectedDay, key)));
  }, [selectedDay]);
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
    setMounted(true);
  }, []);

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

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
  /* The day list used to be built purely from /api/conversations, so when Omi
     was unreachable the page showed an error AND "No conversations to roll up
     yet." — the app claiming nothing was recorded when the truth was that it
     could not ask. Worse, rollups live in localStorage and render perfectly at
     /rollup?day=…, so a saved day-close was present on the device and simply
     had no link. Days that already hold a saved rollup are unioned in, so the
     artifact is always reachable offline; they carry an empty conversation
     list and are labelled accordingly. */
  /* Read from tracked done-state rather than the model's "Still open from
     before" prose, so the closing line agrees with the ledger and the badge. */
  const carriedCount = useMemo(() => (mounted ? countOpen() : 0), [mounted]);

  const days = useMemo(() => {
    const m = new Map<string, ConvoLite[]>();
    for (const c of convos) {
      const d = dayOf(c.created_at);
      (m.get(d) ?? m.set(d, []).get(d)!).push(c);
    }
    if (mounted) {
      for (const d of getRollupDays()) if (!m.has(d)) m.set(d, []);
    }
    return Array.from(m).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [convos, mounted]);

  const selectDay = useCallback((day: string) => {
    setSelectedDay(day);
    setProgress({ done: 0, total: 0, failed: 0 });
    setRunning(false); setStartedAt(null);
    setViaServer(false);
    const existing = getRollup(day);
    setRollup(existing ? existing.rollup : null);
    setPlanDone(new Set(existing?.planDoneKeys ?? []));
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
    setPlanDone(new Set(existing?.planDoneKeys ?? []));

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
          if (job.rollup) {
            setRollup(job.rollup);
            setPlanDone(new Set(getRollup(selectedDay)?.planDoneKeys ?? []));
          }
          await pullAndMerge(true);
          if (!cancelled) { setRunning(false); setStartedAt(null); setViaServer(false); }
        } else if (job.status === "error") {
          setError(job.error || "Rollup failed.");
          if (!cancelled) { setRunning(false); setStartedAt(null); setViaServer(false); }
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
    const controller = new AbortController();
    abortRef.current = controller;

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
              signal: controller.signal,
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
      } catch (e) {
        // Stop is a decision, not a failure: keep every analysis already
        // finished (they cost money and are saved), and leave quietly.
        if (e instanceof DOMException && e.name === "AbortError") return;
        failed++;
      }
      if (controller.signal.aborted) return;
      setProgress({ done: i + 1, total, failed });
    }

    if (outputs.length === 0) {
      setError("None of this day's conversations could be analyzed, so there is nothing to roll up.");
      setRunning(false); setStartedAt(null);
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
      setPlanDone(new Set(getRollup(day)?.planDoneKeys ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rollup failed");
    } finally {
      setRunning(false); setStartedAt(null);
    }
  }, []);

  // Entry point: hand the whole batch to a server-side job so it survives
  // this tab closing, and only fall back to running it here if no durable
  // store is configured to back that job (POST responds 501).
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
    setViaServer(false);
    setStartedAt(null);
  }, []);

  const generate = useCallback(async (dayConvos: ConvoLite[], day: string) => {
    setError(null);
    setRunning(true);
    setStartedAt(Date.now());
    setElapsed(0);
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
      setRunning(false); setStartedAt(null);
      return;
    }

    if (res.status === 501) {
      await generateLocally(dayConvos, day);
      return;
    }

    if (!res.ok) {
      setError(`Rollup job failed to start (error ${res.status}).`);
      setRunning(false); setStartedAt(null);
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
  // Conversations already analysed are reused rather than re-billed, so the
  // forecast has to net them off or it overstates the cost every time.
  const analyzedCount = mounted ? selectedConvos.filter((c) => getAdhdAnalysis(c.id)).length : 0;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
          Planning
        </p>
        <h1 className="font-bold text-white mb-2 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-cyan-400 flex-shrink-0" />
          Daily Rollup
        </h1>
        <p className="text-slate-400 font-serif italic text-[0.95rem]">
          Pick a day to turn its conversations into one short plan for tomorrow. Anything still open carries over on its own.
        </p>
        {pushSupported ? (
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={togglePush}
              disabled={pushBusy}
              className={BUTTON_GHOST}
              aria-pressed={pushEnabled}
            >
              <BellIcon className="w-4 h-4 flex-shrink-0" />
              {pushEnabled ? "Reminders on" : "Remind me if I forget today's rollup"}
            </button>
            {pushError && <span role="alert" className="text-xs text-red-400">{pushError}</span>}
          </div>
        ) : (
          <p className="text-xs text-slate-400 mt-3">
            Push reminders aren&apos;t supported in this browser.
          </p>
        )}
        <Link
          href="/rollup/week"
          className={`${BUTTON_GHOST} -ml-3 mt-1 w-fit`}
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
                    <p className="font-serif font-semibold text-white">{formatDateTime(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
                    <p className="text-slate-400 font-mono text-sm mt-1">
                      {list.length === 0
                        ? "saved on this device"
                        : `${list.length} conversation${list.length === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  {hasRollup && (
                    <span className="font-mono text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded-full">rollup saved</span>
                  )}
                </button>
              </li>
            );
          })}
          {days.length === 0 && (
            <li className="card p-8 text-center">
              <p className="text-slate-400">
                {error
                  ? "Couldn’t reach Omi, and no rollups are saved on this device yet."
                  : "No conversations to roll up yet."}
              </p>
            </li>
          )}
        </ul>
      )}

      {selectedDay && (
        <>
          <button onClick={() => { setSelectedDay(null); setRollup(null); }} disabled={running} className="text-slate-400 hover:text-white text-sm mb-4 inline-flex items-center gap-1.5 min-h-[44px] py-2 disabled:opacity-50 disabled:cursor-not-allowed">
            <ArrowLeftIcon className="w-4 h-4" /> All days
          </button>

          {rollup && (
            <div className="mb-6">
              {rollup.plan_steps?.length ? (
                <PlanChecklist
                  steps={rollup.plan_steps}
                  done={planDone}
                  onToggle={togglePlanStep}
                />
              ) : (
                <RollupSectionBlock
                  icon={ROLLUP_SECTIONS[0].icon}
                  heading={ROLLUP_SECTIONS[0].heading}
                  content={rollup[ROLLUP_SECTIONS[0].key]}
                  lead
                />
              )}
            </div>
          )}

          <div className="card p-5 mb-6">
            <p className="font-serif font-semibold text-white">{formatDateTime(`${selectedDay}T12:00:00`, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
            <p className="text-slate-400 font-mono text-sm mt-1">
              {selectedConvos.length === 0
                ? "Saved rollup — source conversations unavailable offline"
                : `${selectedConvos.length} conversation${selectedConvos.length === 1 ? "" : "s"} this day`}
            </p>

            {/* One list per time-of-day group rather than a single outer list:
                a role="list" may only own listitems, and the group wrappers in
                between were breaking that ownership for assistive tech. */}
            <div className="mt-3 space-y-3">
              {(selectedConvos.length > CHUNK_THRESHOLD
                ? groupByTimeOfDay(selectedConvos)
                : ([[null, selectedConvos]] as [string | null, ConvoLite[]][])
              ).map(([label, group]) => (
                <div key={label ?? "all"}>
                  {label && <p className="font-mono text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{label}</p>}
                  <div className="space-y-1.5" role="list" aria-label={label ? `${label} conversations` : "Conversations this day"}>
                    {group.map((c) => {
                      const analyzed = !!getAdhdAnalysis(c.id);
                      return (
                        <div key={c.id} role="listitem" className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/60">
                          <span className="font-serif text-sm text-slate-300 truncate min-w-0">{c.structured?.title || "Untitled"}</span>
                          {analyzed ? (
                            <span className="font-mono text-xs bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 px-2 py-0.5 rounded-full flex-shrink-0">analyzed</span>
                          ) : (
                            <span className="font-mono text-xs bg-slate-800/60 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-full flex-shrink-0">not yet</span>
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
                    {elapsed > 0 && <span className="font-mono text-xs opacity-80">{fmtElapsed(elapsed)}</span>}
                  </>
                ) : rollup ? (
                  <><RefreshIcon className="w-4 h-4" /> Regenerate rollup</>
                ) : (
                  <><CalendarIcon className="w-4 h-4" /> Generate rollup</>
                )}
              </button>
              {running && (
                <button
                  onClick={stop}
                  className="mt-2 w-full bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors"
                >
                  Stop — keep what has finished
                </button>
              )}
              {/* An analysis costs real money and real minutes, and until now
                  neither was stated anywhere before the button was pressed —
                  only reconciled afterwards on /usage. */}
              {!running && selectedConvos.length > 0 && (
                <p className="text-xs text-slate-400 mt-2 font-mono">
                  {estimateRun(selectedConvos.length, analyzedCount)}
                </p>
              )}
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
                <button onClick={doExport} className={BUTTON_SECONDARY}>
                  <span key={exported ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                    {exported ? <><CheckIcon className="w-3.5 h-3.5" /> Saved</> : <><ExternalLinkIcon className="w-3.5 h-3.5" /> Send to Obsidian</>}
                  </span>
                </button>
                <button onClick={doDownload} className={BUTTON_SECONDARY}>
                  <DownloadIcon className="w-3.5 h-3.5" /> Download .md
                </button>
              </div>
              {/* The seven sections used to render as one flat stack of
                  identical cards, so "Tomorrow's plan" and "Let go today" had
                  exactly equal visual claim and the plan's first line sat below
                  the fold on a phone. The plan is the answer this page exists
                  to give: it leads, on the copper treatment, and the remaining
                  six sit behind one disclosure. */}
              <div className="stagger-in space-y-6">
                <details className="card p-0 overflow-hidden" open={restOpen} onToggle={(e) => setRestOpen((e.target as HTMLDetailsElement).open)}>
                  <summary className="cursor-pointer list-none px-6 py-4 min-h-[44px] flex items-center justify-between gap-3 text-slate-200 hover:bg-slate-800/40 transition-colors">
                    <span className="font-serif font-semibold">The rest of the day</span>
                    <span className="font-mono text-xs text-slate-400">
                      {restOpen ? "Hide" : `${ROLLUP_SECTIONS.length - 1} sections`}
                    </span>
                  </summary>
                  <div className="px-2 pb-2 space-y-4">
                    {ROLLUP_SECTIONS.slice(1).map(({ key, heading, icon }) => (
                      <RollupSectionBlock key={key} icon={icon} heading={heading} content={rollup[key]} />
                    ))}
                  </div>
                </details>

                {/* Peak-end: the ritual used to finish on "Let go today" —
                    the last thing a day-close said was what got dropped —
                    followed by a dev version footer. It ends on completion
                    now, and on the one number that carries into tomorrow. */}
                <div className="card p-5 border-cyan-500/30 text-center">
                  <p className="font-serif text-slate-200">Day closed.</p>
                  <p className="text-sm text-slate-400 mt-1">
                    {carriedCount === 0
                      ? "Nothing outstanding carries into tomorrow."
                      : <>
                          <Link href="/commitments" className="text-cyan-400 hover:underline">
                            {carriedCount} promise{carriedCount === 1 ? "" : "s"}
                          </Link>{" "}
                          carried into tomorrow.
                        </>}
                  </p>
                </div>
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
