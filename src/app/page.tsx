"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getAnalyzedIds, getAnalysisAge } from "@/lib/storage";
import { getAdhdAnalyzedIds, saveAdhdAnalysis } from "@/lib/adhd-storage";
import type { AdhdAnalysis } from "@/lib/adhd";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, dayOf } from "@/lib/format";
import {
  TraceMark, SquareIcon, XIcon, CheckIcon, SparklesIcon, WarningIcon, MicIcon,
  FolderIcon, RefreshIcon, ClipboardIcon, CalendarIcon, ChevronRightIcon, SearchIcon,
} from "@/components/icons";

const CONVERSATIONS_CACHE_KEY = "conversations";

// Shared by every button in the selection toolbar (Group Thesis, Run ADHD):
// these are parallel choices acting on the same selection, not a primary/
// secondary pair, so both get the identical class string rather than one
// claiming the app's solid-fill cyan "one primary action" treatment.
// Three tiers, not two: flat slate with no selection; a cyan-tinted
// "ready" wash (reusing the same wash ConversationRow uses for a selected
// item) as soon as *any* conversation is selected, on both buttons at once
// — even though Group Thesis's own minimum is 2, not 1, that's a business
// rule enforced inside startGroupAnalysis's own guard clause, not something
// the resting button color should announce; and a solid-fill "full cyan"
// flash on :active, so the moment of an actual tap still reads distinctly
// from just having a selection ready.
// disabled:bg-slate-700, not slate-800: this toolbar is itself a .card
// (Ink Panel, #1e293b === bg-slate-800), so slate-800 here would repeat the
// exact "invisible against its own container" bug the Secondary Button rule
// exists to prevent (see DESIGN.md's Buttons section).
// Detector waiver below: it pairs the disabled/active slate values with the
// cyan tints in the same string. Real pairs, all measured — cyan-200 on the
// cyan-950/40 wash 12.20:1, slate-950 on the active cyan-400 fill 11.16:1,
// and slate-400 on the disabled slate-700 fill 4.04:1 (disabled controls are
// exempt from 1.4.3, and this matches the app's existing disabled treatment).
const TOOLBAR_ACTION_CLASS =
  "flex items-center gap-1.5 rounded-lg border border-cyan-500/50 bg-cyan-950/40 px-4 py-2 min-h-[44px] text-sm font-medium text-cyan-200 transition-colors hover:border-cyan-500/70 hover:bg-cyan-950/60 hover:text-cyan-100 active:border-cyan-400 active:bg-cyan-400 active:text-slate-950 disabled:border-transparent disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed whitespace-nowrap"; // impeccable-disable-line gray-on-color

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

