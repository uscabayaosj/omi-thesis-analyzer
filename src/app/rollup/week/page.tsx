"use client";

import { useEffect, useMemo, useState, Suspense, type ComponentType } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, mondayOf, addDays } from "@/lib/format";
import {
  getRollup, getWeeklyRollup, saveWeeklyRollup, type StoredWeeklyRollup,
} from "@/lib/adhd-storage";
import { pullAndMerge } from "@/lib/sync";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { WeeklyRollup } from "@/lib/weekly-rollup";
import {
  ArrowLeftIcon, CalendarIcon, FileTextIcon, TrendingUpIcon, WarningIcon,
  XCircleIcon, UsersIcon, ZapIcon, ChevronRightIcon, LoaderIcon,
} from "@/components/icons";
import { Prose } from "@/components/Prose";
import { BUTTON_PRIMARY, BUTTON_GHOST, LINK_BACK } from "@/lib/ui";

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const WEEKLY_SECTIONS: { key: keyof WeeklyRollup; heading: string; icon: ComponentType<{ className?: string }> }[] = [
  { key: "week_summary", heading: "This week", icon: FileTextIcon },
  { key: "completion_pattern", heading: "What got done", icon: TrendingUpIcon },
  { key: "chronically_aging", heading: "Still stuck", icon: WarningIcon },
  { key: "dropped_this_week", heading: "Let go this week", icon: XCircleIcon },
  { key: "social_pattern", heading: "People", icon: UsersIcon },
  { key: "next_week_setup", heading: "Setting up next week", icon: ZapIcon },
];

