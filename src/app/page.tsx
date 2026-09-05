"use client";

import { useEffect, useState, useCallback, useMemo, memo, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getAnalyzedIds, getAnalysisAge } from "@/lib/storage";
import { getAdhdAnalyzedIds, getAdhdSummaries, saveAdhdAnalysis } from "@/lib/adhd-storage";
import { getEnrichments, saveEnrichments, toggleKeep, type StoredEnrichment } from "@/lib/enrich-storage";
import { isHiddenJunk as isHiddenJunkRecord, type Enrichment } from "@/lib/enrich-core";
import type { AdhdAnalysis } from "@/lib/adhd";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, dayOf } from "@/lib/format";
import {
  TraceMark, SquareIcon, XIcon, CheckIcon, SparklesIcon, WarningIcon, MicIcon,
  FolderIcon, RefreshIcon, ClipboardIcon, CalendarIcon, ChevronRightIcon, SearchIcon, MapPinIcon, HelpIcon,
  UsersIcon, TrendingUpIcon, DownloadIcon,
} from "@/components/icons";
import ConfirmDialog from "@/components/ConfirmDialog";
import { pullAndMerge } from "@/lib/sync";
import { useRovingRadioGroup } from "@/lib/roving";
import { exportAllData } from "@/lib/export";
import { BUTTON_GHOST, BUTTON_SECONDARY } from "@/lib/ui";

const FILTER_VALUES = ["all", "analyzed", "unanalyzed"] as const;

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
// (Ink Panel, #262019 === bg-slate-800), so slate-800 here would repeat the
// exact "invisible against its own container" bug the Secondary Button rule
// exists to prevent (see DESIGN.md's Buttons section).
// Detector waiver below: it pairs the disabled/active slate values with the
// cyan tints in the same string. Real pairs, all measured — cyan-200 on the
// cyan-950/40 wash 12.20:1, slate-950 on the active cyan-400 fill 7.87:1,
// and slate-400 on the disabled slate-700 fill 4.98:1 (disabled controls are
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
  geolocation?: { latitude?: number; longitude?: number } | null;
}

function LensBadges({ thesis, adhd }: { thesis: boolean; adhd: boolean }) {
  const pill = (on: boolean, label: string) => (
    <span
      title={`${label}: ${on ? "analyzed" : "not analyzed"}`}
      className={`min-w-[40px] px-1.5 py-0.5 rounded-full border text-[10px] font-semibold leading-none whitespace-nowrap text-center ${
        // False positive below: the scanner pairs the "off" branch's text-slate-400 with the "on"
        // branch's bg-emerald-500 since both live in one ternary string. Real pairs, both verified:
        // emerald-400/emerald-wash (6.73:1) and slate-400/slate-800 (5.87:1).
        on ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" : "bg-slate-800/60 border-slate-700 text-slate-400" // impeccable-disable-line gray-on-color
      }`}
    >
      {label}
    </span>
  );
  // Entirely aria-hidden. The per-lens state still has to reach a screen
  // reader — the row's own label collapses both lenses into one "(analyzed)",
  // which can't distinguish thesis-done from ADHD-done — but it is announced
  // by <LensState> AFTER the title instead of from here. These pills sit first
  // in DOM order for layout reasons, and reading their state from here meant a
  // screen reader said "Thesis not analyzed, ADHD Aid analyzed" before naming
  // the conversation, on every row of a day's list.
  return (
    <div aria-hidden="true" className="mt-0.5 flex-shrink-0 flex flex-col gap-0.5">
      {pill(thesis, "Thesis")}
      {pill(adhd, "ADHD")}
    </div>
  );
}