function LensBadges({ thesis, adhd }: { thesis: boolean; adhd: boolean }) {
  const pill = (on: boolean, label: string) => (
    <span
      title={`${label}: ${on ? "analyzed" : "not analyzed"}`}
      className={`min-w-[46px] px-1.5 py-0.5 rounded-full border text-[10px] font-semibold leading-none whitespace-nowrap text-center ${
        // False positive below: the scanner pairs the "off" branch's text-slate-400 with the "on"
        // branch's bg-emerald-500 since both live in one ternary string. Real pairs, both verified:
        // emerald-400/emerald-wash (5.93:1) and slate-400/slate-800 (5.71:1).
        on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" : "bg-slate-800/60 border-slate-700 text-slate-400" // impeccable-disable-line gray-on-color
      }`}
    >
      {label}
    </span>
  );
  return (
    <div className="mt-0.5 flex-shrink-0 flex flex-col gap-1" aria-hidden="true">
      {pill(thesis, "Thesis")}
      {pill(adhd, "ADHD")}
    </div>
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Month-grid calendar: the primary "browse by day" entry point. Monday-first
// (matches the app's en-GB date formatting elsewhere). Solid cyan fill for
// the selected day reuses the same "true single-select navigation" pattern
// the filter pills already use — see DESIGN.md's Navigation section.
function CalendarMonth({
  year, month, todayStr, selectedDate, daysWithEntries, onSelectDay, onPrevMonth, onNextMonth, onToday, onJumpToMonth, onCollapse,
}: {
  year: number;
  month: number; // 0-indexed
  todayStr: string;
  selectedDate: string;
  daysWithEntries: Set<string>;
  onSelectDay: (day: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onToday: () => void;
  onJumpToMonth: (year: number, month: number) => void;
  onCollapse: () => void;
}) {
  const monthLabel = new Date(year, month, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day: number; dayStr: string } | null> = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ day, dayStr: `${year}-${pad2(month + 1)}-${pad2(day)}` });
  }

  return (
    <div className="enter-rise card p-4">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={onPrevMonth}
          aria-label="Previous month"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white transition-colors flex-shrink-0"
        >
          <ChevronRightIcon className="w-4 h-4 rotate-180" />
        </button>
        <div className="flex items-center gap-3">
          {/* min-h-[44px] so the overlaid month input below gets a full-size tap
              target: globals.css's coarse-pointer 44px floor covers buttons and
              links, but not inputs, so this one has to carry its own. */}
          <div className="relative flex items-center min-h-[44px]">
            <p className="font-semibold text-white text-sm whitespace-nowrap pr-1">{monthLabel}</p>
            {/* Native month picker overlaid on the label — jumps distant months without
                hand-building a year selector; iOS/desktop Safari and Chrome render this as
                a real wheel/dropdown picker. Firefox lacks support and falls back to a plain
                text input, a graceful (not blocking) degradation. */}
            <input
              type="month"
              value={`${year}-${pad2(month + 1)}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                if (y && m) onJumpToMonth(y, m - 1);
              }}
              aria-label="Jump to a different month"
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </div>
          <button
            onClick={onToday}
            className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors px-2 min-h-[32px] rounded-md hover:bg-slate-700 whitespace-nowrap"
          >
            Today
          </button>
        </div>
        <button
          onClick={onNextMonth}
          aria-label="Next month"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white transition-colors flex-shrink-0"
        >
          <ChevronRightIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-slate-400" aria-hidden="true">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label="Pick a day">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} aria-hidden="true" />;
          const { day, dayStr } = cell;
          const isToday = dayStr === todayStr;
          const isSelected = dayStr === selectedDate;
          const hasEntries = daysWithEntries.has(dayStr);
          const isFuture = dayStr > todayStr;
          return (
            <button
              key={dayStr}
              onClick={() => onSelectDay(dayStr)}
              aria-label={`${new Date(year, month, day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${isToday ? ", today" : ""}${hasEntries ? ", has conversations" : ""}`}
              aria-pressed={isSelected}
              className={`aspect-square min-h-[40px] rounded-md flex flex-col items-center justify-center gap-0.5 text-sm transition-colors ${
                isSelected
                  // slate-950 is near-black (#020617), not washed-out gray: it
                  // clears 11.16:1 on cyan-400. Detector cross-pairs the other
                  // mutually-exclusive branches' slate text with this fill.
                  ? "bg-cyan-400 text-slate-950 font-semibold" // impeccable-disable-line gray-on-color
                  : isToday
                  ? "border border-cyan-500/60 text-white hover:bg-slate-700"
                  : isFuture
                  ? "text-slate-400 hover:bg-slate-700"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
            >
              {day}
              <span
                className={`w-1 h-1 rounded-full ${hasEntries ? (isSelected ? "bg-white" : "bg-slate-500") : "bg-transparent"}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
      <button
        onClick={onCollapse}
        className="text-cyan-400 text-sm hover:underline mt-3 min-h-[44px] px-1"
      >
        Collapse
      </button>
    </div>
  );
}

function ConversationRow({
  convo, selectMode, isSelected, isAnalyzed, isAnalyzedEither, isAdhd, onToggleSelect,
}: {
  convo: Conversation;
  selectMode: boolean;
  isSelected: boolean;
  isAnalyzed: boolean;
  isAnalyzedEither: boolean;
  isAdhd: boolean;
  onToggleSelect: (id: string) => void;
}) {
  if (selectMode) {
    return (
      <button
        onClick={() => onToggleSelect(convo.id)}
        role="option"
        aria-selected={isSelected}
        aria-label={`${isSelected ? "Deselect" : "Select"} "${convo.structured?.title || "Untitled"}" for group analysis${isAnalyzedEither ? " (analyzed)" : ""}`}
        className={`w-full text-left card p-5 transition-colors min-h-[44px] ${
          isSelected ? "border-cyan-500 bg-cyan-950/30" : "hover:border-slate-600"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`w-5 h-5 mt-1 flex-shrink-0 rounded border-2 flex items-center justify-center transition-colors ${
              isSelected ? "bg-cyan-400 border-cyan-400" : "border-slate-600"
            }`}
            aria-hidden="true"
          >
            {isSelected && <CheckIcon className="w-3 h-3 text-white" />}
          </div>
          <LensBadges thesis={isAnalyzed} adhd={isAdhd} />
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-white truncate">
              {convo.structured?.title || "Untitled"}
            </h2>
            {convo.structured?.overview && (
              <p className="text-slate-400 text-sm mt-1 line-clamp-1">{convo.structured.overview}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 flex-wrap">
              <span className="whitespace-nowrap">{formatDateTime(convo.created_at)}</span>
              {convo.structured?.category && (
                <span className="bg-slate-800 px-2 py-0.5 rounded-full whitespace-nowrap">{convo.structured.category}</span>
              )}
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <Link
      href={`/conversation/${convo.id}`}
      aria-label={`${convo.structured?.title || "Untitled conversation"}${isAnalyzedEither ? " (analyzed)" : ""}`}
      className={`card p-5 block transition-colors min-h-[44px] ${
        isAnalyzedEither ? "hover:border-emerald-500/50" : "hover:border-cyan-500/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <LensBadges thesis={isAnalyzed} adhd={isAdhd} />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-white truncate">
            {convo.structured?.title || "Untitled"}
          </h2>
          {convo.structured?.overview && (
            <p className="text-slate-400 text-sm mt-1 line-clamp-2">{convo.structured.overview}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 flex-wrap">
            <span className="whitespace-nowrap">{formatDateTime(convo.created_at)}</span>
            {convo.structured?.category && (
              <span className="bg-slate-800 px-2 py-0.5 rounded-full whitespace-nowrap">{convo.structured.category}</span>
            )}
            {convo.folder_name && (
              <span className="flex items-center gap-1 bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                <FolderIcon className="w-3 h-3" />
                {convo.folder_name}
              </span>
            )}
          </div>
        </div>
        <svg className="w-5 h-5 text-slate-600 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}

export default function Home() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Lazy initializers, not an effect: both reads are synchronous, SSR-safe
  // (guarded on `typeof window`), and side-effect-free — an effect here would
  // only add a redundant render pass. analyzedIds never changes after mount
  // (thesis analysis happens on a different page), so no setter is needed;
  // adhdIds does change, after a batch ADHD run below.
  const [analyzedIds] = useState<Set<string>>(() => getAnalyzedIds());
  const [adhdIds, setAdhdIds] = useState<Set<string>>(() => getAdhdAnalyzedIds());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [selectMode, setSelectMode] = useState(false);
  // Cross-day, cross-search selection: intentionally never reset when
  // selectedDate or searchQuery change, so picking conversations from
  // several different days for one Group Thesis / ADHD batch run works.
  // Session-only by design — a reload clears it, same as before this feature.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, failed: 0 });

  // Recomputed each render (cheap) so "today" stays correct if the tab is
  // left open past midnight. selectedDate is pinned at mount instead —
  // jumping the view out from under the user mid-session would be jarring.
  const todayStr = dayOf(new Date().toISOString());
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  // Collapsed by default: the grid would otherwise be the first thing painted
  // on mobile, pushing the day's actual conversations below the fold. Picking
  // a day (outside select mode) collapses it back, so it stays out of the way
  // once its job — jumping to a day — is done.
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Revalidate the list over the network and refresh the cache. A refresh
  // forces a fresh pull from Omi; the initial load can reuse the HTTP cache.
  // Cached data stays on screen if an initial load fails, so a network hiccup
  // never blanks the UI.
  const loadConversations = useCallback(async (mode: "initial" | "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    try {
      const data = await fetchJson<Conversation[]>(
        "/api/conversations",
        mode === "refresh" ? { cache: "no-store" } : undefined
      );
      const list = Array.isArray(data) ? data : [];
      setConversations(list);
      setError(null);
      setLastSynced(new Date().toISOString());
      cacheSet(CONVERSATIONS_CACHE_KEY, list);
    } catch (e) {
      // On an explicit refresh, always report. On the initial load, only surface
      // an error if there was no cached list to fall back on.
      if (mode === "refresh" || !cacheGet(CONVERSATIONS_CACHE_KEY)) {
        setError(e instanceof Error ? e.message : "Failed to reach Omi");
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Instant paint from cache (stale-while-revalidate), then revalidate.
    // This can't become a lazy useState initializer like analyzedIds/adhdIds
    // above: the server-rendered HTML always shows an empty list (no
    // localStorage there), so reading the cache during the client's first
    // render would diverge from that SSR output and trigger a hydration
    // mismatch. Reading it here, post-mount, costs one extra render but
    // keeps the first paint hydration-safe.
    const cached = cacheGet<Conversation[]>(CONVERSATIONS_CACHE_KEY);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- see comment above; must run post-mount, not as a lazy initializer
      setConversations(cached.data);
      setLoading(false);
    }
    loadConversations("initial");
  }, [loadConversations]);

  const isAnalyzedEither = useCallback(
    (cid: string) => analyzedIds.has(cid) || adhdIds.has(cid),
    [analyzedIds, adhdIds]
  );

  // Group once per conversation-list change, not per render — feeds both the
  // calendar's "has entries" dots and the selected day's list.
  const conversationsByDay = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of conversations) {
      const d = dayOf(c.created_at);
      (map.get(d) ?? map.set(d, []).get(d)!).push(c);
    }
    return map;
  }, [conversations]);

  const daysWithEntries = useMemo(() => new Set(conversationsByDay.keys()), [conversationsByDay]);

  const isSearching = searchQuery.trim().length > 0;

  // Search deliberately bypasses day-scoping entirely — the whole point is
  // "I remember the topic, not the date". Client-side only: the full list is
  // already loaded, no server-side search exists (or needs to).
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      const title = c.structured?.title?.toLowerCase() ?? "";
      const overview = c.structured?.overview?.toLowerCase() ?? "";
      return title.includes(q) || overview.includes(q);
    });
  }, [conversations, searchQuery, isSearching]);

  const dayConversations = conversationsByDay.get(selectedDate) ?? [];
  const visibleConversations = isSearching ? searchResults : dayConversations;

  const visibleAnalyzedCount = visibleConversations.filter((c) => isAnalyzedEither(c.id)).length;

  const filtered = visibleConversations.filter((c) => {
    if (filter === "analyzed") return isAnalyzedEither(c.id);
    if (filter === "unanalyzed") return !isAnalyzedEither(c.id);
    return true;
  });

  // Date-group search results only when they actually span more than one day —
  // a single-day search doesn't need a redundant heading repeating what the
  // "Results for…" line above already says.
  const filteredByDay = isSearching
    ? Array.from(
        filtered.reduce((map, c) => {
          const d = dayOf(c.created_at);
          (map.get(d) ?? map.set(d, []).get(d)!).push(c);
          return map;
        }, new Map<string, Conversation[]>())
      ).sort((a, b) => (a[0] < b[0] ? 1 : -1))
    : null;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // "All selected" must check membership, not just counts — the selection can
  // contain conversations hidden by the current filter (or on other days).
  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  // How many distinct days the current selection actually spans — drives the
  // "(across all days)" toolbar qualifier. A count-based check would fire on
  // a 5-item same-day selection just as readily as a real cross-day one.
  const selectedDaySpan = useMemo(() => {
    if (selected.size === 0) return 0;
    const days = new Set<string>();
    for (const c of conversations) {
      if (selected.has(c.id)) days.add(dayOf(c.created_at));
    }
    return days.size;
  }, [selected, conversations]);

  const selectAll = () => {
    if (allFilteredSelected) {
      setSelected(new Set());
    } else {
      setSelected((prev) => new Set([...prev, ...filtered.map((c) => c.id)]));
    }
  };

  const startGroupAnalysis = useCallback(() => {
    if (selected.size < 2) return;
    const ids = Array.from(selected).join(",");
    router.push(`/analyze-group?ids=${ids}`);
  }, [selected, router]);

  const runBatchAdhd = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: ids.length, failed: 0 });
    let failed = 0;
    for (let i = 0; i < ids.length; i++) {
      try {
        const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: { structured?: { title?: string }; created_at?: string } }>(
          "/api/analyze-adhd",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conversationId: ids[i] }),
          }
        );
        // Persist via the storage lib (same shape the conversation page uses).
        saveAdhdAnalysis({
          conversationId: ids[i],
          title: data.conversation?.structured?.title || "Untitled",
          date: data.conversation?.created_at,
          analysis: data.analysis,
        });
      } catch {
        failed++;
      }
      setBatchProgress({ done: i + 1, total: ids.length, failed });
    }
    setAdhdIds(getAdhdAnalyzedIds());
    setBatchRunning(false);
  }, [selected]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
  };

  const goToPrevMonth = () => {
    setCalendarMonth(({ year, month }) => (month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 }));
  };
  const goToNextMonth = () => {
    setCalendarMonth(({ year, month }) => (month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 }));
  };
  const jumpToMonth = (year: number, month: number) => setCalendarMonth({ year, month });
  const goToToday = () => {
    const d = new Date();
    setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() });
    setSelectedDate(todayStr);
    // In select mode, leave the grid open — a cross-day batch selection needs
    // to jump between several days in a row without it snapping shut each time.
    if (!selectMode) setCalendarExpanded(false);
  };
  const selectDay = (day: string) => {
    setSelectedDate(day);
    if (!selectMode) setCalendarExpanded(false);
  };

  const selectedDateLabel = formatDateTime(`${selectedDate}T12:00:00`, {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        {/* Wordmark: the mark carries the brand's navy/cyan two-tone, so it is
            sized to the cap-height of TRACE and tracked wide to match the logo
            lockup rather than sitting as a generic leading icon. */}
        <h1 className="mb-2 flex items-center gap-2.5 text-3xl font-bold text-white">
          <TraceMark className="w-9 h-9 flex-shrink-0 text-white" />
          <span className="tracking-[0.18em]">TRACE</span>
        </h1>
        <p className="text-slate-400">
          Personal &amp; research assistant — your Omi conversations as thesis evidence and a daily plan
        </p>

        {/* Sync status + refresh — quiet meta row, read once per visit */}
        <div className="flex items-center justify-between gap-3 mt-4 pb-4 border-b border-slate-800">
          <span className="text-sm text-slate-400" aria-live="polite">
            {refreshing
              ? "Refreshing from Omi…"
              : loading
              ? "Loading…"
              : lastSynced
              ? `Synced ${getAnalysisAge(lastSynced).label}`
              : ""}
          </span>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Link
              href="/rollup"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex-shrink-0"
            >
              <CalendarIcon className="w-4 h-4 flex-shrink-0" />
              Daily Rollup
            </Link>
            <button
              onClick={() => loadConversations("refresh")}
              disabled={loading || refreshing}
              aria-label="Refresh conversations from Omi"
              className="flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <RefreshIcon className={`w-4 h-4 flex-shrink-0 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Onboarding: About this framework — a quiet footnote, not a section */}
        <details className="mt-3 group">
          <summary className="cursor-pointer list-none text-sm text-slate-400 hover:text-slate-300 transition-colors min-h-[44px] flex items-center gap-1.5">
            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-90" />
            What is Pioneer Sovereignty?
          </summary>
          <div className="pl-5 pt-1 pb-2 text-sm text-slate-300 space-y-3">
            <p>
              <strong className="text-white">Pioneer Sovereignty</strong> is a concept from a PhD anthropology thesis
              by Ulysses S. Cabayao, SJ (UCL). It examines how ranching families in Montana&apos;s Flathead Valley
              produce, assert, and contest authority over land and herd through everyday social practices.
            </p>
            <p>
              The thesis argues that these families received their land, water, and grazing rights through
              federal instruments (homestead patents, water adjudications) — yet experience that authority
              as self-made and prior to the state that granted it. At the same time, they deny the prior
              and ongoing sovereignty of the Confederated Salish and Kootenai Tribes whose territory they occupy.
            </p>
            <div className="pt-2">
              <p className="font-medium text-slate-200 mb-2">The 8 analysis dimensions:</p>
              <ul className="space-y-1.5 text-slate-400">
                {[
                  { label: "RQ1 — Documentary Record", desc: "Historical-legal acts that constituted authority (patents, water rights)" },
                  { label: "RQ2 — Everyday Practices", desc: "Kinship, inheritance, branding, boundary-maintenance, conflict" },
                  { label: "RQ3 — CSKT Intersection", desc: "How ranching authority intersects with tribal sovereignty" },
                  { label: "RQ4 — Wildness Imaginary", desc: "Frontier mythology as double erasure of Indigenous + federal authority" },
                  { label: "Orienting Conditions", desc: "Which of 5 theoretical conditions are evidenced" },
                  { label: "Rival Hypothesis Test", desc: "Is frontier framing felt subjectivity or instrumental rhetoric?" },
                  { label: "Refutation Signals", desc: "What would disconfirm the concept" },
                  { label: "Forward Thinking", desc: "Research directions and next questions" },
                ].map((dim, i) => (
                  <li key={dim.label} className="flex gap-2">
                    <span
                      className="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-semibold flex items-center justify-center"
                      aria-hidden="true"
                    >
                      {i + 1}
                    </span>
                    <span>
                      <strong className="text-slate-300">{dim.label}</strong>: {dim.desc}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-slate-400 pt-2">
              This tool analyzes conversations captured by the Omi DK2 wearable device
              and runs them through an AI model grounded in the thesis&apos;s full theoretical framework.
            </p>
          </div>
        </details>

        {/* Search — bypasses day-scoping entirely; the fast path when you know the topic, not the date */}
        {conversations.length > 0 && (
          <div className="relative mt-4">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations by title or topic…"
              aria-label="Search all conversations"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors min-h-[44px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[32px] min-w-[32px] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
              >
                <XIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Calendar — the "browse by day" entry point; hidden while a search query is active
            so there's only ever one navigation mode showing at once. Collapsed by default to
            a one-line summary (which also states the day being viewed) so it doesn't push
            today's conversations below the fold on first paint. */}
        {conversations.length > 0 && !isSearching && (
          <div className="mt-4">
            {calendarExpanded ? (
              <CalendarMonth
                year={calendarMonth.year}
                month={calendarMonth.month}
                todayStr={todayStr}
                selectedDate={selectedDate}
                daysWithEntries={daysWithEntries}
                onSelectDay={selectDay}
                onPrevMonth={goToPrevMonth}
                onNextMonth={goToNextMonth}
                onToday={goToToday}
                onJumpToMonth={jumpToMonth}
                onCollapse={() => setCalendarExpanded(false)}
              />
            ) : (
              <button
                onClick={() => setCalendarExpanded(true)}
                aria-expanded={false}
                aria-label="Expand calendar to browse a different day"
                className="w-full card p-3 flex items-center justify-between gap-2 text-left hover:border-slate-600 transition-colors min-h-[44px]"
              >
                <span className="flex items-center gap-2 text-sm text-slate-200 min-w-0">
                  <CalendarIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span className="truncate">
                    {selectedDateLabel}
                    {selectedDate === todayStr && <span className="text-slate-400"> · Today</span>}
                  </span>
                </span>
                <ChevronRightIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />
              </button>
            )}
          </div>
        )}

        {/* Search results heading */}
        {conversations.length > 0 && isSearching && (
          <p className="text-sm text-slate-400 mt-4">
            Results for &ldquo;{searchQuery.trim()}&rdquo;
          </p>
        )}

        {/* Scan row: count + filter + group-select entry — tight to the list it governs */}
        {visibleConversations.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 mt-3">
            {/* Wraps: at 375px the count + all three pills need ~360px against
                343px of available width, which clipped "Unanalyzed" off-screen. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-slate-400 whitespace-nowrap">
                {visibleAnalyzedCount}/{visibleConversations.length} analyzed
              </span>
              <div className="flex gap-1" role="radiogroup" aria-label="Filter conversations by analysis status">
                {(["all", "analyzed", "unanalyzed"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    role="radio"
                    aria-checked={filter === f}
                    aria-label={`Show ${f} conversations`}
                    className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                      filter === f
                        // slate-950 on cyan-400 = 11.16:1; slate-300 on
                        // slate-800 = 8.59:1. Branches are mutually exclusive.
                        ? "bg-cyan-400 text-slate-950" // impeccable-disable-line gray-on-color
                        : "bg-slate-800 text-slate-300 hover:text-white"
                    }`}
                  >
                    {f === "all" ? "All" : f === "analyzed" ? "Analyzed" : "Unanalyzed"}
                  </button>
                ))}
              </div>
            </div>
            {!selectMode ? (
              <button
                onClick={() => setSelectMode(true)}
                aria-label="Enable selection mode to analyze multiple conversations as a group"
                className="text-sm min-h-[44px] flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                <SquareIcon className="w-3.5 h-3.5" />
                Select &amp; Analyze Group
              </button>
            ) : (
              <button
                onClick={exitSelectMode}
                aria-label="Cancel selection mode"
                className="text-sm min-h-[44px] flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-4 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                <XIcon className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        )}

        {/* Selection mode toolbar — count reflects the true cross-day, cross-search total */}
        {selectMode && (
          <div className="mt-3">
            <div
              className="card p-4 border-cyan-500/30 flex flex-wrap items-center justify-between gap-3"
              role="toolbar"
              aria-label="Group analysis toolbar"
            >
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={selectAll}
                  disabled={filtered.length === 0}
                  aria-label={allFilteredSelected ? "Deselect all conversations in this view" : "Select all conversations in this view"}
                  className="text-sm min-h-[44px] bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  {allFilteredSelected ? "Deselect All" : "Select All"}
                </button>
                <span className="text-sm text-slate-400 whitespace-nowrap" aria-live="polite">
                  {selected.size} selected{selectedDaySpan > 1 ? " (across all days)" : ""}
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={startGroupAnalysis}
                  disabled={selected.size === 0 || batchRunning}
                  aria-label={`Group thesis analysis on ${selected.size} conversations${selected.size === 1 ? " (select at least 2)" : ""}`}
                  className={TOOLBAR_ACTION_CLASS}
                >
                  <SparklesIcon className="w-4 h-4" />
                  Group Thesis ({selected.size})
                </button>
                <button
                  onClick={runBatchAdhd}
                  disabled={selected.size === 0 || batchRunning}
                  aria-label={`Run ADHD Aid on ${selected.size} conversations`}
                  className={TOOLBAR_ACTION_CLASS}
                >
                  <ClipboardIcon className="w-4 h-4" />
                  {batchRunning ? `Running ${batchProgress.done}/${batchProgress.total}…` : `Run ADHD (${selected.size})`}
                </button>
              </div>
            </div>
            {!batchRunning && batchProgress.total > 0 && batchProgress.failed > 0 && (
              <p className="text-amber-300/90 text-sm mt-2" role="status">
                {batchProgress.failed} of {batchProgress.total} could not be analyzed and {batchProgress.failed === 1 ? "was" : "were"} skipped.
              </p>
            )}
          </div>
        )}
      </header>

      {loading && (
        <div className="space-y-4" aria-label="Loading conversations" role="status">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
        </div>
      )}

      {error && (
        <div className="card p-6 border-red-500/50 mb-6" role="alert">
          <p className="text-red-400 flex items-center gap-2">
            <WarningIcon className="w-5 h-5 flex-shrink-0" />
            <span className="min-w-0 break-words">{error}</span>
          </p>
          {conversations.length > 0 && (
            <p className="text-slate-400 text-sm mt-2">Showing the last loaded conversations below.</p>
          )}
          <button
            onClick={() => loadConversations(conversations.length > 0 ? "refresh" : "initial")}
            disabled={loading || refreshing}
            className="mt-3 text-sm bg-slate-900 hover:bg-slate-700 border border-slate-600 disabled:opacity-50 text-slate-200 px-4 py-2 min-h-[44px] rounded-lg transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && conversations.length === 0 && (
        <div className="card p-8 text-center">
          <MicIcon className="w-10 h-10 mx-auto mb-4 text-slate-600" />
          <p className="text-slate-300">No conversations found.</p>
          <p className="text-slate-400 text-sm mt-2">Record a conversation with your Omi device, then come back.</p>
        </div>
      )}

      {!loading && !error && conversations.length > 0 && isSearching && searchResults.length === 0 && (
        <div className="card p-8 text-center">
          <SearchIcon className="w-8 h-8 mx-auto mb-4 text-slate-600" />
          <p className="text-slate-300">No matches for &ldquo;{searchQuery.trim()}&rdquo;.</p>
          <button onClick={() => setSearchQuery("")} className="text-cyan-400 text-sm mt-2 hover:underline min-h-[44px] px-2">
            Clear search
          </button>
        </div>
      )}

      {!loading && !error && conversations.length > 0 && !isSearching && dayConversations.length === 0 && (
        <div className="card p-8 text-center">
          <CalendarIcon className="w-8 h-8 mx-auto mb-4 text-slate-600" />
          <p className="text-slate-300">
            {selectedDate === todayStr ? "Nothing recorded today yet." : `No conversations on ${selectedDateLabel}.`}
          </p>
          <p className="text-slate-400 text-sm mt-2">Pick another day above, or search for something specific.</p>
        </div>
      )}

      {!loading && visibleConversations.length > 0 && filtered.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-slate-400">
            {filter === "analyzed" ? "No analyzed conversations here yet." : "Everything here has been analyzed!"}
          </p>
          <button onClick={() => setFilter("all")} className="text-cyan-400 text-sm mt-2 hover:underline min-h-[44px] px-2">
            Show all
          </button>
        </div>
      )}

      <div className="space-y-3 conversation-list" role={selectMode ? "listbox" : "list"} aria-label="Conversations" aria-multiselectable={selectMode || undefined}>
        {filteredByDay && filteredByDay.length > 1
          ? filteredByDay.map(([day, items]) => (
              <div key={day}>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 mt-4 first:mt-0">
                  {formatDateTime(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long" })}
                </p>
                <div className="space-y-3">
                  {items.map((convo) => (
                    <ConversationRow
                      key={convo.id}
                      convo={convo}
                      selectMode={selectMode}
                      isSelected={selected.has(convo.id)}
                      isAnalyzed={analyzedIds.has(convo.id)}
                      isAnalyzedEither={isAnalyzedEither(convo.id)}
                      isAdhd={adhdIds.has(convo.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              </div>
            ))
          : filtered.map((convo) => (
              <ConversationRow
                key={convo.id}
                convo={convo}
                selectMode={selectMode}
                isSelected={selected.has(convo.id)}
                isAnalyzed={analyzedIds.has(convo.id)}
                isAnalyzedEither={isAnalyzedEither(convo.id)}
                isAdhd={adhdIds.has(convo.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
      </div>
    </main>
  );
}