function WeeklySectionBlock({
  icon: Icon, heading, content,
}: {
  icon: ComponentType<{ className?: string }>;
  heading: string;
  content: string;
}) {
  const isEmpty = !content || !content.trim() || /^(none|nothing specific)\.?$/i.test(content.trim());
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

function WeekPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const startParam = searchParams.get("start");

  const weekStart = startParam && /^\d{4}-\d{2}-\d{2}$/.test(startParam)
    ? mondayOf(startParam)
    : mondayOf(new Date().toISOString().slice(0, 10));

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  const [stored, setStored] = useState<StoredWeeklyRollup | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState(0);
  // `dayRollups` below derives from localStorage, which the server cannot see.
  // Deriving it during the first client render made that render disagree with
  // the server's HTML ("No daily rollups yet this week" vs "1 of 7 days have a
  // rollup ready"), which React reports as a hydration failure and recovers
  // from by throwing away the server tree. Holding the first client render to
  // the server's view and filling in after mount keeps the two in agreement.
  const [mounted, setMounted] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored(getWeeklyRollup(weekStart));
    setError(null);
    pullAndMerge().then((changed) => {
      if (!changed) return;
      setStored(getWeeklyRollup(weekStart));
      setDataVersion((v) => v + 1);
    });
  }, [weekStart]);

  const dayRollups = useMemo(
    () => !mounted
      ? []
      : days
        .map((day) => ({ day, stored: getRollup(day) }))
        .filter((d): d is { day: string; stored: NonNullable<ReturnType<typeof getRollup>> } => d.stored !== null),
    // dataVersion is intentionally included so a completed pullAndMerge re-derives this from localStorage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, dataVersion, mounted]
  );

  const daysWithRollup = useMemo(() => new Set(dayRollups.map((d) => d.day)), [dayRollups]);

  const generate = async () => {
    if (dayRollups.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      const data = await fetchJson<{ rollup: WeeklyRollup }>("/api/rollup/weekly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart,
          dailyRollups: dayRollups.map((d) => ({ day: d.day, rollup: d.stored.rollup })),
        }),
      });
      const saved = saveWeeklyRollup({ weekStart, dayCount: dayRollups.length, rollup: data.rollup });
      setStored(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Weekly rollup failed.");
    } finally {
      setGenerating(false);
    }
  };

  const goToWeek = (newStart: string) => {
    router.push(`/rollup/week?start=${newStart}`);
  };

  const weekEnd = addDays(weekStart, 6);
  const weekStartLabel = formatDateTime(
    `${weekStart}T12:00:00`,
    weekStart.slice(0, 4) !== weekEnd.slice(0, 4)
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "numeric", month: "long" }
  );
  const weekEndLabel = formatDateTime(`${weekEnd}T12:00:00`, { day: "numeric", month: "long", year: "numeric" });
  const weekLabel = `${weekStartLabel} – ${weekEndLabel}`;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/rollup" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to Daily Rollup
      </Link>

      <header className="mb-6">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
          Planning
        </p>
        <h1 className="font-bold text-white mb-2 flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-cyan-400 flex-shrink-0" />
          This Week
        </h1>
        <p className="text-slate-400 font-mono text-sm">{weekLabel}</p>
      </header>

      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => goToWeek(addDays(weekStart, -7))}
          className={BUTTON_GHOST}
        >
          <ArrowLeftIcon className="w-4 h-4" />
          Previous week
        </button>
        <button
          onClick={() => goToWeek(addDays(weekStart, 7))}
          className={BUTTON_GHOST}
        >
          Next week
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-2 mb-6" aria-label="Days this week">
        {days.map((day, i) => {
          const hasRollup = daysWithRollup.has(day);
          return (
            <div
              key={day}
              className={`flex-1 text-center py-2 rounded-lg text-xs ${
                // Detector cross-pairs the branches; real pairs are emerald-400
                // on the emerald wash and slate-400 on slate-900. slate-400,
                // not slate-500: the Two Greys Rule bars slate-500 from text.
                hasRollup ? "bg-emerald-500/15 border border-emerald-500/40 text-emerald-400" : "bg-slate-900 border border-slate-800 text-slate-400" // impeccable-disable-line gray-on-color
              }`}
            >
              {WEEKDAY_LABELS[i]}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          <button onClick={() => setError(null)} className="mt-2 text-sm text-slate-400 hover:text-white min-h-[44px] px-2">Dismiss</button>
        </div>
      )}

      {!stored && (
        <div className="card p-8 text-center">
          <p className="text-slate-400 font-serif italic mb-4">
            {dayRollups.length === 0
              ? "No daily rollups yet this week — run at least one from Daily Rollup first."
              : `${dayRollups.length} of 7 days have a rollup ready to synthesize.`}
          </p>
          <button
            onClick={generate}
            disabled={generating || dayRollups.length === 0}
            className={`${BUTTON_PRIMARY} py-2.5 px-6 inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {generating ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <CalendarIcon className="w-4 h-4" />}
            {generating ? "Generating…" : "Generate weekly rollup"}
          </button>
        </div>
      )}

      {showRegenConfirm && (
        <ConfirmDialog
          title="Replace this week's rollup?"
          tone="danger"
          body={
            <>
              This week already has a saved rollup. Regenerating replaces it — weekly rollups keep no
              version history, so the current one will be gone.
            </>
          }
          confirmLabel="Replace it"
          onCancel={() => setShowRegenConfirm(false)}
          onConfirm={() => {
            setShowRegenConfirm(false);
            generate();
          }}
        />
      )}

      {stored && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs text-slate-400">
              Synthesized from {stored.dayCount} of 7 days
            </p>
            <button
              onClick={() => setShowRegenConfirm(true)}
              disabled={generating || dayRollups.length === 0}
              className="text-sm text-slate-400 hover:text-white min-h-[44px] px-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generating ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
          {WEEKLY_SECTIONS.map((s) => (
            <WeeklySectionBlock key={s.key} icon={s.icon} heading={s.heading} content={stored.rollup[s.key]} />
          ))}
        </div>
      )}
    </main>
  );
}

// useSearchParams (for the ?start= binding) opts this route into client-side
// rendering, which Next requires a Suspense boundary around — matching the
// pattern used by src/app/rollup/page.tsx.
export default function WeekPage() {
  return (
    <Suspense
      fallback={
        <main className="max-w-3xl mx-auto px-4 py-8">
          <div className="space-y-3" aria-label="Loading weekly rollup" role="status">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-20 w-full" />)}
          </div>
        </main>
      }
    >
      <WeekPageInner />
    </Suspense>
  );
}