/** The lens state, announced after the conversation's name. */
function LensState({ thesis, adhd }: { thesis: boolean; adhd: boolean }) {
  return (
    <span className="sr-only">
      Thesis {thesis ? "analyzed" : "not analyzed"}, ADHD Aid {adhd ? "analyzed" : "not analyzed"}.
    </span>
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
  year, month, todayStr, selectedDate, daysWithEntries, daysNeedingAttention, onSelectDay, onPrevMonth, onNextMonth, onToday, onJumpToMonth, onCollapse,
}: {
  year: number;
  month: number; // 0-indexed
  todayStr: string;
  selectedDate: string;
  daysWithEntries: Set<string>;
  daysNeedingAttention: Set<string>;
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
      <div className="calendar-grid grid grid-cols-7 gap-1 mb-1">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-slate-400" aria-hidden="true">
            {d}
          </div>
        ))}
      </div>
      <div className="calendar-grid grid grid-cols-7 gap-1" role="group" aria-label="Pick a day">
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} aria-hidden="true" />;
          const { day, dayStr } = cell;
          const isToday = dayStr === todayStr;
          const isSelected = dayStr === selectedDate;
          const hasEntries = daysWithEntries.has(dayStr);
          const needsAttention = daysNeedingAttention.has(dayStr);
          const isFuture = dayStr > todayStr;
          return (
            <button
              key={dayStr}
              onClick={() => onSelectDay(dayStr)}
              aria-label={`${new Date(year, month, day).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}${isToday ? ", today" : ""}${hasEntries ? (needsAttention ? ", has unanalyzed conversations" : ", fully analyzed") : ""}`}
              aria-pressed={isSelected}
              className={`aspect-square min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 text-sm transition-colors ${
                isSelected
                  // slate-950 is near-black (#14100d), not washed-out gray: it
                  // clears 7.87:1 on cyan-400. Detector cross-pairs the other
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
              {/* "Some still unanalysed" vs "all analysed" was carried by the
                  dot's hue alone at 4px — invisible to a colour-blind or
                  low-vision reader, though the parent button's aria-label
                  spells both states out. The two states now differ in shape
                  as well: a hollow ring for work outstanding, a filled dot for
                  a day that is done. */}
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  !hasEntries
                    ? "bg-transparent"
                    : isSelected
                    ? "bg-white"
                    : needsAttention
                    ? "border border-slate-400 bg-transparent"
                    : "bg-emerald-500"
                }`}
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

/**
 * What to call a conversation.
 *
 * Omi leaves `structured.title` empty for most recordings, so the list used to
 * render "Untitled" on every row and the only discriminator across a whole day
 * was a timestamp — the screen the user opens most, carrying no information.
 * The ADHD pass already writes a plain-language summary of each conversation;
 * when Omi has no title, that sentence is a far better name than a placeholder.
 * The enrichment pass exists to name conversations, so its title outranks the
 * gist (a summary pressed into service). Falls back to the
 * timestamp-plus-category shape the rollup list uses, and only then to a label.
 */
function conversationTitle(convo: Conversation, enrichment?: StoredEnrichment, gist?: string): string {
  const omi = convo.structured?.title?.trim();
  if (omi) return omi;
  if (enrichment?.title) return enrichment.title;
  if (gist) return gist;
  const when = formatDateTime(convo.created_at);
  const cat = convo.structured?.category?.trim();
  return cat ? `${when} · ${cat}` : when;
}

/** The location mark. Rendered ONLY when a location exists: the absent state
 *  was a 1.23:1 smudge that also announced "No location attached" on every row.
 *  Absence is the absence of the mark. Shared by both row branches so the two
 *  cannot drift apart again — they already did once. */
function LocationMark({ hasLocation }: { hasLocation: boolean }) {
  if (!hasLocation) return null;
  return (
    <span title="Location attached">
      <span className="sr-only">Location attached</span>
      <MapPinIcon aria-hidden="true" className="w-3.5 h-3.5 flex-shrink-0 text-cyan-300" />
    </span>
  );
}

const ConversationRow = memo(function ConversationRow({
  convo, selectMode, isSelected, isAnalyzed, isAnalyzedEither, isAdhd, enrichment, gist, onToggleSelect,
}: {
  convo: Conversation;
  selectMode: boolean;
  isSelected: boolean;
  isAnalyzed: boolean;
  isAnalyzedEither: boolean;
  isAdhd: boolean;
  /** The enrichment pass's record, when one exists — supplies the title and
   *  overview for conversations Omi returned bare. Passed in rather than read
   *  per row so the list keeps no storage access in its render path. */
  enrichment?: StoredEnrichment;
  /** The ADHD analysis's one-line summary, when one exists. Used as the title
   *  when Omi returned none. Passed in rather than read per row so the list
   *  keeps no storage access in its render path. */
  gist?: string;
  onToggleSelect: (id: string) => void;
}) {
  const hasLocation = convo.geolocation?.latitude != null && convo.geolocation?.longitude != null;

  if (selectMode) {
    return (
      <button
        onClick={() => onToggleSelect(convo.id)}
        role="option"
        aria-selected={isSelected}
        aria-label={`${isSelected ? "Deselect" : "Select"} "${conversationTitle(convo, enrichment, gist)}" for group analysis${isAnalyzedEither ? " (analyzed)" : ""}`}
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
              {conversationTitle(convo, enrichment, gist)}
            </h2>
            <LensState thesis={isAnalyzed} adhd={isAdhd} />
            {(convo.structured?.overview || enrichment?.overview) && (
              <p className="text-slate-400 font-serif italic text-sm mt-1 line-clamp-1">{convo.structured?.overview || enrichment?.overview}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 flex-wrap">
              <span className="font-mono whitespace-nowrap">{formatDateTime(convo.created_at)}</span>
              {convo.structured?.category && (
                <span className="bg-slate-800 px-2 py-0.5 rounded-full whitespace-nowrap max-w-[16ch] truncate" title={convo.structured.category}>{convo.structured.category}</span>
              )}
              <LocationMark hasLocation={hasLocation} />
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <Link
      href={`/conversation/${convo.id}`}
      /* Identity before status. This previously began with the lens state, so
         a screen reader announced "Thesis not analyzed, ADHD Aid analyzed"
         before saying which conversation it was — twenty-seven times down a
         day's list. */
      aria-label={`${conversationTitle(convo, enrichment, gist)}${isAnalyzedEither ? " (analyzed)" : ""}`}
      className={`card p-5 block transition-colors min-h-[44px] border-l-2 ${
        isAnalyzedEither
          ? "border-l-emerald-500/40 hover:border-emerald-500/50"
          : "border-l-transparent hover:border-cyan-500/50"
      }`}
    >
      <div className="flex items-start gap-3">
        <LensBadges thesis={isAnalyzed} adhd={isAdhd} />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-white truncate">
            {conversationTitle(convo, enrichment, gist)}
          </h2>
          <LensState thesis={isAnalyzed} adhd={isAdhd} />
          {(convo.structured?.overview || enrichment?.overview) && (
            <p className="text-slate-400 font-serif italic text-sm mt-1 line-clamp-2">{convo.structured?.overview || enrichment?.overview}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400 flex-wrap">
            <span className="font-mono whitespace-nowrap">{formatDateTime(convo.created_at)}</span>
            {convo.structured?.category && (
              <span className="bg-slate-800 px-2 py-0.5 rounded-full whitespace-nowrap max-w-[16ch] truncate" title={convo.structured.category}>{convo.structured.category}</span>
            )}
            {convo.folder_name && (
              <span className="flex items-center gap-1 bg-cyan-900/50 text-cyan-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                <FolderIcon className="w-3 h-3" />
                {convo.folder_name}
              </span>
            )}
            <LocationMark hasLocation={hasLocation} />
          </div>
        </div>
        <svg className="w-5 h-5 text-slate-600 mt-1 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
});

interface BatchFailure {
  id: string;
  title: string;
}

function HomeInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Lazy initializers, not an effect: both reads are synchronous, SSR-safe
  // (guarded on `typeof window`), and side-effect-free — an effect here would
  // only add a redundant render pass. Both need setters: adhdIds changes after
  // a batch run below, and analyzedIds changes on another page (the conversation
  // detail view), so this page has to re-read it when it regains focus.
  const [analyzedIds, setAnalyzedIds] = useState<Set<string>>(() => getAnalyzedIds());
  const [adhdIds, setAdhdIds] = useState<Set<string>>(() => getAdhdAnalyzedIds());
  /* Built once per change, not per row: the list must keep no storage access
     in its render path. Supplies a human title for the conversations Omi
     returned unnamed, which on a busy day is most of them. */
  const [gists, setGists] = useState<Map<string, string>>(() => getAdhdSummaries());
  /* Same contract as `gists`: built once per change, threaded down, never read
     per row. Carries titles/overviews from the enrichment pass plus the junk
     verdicts that drive the Ignored section. */
  const [enrichments, setEnrichments] = useState<Map<string, StoredEnrichment>>(() => getEnrichments());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Journal dateline for the masthead. Computed client-side only, after
  // mount: `new Date()` during SSR reads the server's clock/timezone, which
  // can print a different date than the browser's — a literal SSR/CSR
  // mismatch that React's hydration flags as an error. Starting from `null`
  // renders identical (empty) markup on the server and the first client
  // pass, then fills in once mounted.
  const [mountedDateline, setMountedDateline] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: renders identical markup on the server and the first client pass, then fills in once mounted
    setMountedDateline(true);
  }, []);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "analyzed" | "unanalyzed">("all");
  const [stale, setStale] = useState(false);
  const rovingFilter = useRovingRadioGroup(FILTER_VALUES, filter, setFilter);
  const [selectMode, setSelectMode] = useState(false);
  // Cross-day, cross-search selection: intentionally never reset when
  // selectedDate or searchQuery change, so picking conversations from
  // several different days for one Group Thesis / ADHD batch run works.
  // Session-only by design — a reload clears it, same as before this feature.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionListOpen, setSelectionListOpen] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState({ done: 0, total: 0, failed: 0 });
  const [batchFailures, setBatchFailures] = useState<BatchFailure[]>([]);
  const [pendingBatch, setPendingBatch] = useState<{ ids: string[]; replacing: number } | null>(null);
  const [naming, setNaming] = useState(false);
  const [namingProgress, setNamingProgress] = useState({ done: 0, total: 0 });
  const [namingFailed, setNamingFailed] = useState(0);

  // Recomputed each render (cheap) so "today" stays correct if the tab is
  // left open past midnight. selectedDate is pinned at mount instead —
  // jumping the view out from under the user mid-session would be jarring.
  const todayStr = dayOf(new Date().toISOString());
  // Seeded from ?day= so the chosen day survives a reload, a PWA relaunch, and
  // a shared link. Anything that isn't a plain YYYY-MM-DD falls back to today
  // rather than rendering an empty view for a malformed param.
  const dayParam = searchParams.get("day");
  const [selectedDate, setSelectedDate] = useState(() =>
    dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : todayStr
  );
  /* Follows the day being browsed, not the wall clock. It previously always
     printed today, so opening ?day=2026-08-30 showed a running head reading
     "TUESDAY, 1 SEPTEMBER 2026" above a list of Sunday's conversations — the
     masthead contradicting the page under it. /rollup was fixed for this and
     the hub was left behind. */
  const todayDateline = useMemo(() => {
    if (!mountedDateline) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate) ? new Date(`${selectedDate}T12:00:00`) : new Date();
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long", year: "numeric",
    });
  }, [mountedDateline, selectedDate]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? new Date(dayParam) : new Date();
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
      setStale(false);
      setLastSynced(new Date().toISOString());
      cacheSet(CONVERSATIONS_CACHE_KEY, list);
    } catch (e) {
      // On an explicit refresh, always report. On the initial load, only surface
      // an error if there was no cached list to fall back on.
      if (mode === "refresh" || !cacheGet(CONVERSATIONS_CACHE_KEY)) {
        setError(e instanceof Error ? e.message : "Could not refresh the list");
      } else {
        // Silently falling back to cache used to mean a whole day of stale rows
        // rendered as if they were current — the list looked authoritative and
        // wasn't. Mark it instead, so "no conversations today" can be read as
        // "we couldn't ask" rather than "nothing happened".
        setStale(true);
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

  // Re-read the analyzed sets whenever this page regains focus. Both are
  // written on other pages (the conversation detail view runs either lens), so
  // a client-side nav back here would otherwise paint stale lens badges — the
  // conversation you just analyzed still reading "not analyzed".
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      setAnalyzedIds(getAnalyzedIds());
      setAdhdIds(getAdhdAnalyzedIds());
      setGists(getAdhdSummaries());
      setEnrichments(getEnrichments());
    };
    // Merge in anything analyzed on the user's other device before the first
    // resync, so badges reflect the full picture rather than this device's
    // history. No-ops when the durable store isn't configured.
    pullAndMerge().then((changed) => {
      if (changed) resync();
    });
    resync();
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, []);

  // Mirror the selected day into the URL without adding history entries —
  // `replace`, so the browser Back button still means "leave this page"
  // rather than walking back through every day the user browsed.
  //
  // Reads window.location rather than the `searchParams` hook, and no-ops when
  // the URL already matches. Depending on searchParams here is an infinite
  // loop: replace() hands back a new searchParams object, which re-fires the
  // effect, which replaces again.
  useEffect(() => {
    const current = new URLSearchParams(window.location.search);
    if (selectedDate === todayStr) current.delete("day");
    else current.set("day", selectedDate);
    const qs = current.toString();
    const next = qs ? `/?${qs}` : "/";
    if (next === window.location.pathname + window.location.search) return;
    router.replace(next, { scroll: false });
  }, [selectedDate, todayStr, router]);

  const isAnalyzedEither = useCallback(
    (cid: string) => analyzedIds.has(cid) || adhdIds.has(cid),
    [analyzedIds, adhdIds]
  );

  const titleOf = useCallback(
    (cid: string) => conversations.find((c) => c.id === cid)?.structured?.title || "Untitled",
    [conversations]
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

  // Which of those days still have at least one unanalyzed, non-junk
  // conversation — lets the calendar dot distinguish "has entries" from "has
  // entries, done" so the researcher doesn't have to open every day to see
  // which ones still need work. A day whose entries are all hidden-junk has
  // nothing left to analyze, so it must not keep the dot forever.
  const daysNeedingAttention = useMemo(() => {
    const set = new Set<string>();
    for (const [day, list] of conversationsByDay) {
      if (list.some((c) => !isAnalyzedEither(c.id) && !isHiddenJunkRecord(enrichments.get(c.id)))) set.add(day);
    }
    return set;
  }, [conversationsByDay, isAnalyzedEither, enrichments]);

  const isSearching = searchQuery.trim().length > 0;

  // Search deliberately bypasses day-scoping entirely — the whole point is
  // "I remember the topic, not the date". Client-side only: the full list is
  // already loaded, no server-side search exists (or needs to).
  const searchResults = useMemo(() => {
    if (!isSearching) return [];
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      const e = enrichments.get(c.id);
      const title = c.structured?.title?.toLowerCase() ?? "";
      const overview = c.structured?.overview?.toLowerCase() ?? "";
      const eTitle = e?.title?.toLowerCase() ?? "";
      const eOverview = e?.overview?.toLowerCase() ?? "";
      return title.includes(q) || overview.includes(q) || eTitle.includes(q) || eOverview.includes(q);
    });
  }, [conversations, searchQuery, isSearching, enrichments]);

  const dayConversations = conversationsByDay.get(selectedDate) ?? [];
  const visibleConversations = isSearching ? searchResults : dayConversations;

  // Hidden only on an explicit, unkept junk verdict. A conversation with no
  // enrichment record always renders normally — absence of a verdict is not a
  // verdict.
  const isHiddenJunk = useCallback(
    (cid: string) => isHiddenJunkRecord(enrichments.get(cid)),
    [enrichments]
  );

  // The scan-row count excludes hidden junk so "3/9 analyzed" counts only rows
  // the list actually shows.
  const countable = visibleConversations.filter((c) => !isHiddenJunk(c.id));
  const visibleAnalyzedCount = countable.filter((c) => isAnalyzedEither(c.id)).length;

  const filtered = visibleConversations.filter((c) => {
    if (filter === "analyzed") return isAnalyzedEither(c.id);
    if (filter === "unanalyzed") return !isAnalyzedEither(c.id);
    return true;
  });

  // The main list; junk verdicts collapse into the Ignored disclosure below it.
  // `ignored` holds every junk-flagged row for the day — kept ones included,
  // so a Keep can be reversed from the same place it was granted. Built from
  // `visibleConversations`, not `filtered`, so the analyzed/unanalyzed
  // dropdown (which junk conversations can never satisfy) doesn't change how
  // many "Ignored" rows appear.
  const shown = filtered.filter((c) => !isHiddenJunk(c.id));
  const ignored = visibleConversations.filter((c) => enrichments.get(c.id)?.junk);

  // Date-group search results only when they actually span more than one day —
  // a single-day search doesn't need a redundant heading repeating what the
  // "Results for…" line above already says.
  const filteredByDay = isSearching
    ? Array.from(
        shown.reduce((map, c) => {
          const d = dayOf(c.created_at);
          (map.get(d) ?? map.set(d, []).get(d)!).push(c);
          return map;
        }, new Map<string, Conversation[]>())
      ).sort((a, b) => (a[0] < b[0] ? 1 : -1))
    : null;

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // "All selected" must check membership, not just counts — the selection can
  // contain conversations hidden by the current filter (or on other days).
  const allFilteredSelected = shown.length > 0 && shown.every((c) => selected.has(c.id));

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
      setSelected((prev) => new Set([...prev, ...shown.map((c) => c.id)]));
    }
  };

  // What "Name new" targets: visible, no cached enrichment, and no existing
  // name from any source. The gist exclusion is a token-spend rule, not a
  // display rule — a gisted conversation is already named, and enriching it
  // would re-send a transcript to produce a name that exists.
  const unnamed = useMemo(
    () =>
      visibleConversations.filter(
        (c) => !enrichments.has(c.id) && !c.structured?.title?.trim() && !gists.has(c.id)
      ),
    [visibleConversations, enrichments, gists]
  );

  // Sequential like the ADHD batch. Each result is cached on save, so a rerun
  // after failures re-targets exactly the still-unnamed rows — never a
  // duplicate call for one already named. Results are accumulated and saved
  // in one batched write at the end rather than one full-map read/write per
  // conversation.
  const runNaming = useCallback(async () => {
    const ids = unnamed.map((c) => c.id);
    if (ids.length === 0) return;
    setNaming(true);
    setNamingProgress({ done: 0, total: ids.length });
    setNamingFailed(0);
    let failed = 0;
    const results: { conversationId: string; wordCount: number; enrichment: Enrichment }[] = [];
    for (let i = 0; i < ids.length; i++) {
      try {
        const data = await fetchJson<{ enrichment: Enrichment; wordCount: number }>("/api/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: ids[i] }),
        });
        results.push({ conversationId: ids[i], wordCount: data.wordCount, enrichment: data.enrichment });
      } catch {
        failed++;
      }
      setNamingProgress({ done: i + 1, total: ids.length });
    }
    if (results.length > 0) saveEnrichments(results);
    setNamingFailed(failed);
    setEnrichments(getEnrichments());
    setNaming(false);
  }, [unnamed]);

  const startGroupAnalysis = useCallback(() => {
    if (selected.size < 2) return;
    const ids = Array.from(selected).join(",");
    router.push(`/analyze-group?ids=${ids}`);
  }, [selected, router]);

  // Runs the batch over an explicit id list rather than reading `selected`, so
  // "Retry failed" can re-run just the stragglers without disturbing what the
  // user still has selected.
  const executeBatchAdhd = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    setBatchRunning(true);
    setBatchProgress({ done: 0, total: ids.length, failed: 0 });
    setBatchFailures([]);
    const failures: BatchFailure[] = [];
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
        // Keep the title, not just a tally: "3 of 13 could not be analyzed"
        // leaves the user to work out which three by hand.
        failures.push({ id: ids[i], title: titleOf(ids[i]) });
      }
      setBatchProgress({ done: i + 1, total: ids.length, failed: failures.length });
    }
    setBatchFailures(failures);
    setAdhdIds(getAdhdAnalyzedIds());
    setGists(getAdhdSummaries());
    setBatchRunning(false);
  }, [titleOf]);

  // Gate the run behind a confirmation when it would overwrite existing ADHD
  // analyses. Re-running is destructive here — ADHD analyses keep no version
  // history — and a batch can bury several replacements behind one tap.
  const requestBatchAdhd = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const replacing = ids.filter((id) => adhdIds.has(id));
    if (replacing.length > 0) {
      setPendingBatch({ ids, replacing: replacing.length });
      return;
    }
    executeBatchAdhd(ids);
  }, [selected, adhdIds, executeBatchAdhd]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Set());
    setSelectionListOpen(false);
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

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportNotice(null);
    try {
      const source = await exportAllData();
      setExportNotice(
        source === "local"
          ? "Saved from this device only — the server store is unavailable."
          : null
      );
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        {/* Dateline — the masthead's one signature touch: today's date set
            like a journal entry's opening line, mono-tracked and quiet. It's
            what makes the page read as "today's page in the journal" rather
            than a static app title, without adding any new color or icon. */}
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400" aria-hidden={!todayDateline}>
          {todayDateline || " "}
        </p>

        {/* Wordmark: the mark carries the brand's navy/cyan two-tone, so it is
            sized to the cap-height of TRACE and tracked wide to match the logo
            lockup rather than sitting as a generic leading icon. */}
        <h1 className="mb-2 flex items-center gap-3 font-bold text-white">
          <TraceMark className="w-10 h-10 flex-shrink-0 text-white" />
          <span className="tracking-[0.18em]">TRACE</span>
        </h1>
        <p className="text-slate-400 font-serif italic text-[0.95rem]">
          Personal &amp; research assistant — your recorded conversations as thesis evidence and a daily plan
        </p>

        {/* Header controls, split by job so nothing overflows on a phone:
            destinations (places to go) wrap freely on their own nav row, while
            the two utilities (Backup, Refresh) sit beside the sync status they
            act on. The old single non-wrapping row put ~600px of flex-shrink-0
            controls into a 343px viewport — Search, Backup, and Refresh were
            simply off-screen on mobile. Rendered as a labeled contents rule
            (small caps "Contents" + hairline) rather than plain ghost pills,
            so it reads as a journal's table of contents, not app-shell nav. */}
        <nav aria-label="Sections" className="mt-5 -mx-3">
          {/* 11px, not 10px: the Micro step (10px) is reserved for a single
              glyph inside a circular badge. This is a running head and belongs
              on the Eyebrow step like every other one in the app. */}
          <p className="mb-1.5 px-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
            Contents
          </p>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0">
            {/* Carries the day you are browsing. `href="/rollup"` dropped it,
                so jumping to the rollup from 25 Aug landed on a day picker and
                you had to find the date again. */}
            <Link
              href={selectedDate ? `/rollup?day=${selectedDate}` : "/rollup"}
              className={BUTTON_GHOST}
            >
              <CalendarIcon className="w-4 h-4 flex-shrink-0" />
              Daily Rollup
            </Link>
            <Link
              href="/commitments"
              className={BUTTON_GHOST}
            >
              <ClipboardIcon className="w-4 h-4 flex-shrink-0" />
              Open promises
            </Link>
            <Link
              href="/help"
              className={BUTTON_GHOST}
            >
              <HelpIcon className="w-4 h-4 flex-shrink-0" />
              How this works
            </Link>
            <Link
              href="/people"
              className={BUTTON_GHOST}
            >
              <UsersIcon className="w-4 h-4 flex-shrink-0" />
              People
            </Link>
            <Link
              href="/usage"
              className={BUTTON_GHOST}
            >
              <TrendingUpIcon className="w-4 h-4 flex-shrink-0" />
              Usage
            </Link>
            <Link
              href="/capture"
              className={BUTTON_GHOST}
            >
              <MicIcon className="w-4 h-4 flex-shrink-0" />
              Capture
            </Link>
            <Link
              href="/search"
              className={BUTTON_GHOST}
            >
              <SearchIcon className="w-4 h-4 flex-shrink-0" />
              Search Analyses
            </Link>
          </div>
        </nav>

        {/* Sync status + its two utilities — quiet meta row, read once per visit */}
        <div className="flex items-center justify-between gap-2 mt-1 pb-3 border-b border-slate-800">
          <span
            className={`text-sm min-w-0 truncate ${stale ? "text-amber-400" : "text-slate-400"}`}
            aria-live="polite"
          >
            {refreshing
              ? "Refreshing…"
              : loading
              ? "Loading…"
              : stale
              ? `Couldn't refresh — showing saved copy${lastSynced ? ` from ${getAnalysisAge(lastSynced).label}` : ""}`
              : lastSynced
              ? `Synced ${getAnalysisAge(lastSynced).label}`
              : "Not synced yet"}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={handleExport}
              disabled={exporting}
              aria-label="Download a backup of all stored analyses"
              className={BUTTON_GHOST}
            >
              <DownloadIcon className="w-4 h-4 flex-shrink-0" />
              {exporting ? "Backing up…" : "Backup"}
            </button>
            <button
              onClick={() => loadConversations("refresh")}
              disabled={loading || refreshing}
              aria-label="Refresh conversations"
              className={BUTTON_GHOST}
            >
              <RefreshIcon className={`w-4 h-4 flex-shrink-0 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        {exportError && (
          <p className="text-sm text-red-400 mt-2" role="alert">
            {exportError}
          </p>
        )}

        {exportNotice && (
          <p className="text-sm text-slate-400 mt-2">
            {exportNotice}
          </p>
        )}

        {/* Search — bypasses day-scoping entirely; the fast path when you know the topic, not the date */}
        {conversations.length > 0 && (
          <div className="relative mt-4">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search this list by title or topic…"
              data-shortcut-search
              aria-label="Search conversations on this device by title or topic"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-10 py-2.5 text-sm text-slate-200 placeholder-slate-400 focus:border-cyan-500 focus:outline-none transition-colors min-h-[44px]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
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
                daysNeedingAttention={daysNeedingAttention}
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
                <span className="flex items-center gap-2.5 text-slate-100 min-w-0">
                  <CalendarIcon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  {/* The dateline — the selected day set as a journal entry heading.
                      "Today" sits outside the truncating span so it never gets clipped
                      on narrow screens; the year is the part that gives way. */}
                  <span className="truncate font-serif text-base sm:text-lg">{selectedDateLabel}</span>
                  {selectedDate === todayStr && (
                    <span className="text-slate-400 text-sm flex-shrink-0">· Today</span>
                  )}
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
            {/* At 375px the count + all three pills need ~360px against 343px of
                available width, which used to clip "Unanalyzed" off-screen (wrapping
                fixed the clipping but still broke the single-row scan). Below `sm`,
                a native select replaces the pill row entirely instead. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <span className="text-slate-400 whitespace-nowrap">
                {visibleAnalyzedCount}/{countable.length} analyzed
              </span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as "all" | "analyzed" | "unanalyzed")}
                aria-label="Filter conversations by analysis status"
                className="sm:hidden min-h-[44px] rounded-full bg-slate-800 text-slate-200 px-4 pr-8 text-sm border-none focus-visible:outline-2"
              >
                <option value="all">All</option>
                <option value="analyzed">Analyzed</option>
                <option value="unanalyzed">Unanalyzed</option>
              </select>
              <div className="hidden sm:flex gap-1" role="radiogroup" aria-label="Filter conversations by analysis status">
                {(["all", "analyzed", "unanalyzed"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    {...rovingFilter(f)}
                    aria-label={`Show ${f} conversations`}
                    className={`px-4 py-2 min-h-[44px] rounded-full text-sm transition-colors ${
                      filter === f
                        // slate-950 on cyan-400 = 7.87:1; slate-300 on
                        // slate-800 = 8.35:1. Branches are mutually exclusive.
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
              <div className="flex items-center gap-2 flex-shrink-0">
                {unnamed.length > 0 && (
                  <button
                    onClick={runNaming}
                    disabled={naming}
                    aria-label={`Name ${unnamed.length} unnamed ${unnamed.length === 1 ? "conversation" : "conversations"}`}
                    className={BUTTON_SECONDARY}
                  >
                    <SparklesIcon className="w-3.5 h-3.5" />
                    {naming ? `Naming ${namingProgress.done}/${namingProgress.total}…` : `Name new (${unnamed.length})`}
                  </button>
                )}
                <button
                  onClick={() => setSelectMode(true)}
                  aria-label="Enable selection mode to analyze multiple conversations as a group"
                  className={BUTTON_SECONDARY}
                >
                  <SquareIcon className="w-3.5 h-3.5" />
                  Select &amp; Analyze Group
                </button>
              </div>
            ) : (
              <button
                onClick={exitSelectMode}
                aria-label="Cancel selection mode"
                className={`${BUTTON_SECONDARY} flex-shrink-0`}
              >
                <XIcon className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        )}

        {/* A count is enough here: a failed naming is retryable by pressing the
            button again, which re-targets exactly the still-unnamed rows. */}
        {!naming && namingFailed > 0 && (
          <p className="text-sm text-amber-300/90 mt-2" role="status">
            {namingFailed} {namingFailed === 1 ? "conversation" : "conversations"} could not be named — press Name new to retry.
          </p>
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
                  disabled={shown.length === 0}
                  aria-label={allFilteredSelected ? "Deselect all conversations in this view" : "Select all conversations in this view"}
                  className="text-sm min-h-[44px] bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-slate-200 px-4 py-2 rounded-lg transition-colors whitespace-nowrap"
                >
                  {allFilteredSelected ? "Deselect All" : "Select All"}
                </button>
                <button
                  onClick={() => selected.size > 0 && setSelectionListOpen((v) => !v)}
                  disabled={selected.size === 0}
                  aria-expanded={selectionListOpen}
                  aria-label={selected.size > 0 ? "Review selected conversations" : undefined}
                  className="text-sm text-slate-400 whitespace-nowrap enabled:hover:text-white enabled:hover:underline transition-colors disabled:cursor-default"
                >
                  <span aria-live="polite">
                    {selected.size} selected{selectedDaySpan > 1 ? " (across all days)" : ""}
                  </span>
                  {selected.size > 0 && (selectionListOpen ? " ▴" : " ▾")}
                </button>
              </div>
              {/* Replaces the action buttons rather than stacking beneath them — the
                  toolbar and the failure review are two different moments, and
                  showing both at once (up to 4 controls plus 2 more) blew past the
                  app's own low-cognitive-load principle. */}
              {!(batchFailures.length > 0 && !batchRunning) && (
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
                    onClick={requestBatchAdhd}
                    disabled={selected.size === 0 || batchRunning}
                    aria-label={`Run ADHD Aid on ${selected.size} conversations`}
                    className={TOOLBAR_ACTION_CLASS}
                  >
                    <ClipboardIcon className="w-4 h-4" />
                    {batchRunning ? `Running ${batchProgress.done}/${batchProgress.total}…` : `Run ADHD (${selected.size})`}
                  </button>
                </div>
              )}
            </div>
            {/* Selection review — opened from the count above so a cross-day, cross-search
                batch run is never a leap of faith. Each row can deselect individually. */}
            {selectionListOpen && selected.size > 0 && (
              <div className="enter-rise card mt-2 p-4" role="group" aria-label="Selected conversations">
                <ul className="space-y-1 text-sm">
                  {Array.from(selected).map((id) => (
                    <li key={id} className="flex items-center justify-between gap-2">
                      <span className="text-slate-300 truncate">{titleOf(id)}</span>
                      <button
                        onClick={() => toggleSelect(id)}
                        aria-label={`Deselect "${titleOf(id)}"`}
                        className="text-slate-400 hover:text-white min-h-[32px] min-w-[32px] flex items-center justify-center flex-shrink-0 rounded-md hover:bg-slate-700 transition-colors"
                      >
                        <XIcon className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!batchRunning && batchFailures.length > 0 && (
              <div className="enter-rise card mt-2 p-4 border-amber-500/30" role="status">
                <p className="text-amber-300/90 text-sm flex items-start gap-2">
                  <WarningIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    {batchFailures.length} of {batchProgress.total} could not be analyzed and{" "}
                    {batchFailures.length === 1 ? "was" : "were"} skipped:
                  </span>
                </p>
                <ul className="mt-2 ml-6 list-disc space-y-1 text-sm text-slate-300 marker:text-slate-500">
                  {batchFailures.map((f) => <li key={f.id}>{f.title}</li>)}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => executeBatchAdhd(batchFailures.map((f) => f.id))}
                    className="text-sm min-h-[44px] bg-slate-700 hover:bg-slate-600 text-slate-100 px-4 py-2 rounded-lg transition-colors"
                  >
                    Retry {batchFailures.length === 1 ? "it" : `these ${batchFailures.length}`}
                  </button>
                  <button
                    onClick={() => setBatchFailures([])}
                    className="text-sm min-h-[44px] text-slate-400 hover:text-white px-3 py-2 rounded-lg transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </header>

      {pendingBatch && (
        <ConfirmDialog
          title={`Replace ${pendingBatch.replacing} existing ${pendingBatch.replacing === 1 ? "analysis" : "analyses"}?`}
          body={
            <>
              {pendingBatch.replacing} of the {pendingBatch.ids.length} selected{" "}
              {pendingBatch.replacing === 1 ? "conversation has" : "conversations have"} already been analyzed with
              ADHD Aid. Running again replaces {pendingBatch.replacing === 1 ? "it" : "them"} — ADHD analyses keep no
              version history, so any commitments you have ticked off will reset.
            </>
          }
          confirmLabel={`Run all ${pendingBatch.ids.length}`}
          onConfirm={() => {
            const ids = pendingBatch.ids;
            setPendingBatch(null);
            executeBatchAdhd(ids);
          }}
          onCancel={() => setPendingBatch(null)}
        />
      )}

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
          <p className="text-slate-400 text-sm mt-2">Wear your pendant and have a conversation, then come back.</p>
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

      {!loading && visibleConversations.length > 0 && shown.length === 0 && ignored.length === 0 && (
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
              <div
                key={day}
                role={selectMode ? "group" : undefined}
                aria-label={selectMode ? formatDateTime(`${day}T12:00:00`, { weekday: "long", day: "numeric", month: "long" }) : undefined}
              >
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
                      enrichment={enrichments.get(convo.id)}
                      gist={gists.get(convo.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              </div>
            ))
          : shown.map((convo) => (
              <ConversationRow
                key={convo.id}
                convo={convo}
                selectMode={selectMode}
                isSelected={selected.has(convo.id)}
                isAnalyzed={analyzedIds.has(convo.id)}
                isAnalyzedEither={isAnalyzedEither(convo.id)}
                isAdhd={adhdIds.has(convo.id)}
                enrichment={enrichments.get(convo.id)}
                gist={gists.get(convo.id)}
                onToggleSelect={toggleSelect}
              />
            ))}
      </div>

      {/* Noise recordings, out of the way but never gone: every junk-flagged
          conversation stays listed here (kept ones included), so the verdict
          and the user's override are both reversible from the same place. */}
      {ignored.length > 0 && (
        <details className="mt-4 group">
          <summary className="cursor-pointer list-none text-sm text-slate-400 hover:text-slate-300 transition-colors min-h-[44px] flex items-center gap-1.5">
            <ChevronRightIcon className="w-3.5 h-3.5 flex-shrink-0 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] group-open:rotate-90" />
            Ignored ({ignored.length}) — noise recordings, kept out of the way
          </summary>
          <ul className="pl-5 pt-1 space-y-2">
            {ignored.map((convo) => {
              const e = enrichments.get(convo.id);
              const name = conversationTitle(convo, e, gists.get(convo.id));
              return (
                <li key={convo.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/conversation/${convo.id}`} className="min-w-0 text-slate-300 hover:text-white transition-colors">
                    <span className="block truncate">{name}</span>
                    <span className="block text-xs text-slate-500 truncate">
                      {e?.junkReason || "Marked as noise"}
                      {e ? ` · ${e.wordCount} ${e.wordCount === 1 ? "word" : "words"}` : ""}
                    </span>
                  </Link>
                  <button
                    onClick={() => {
                      const updated = toggleKeep(convo.id);
                      if (updated) setEnrichments((prev) => new Map(prev).set(convo.id, updated));
                    }}
                    aria-label={e?.keep ? `Ignore "${name}" again` : `Keep "${name}" in the list`}
                    className="flex-shrink-0 text-cyan-400 hover:underline min-h-[44px] px-2"
                  >
                    {e?.keep ? "Ignore again" : "Keep"}
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {/* Onboarding: About this framework — a quiet footnote at the end of the page */}
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
    </main>
  );
}

// useSearchParams (for the ?day= binding) opts this route into client-side
// rendering, which Next requires a Suspense boundary around. The fallback
// mirrors the in-component loading skeleton so the two are indistinguishable.
export default function Home() {
  return (
    <Suspense
      fallback={
        <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
          <div className="space-y-4" aria-label="Loading conversations" role="status">
            {[1, 2, 3].map((i) => <div key={i} className="skeleton h-24 w-full" />)}
          </div>
        </main>
      }
    >
      <HomeInner />
    </Suspense>
  );
}
