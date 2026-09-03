"use client";

import { Prose } from "@/components/Prose";
import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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
import {
  exportToObsidian,
  downloadMarkdown,
  exportAdhdToObsidian,
  downloadAdhdMarkdown,
} from "@/lib/obsidian";
import { cacheGet, cacheSet } from "@/lib/cache";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, dayOf } from "@/lib/format";
import { ThesisResults, type Analysis } from "@/components/ThesisResults";
import { AdhdResults } from "@/components/AdhdResults";
import type { AdhdAnalysis } from "@/lib/adhd";
import type { OmiGeolocation } from "@/lib/omi-api";
import { getAdhdAnalysis, saveAdhdAnalysis, toggleCommitmentDone } from "@/lib/adhd-storage";
import { getEnrichments } from "@/lib/enrich-storage";
import {
  RefreshIcon,
  ArrowLeftIcon,
  WarningIcon,
  CheckIcon,
  CompassIcon,
  ZapIcon,
  CogIcon,
  ClipboardIcon,
  FileTextIcon,
  DownloadIcon,
  ExternalLinkIcon,
  LoaderIcon,
} from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_GHOST, BUTTON_SECONDARY } from "@/lib/ui";
import ConfirmDialog from "@/components/ConfirmDialog";
import { pullAndMerge } from "@/lib/sync";
import { useRovingRadioGroup } from "@/lib/roving";
import { usePersistedPreference } from "@/lib/use-persisted-preference";
import { runExtraction, suggestFromAdhdPeople } from "@/lib/people-pipeline";
import dynamic from "next/dynamic";
import { type MapMarker } from "@/components/MeetingMap";

// Leaflet's JS was already deferred, but `import "leaflet/dist/leaflet.css"`
// at module scope pulled its stylesheet into this route's render-blocking CSS
// even though the map usually draws nothing here. Loading the component
// lazily moves both into a chunk that only arrives when a map actually renders.
const MeetingMap = dynamic(() => import("@/components/MeetingMap"), { ssr: false });
import MeetingLocationEditor from "@/components/MeetingLocationEditor";
import { getMeetingLocation } from "@/lib/meeting-location";
import { getPlace } from "@/lib/places";

const LENS_VALUES = ["thesis", "adhd", "both"] as const;
type Lens = (typeof LENS_VALUES)[number];

const isLens = (v: string): v is Lens => (LENS_VALUES as readonly string[]).includes(v);

function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m ? `${m}m ${String(r).padStart(2, "0")}s` : `${r}s`;
}

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
  geolocation?: OmiGeolocation | null;
}

// ── Components ──

// Renders the full transcript. Long text wraps (min-w-0 + break-words) instead
// of overflowing horizontally, and there is no inner scroll box — the whole
// transcript flows in the page so it scrolls naturally (never frozen on touch).
function TranscriptViewer({ segments }: { segments: TranscriptSegment[] }) {
  return (
    <div className="space-y-2">
      {segments.map((seg, i) => (
        <div key={i} className="flex flex-col sm:flex-row gap-0.5 sm:gap-3 text-sm">
          <span className="text-slate-400 font-mono flex-shrink-0 sm:w-20 sm:text-right">
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

function AnalysisAgeBadge({ timestamp }: { timestamp: string }) {
  const { label, isStale } = getAnalysisAge(timestamp);

  return (
    <span
      className={`font-mono text-xs px-2 py-0.5 rounded-full font-normal ${
        isStale
          ? "bg-amber-900/50 text-amber-300"
          : "bg-cyan-900/50 text-cyan-200"
      }`}
      title={`Analyzed on ${formatDateTime(timestamp, {
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })}`}
    >
      {isStale && <WarningIcon className="w-3 h-3 inline -mt-0.5 mr-0.5" />}
      {label}
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
      <summary className="p-4 cursor-pointer text-sm text-slate-400 hover:text-slate-200 transition-colors min-h-[44px] flex items-center gap-2">
        <ClipboardIcon className="w-4 h-4 flex-shrink-0" />
        Previous versions ({versions.length})
      </summary>
      <div className="px-4 pb-4 space-y-2">
        {versions.map((v, i) => (
          <button
            key={v.id}
            onClick={() => onSelect(v)}
            className="w-full text-left p-3 rounded-lg bg-slate-900 hover:bg-slate-700 transition-colors min-h-[44px]"
          >
            <div className="flex items-center justify-between">
              <span className="font-serif text-sm text-slate-300">
                Version {versions.length - i}
              </span>
              <span className="font-mono text-xs text-slate-400">{formatDateTime(v.timestamp)}</span>
            </div>
            <p className="font-serif italic text-xs text-slate-400 mt-1">Click to view this version</p>
          </button>
        ))}
      </div>
    </details>
  );
}

// ── Main Page ──

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  /* Lazy read, once: the enrichment title fills in when Omi returned no name,
     matching the home list. No setter — enrichment never changes on this page. */
  const [enrichedTitle] = useState<string | undefined>(() => getEnrichments().get(id)?.title);
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
  /* An analysis is a minute-scale, paid operation that used to run with a bare
     spinner and no way out. */
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [customAnalyzing, setCustomAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed per export target, not one shared flag: Obsidian and the .md
  // download are separate actions, and a single flag made clicking either one
  // flip *both* buttons to "Saved" — telling the user they'd done something
  // they hadn't.
  const [exported, setExported] = useState<Record<string, boolean>>({});
  const markExported = useCallback((key: string) => {
    setExported((prev) => ({ ...prev, [key]: true }));
    setTimeout(() => setExported((prev) => ({ ...prev, [key]: false })), 2000);
  }, []);
  const [customResult, setCustomResult] = useState<string | null>(null);
  const [showRerunConfirm, setShowRerunConfirm] = useState(false);
  const [showAdhdRerunConfirm, setShowAdhdRerunConfirm] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  // Bumped after a save so the override is re-read from localStorage; the
  // stored value is the source of truth, not a copy held in state.
  const [locationVersion, setLocationVersion] = useState(0);
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const scanForPeople = useCallback(async () => {
    setScanState("scanning");
    const res = await runExtraction(id, { force: true });
    setScanState("error" in res ? "error" : "done");
  }, [id]);

  /* The lens you last chose, remembered per device. This never overrides the
     "only one lens has results" case below — showing the thesis tab on a
     conversation that only has an ADHD analysis would be worse than any
     preference. It only settles the case where both are available, which
     previously always resolved to thesis and cost a tap on every visit. */
  const [lensPref, setLensPref] = usePersistedPreference<Lens>("omi-lens", "thesis", isLens);
  const [lens, setLens] = useState<Lens>("thesis");
  /* Applied separately from the load effect above, and once per conversation.
     The stored preference is read after mount (reading it during render would
     break hydration), so the load effect's first run still sees the fallback —
     applying it there would silently ignore the preference on every first
     load. Only relevant when both lenses have results; a conversation with
     just one is always shown on that one. */
  const lensAppliedFor = useRef<string | null>(null);
  /* A 404 from Omi is a different situation from an unreachable Omi, and the
     two need different copy and different affordances. `api-error.ts` already
     distinguishes them in the message it produces. */
  const isGone = !!error && /no longer exists on Omi/i.test(error);
  const rovingLens = useRovingRadioGroup(LENS_VALUES, lens, setLens);
  const [adhd, setAdhd] = useState<AdhdAnalysis | null>(null);
  const [adhdDoneKeys, setAdhdDoneKeys] = useState<string[]>([]);
  const [adhdTitle, setAdhdTitle] = useState<string | null>(null);
  const [adhdAnalyzing, setAdhdAnalyzing] = useState(false);

  // Results sections stagger in on first reveal, but the lens toggle
  // unmounts/remounts them as the user switches tabs — a frequent action
  // that must stay instant. These track which analysis object has already
  // played its entrance, set from the lens-switch click handler (not
  // during render) so re-mounts from switching tabs skip the replay.
  const [thesisSeen, setThesisSeen] = useState<Analysis | null>(null);
  const [adhdSeen, setAdhdSeen] = useState<AdhdAnalysis | null>(null);
  const animateThesis = analysis !== null && thesisSeen !== analysis;
  const animateAdhd = adhd !== null && adhdSeen !== adhd;

  // The location actually shown: a manual correction when one exists, else
  // whatever Omi reported, else nothing. Read from storage rather than state
  // so a correction made here and one pulled from another device agree.
  const effectiveLocation = useMemo(() => {
    if (typeof window === "undefined") return null;
    const override = getMeetingLocation(id);
    const place = override?.placeId ? getPlace(override.placeId) : null;
    const lat = override?.lat ?? conversation?.geolocation?.latitude;
    const lng = override?.lng ?? conversation?.geolocation?.longitude;
    if (lat == null || lng == null) return null;
    return {
      lat,
      lng,
      label:
        place?.name ||
        override?.placeName ||
        conversation?.geolocation?.address ||
        conversation?.geolocation?.location_type ||
        "",
      corrected: override != null,
    };
    // locationVersion re-reads storage after a save; it has no other use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, conversation, locationVersion]);

  // Load stored analysis (both lenses) + pick the default lens. Can't be a
  // lazy useState initializer: this must re-run whenever `id` changes
  // (navigating between conversations on the same mounted route), and
  // localStorage isn't available during the server-rendered first paint —
  // reading it before mount would cause a hydration mismatch.
  useEffect(() => {
    // Pull the durable store first: an analysis run on the user's other device
    // should show up here rather than offering to re-run something already
    // done. Re-reads local state only if the merge actually changed anything.
    pullAndMerge().then((changed) => {
      if (changed) loadStored();
    });
    loadStored();

    function loadStored() {
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

    const storedAdhd = getAdhdAnalysis(id);
    if (storedAdhd) {
      setAdhd(storedAdhd.analysis);
      setAdhdDoneKeys(storedAdhd.doneKeys);
      // Kept so the degraded view has a real title when the shell can't load.
      setAdhdTitle(storedAdhd.title);
    }
    // Default lens: the single lens that has results wins outright; when both
    // are present (or neither), fall back to the remembered preference.
    const hasThesis = !!stored;
    const hasAdhd = !!storedAdhd;
    if (hasAdhd && !hasThesis) setLens("adhd");
    else if (hasThesis && !hasAdhd) setLens("thesis");
    else setLens("thesis");
    }
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
      const data = await fetchJson<Conversation>(
        `/api/conversations/${encodeURIComponent(id)}`,
        mode === "refresh" ? { cache: "no-store" } : undefined
      );
      setConversation(data);
      setError(null);
      setLastSynced(new Date().toISOString());
      if (data.transcript_segments?.length) cacheSet(cacheKey, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reach Omi");
    } finally {
      if (mode === "initial") setLoading(false);
      else setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    // loadConversation's cache-hit branch calls setState synchronously
    // (before any await), which is what the lint rule is catching here —
    // the fetch-on-mount itself is the intended pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversation("initial");
  }, [loadConversation]);

  useEffect(() => {
    if (!analysis || !adhd) return;
    if (lensAppliedFor.current === id) return;
    lensAppliedFor.current = id;
    setLens(lensPref);
  }, [analysis, adhd, lensPref, id]);

  useEffect(() => {
    if (startedAt === null) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [startedAt]);

  const executeAnalysis = useCallback(async () => {
    setAnalyzing(true);
    setStartedAt(Date.now());
    setElapsed(0);
    setError(null);
    setViewingVersion(null);
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    try {
      const data = await fetchJson<{ analysis: Analysis; conversation?: Conversation }>("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
        signal: controller.signal,
      });
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
      void runExtraction(id).catch(() => {});
      // Tuck the verification/custom cards away now that results are up.
      setTranscriptOpen(false);
      setShowCustom(false);
    } catch (e) {
      // A deliberate stop is not an error and gets no error card.
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        setError(e instanceof Error ? e.message : "Analysis failed");
      }
    } finally {
      setAnalyzing(false);
      setStartedAt(null);
      analysisAbortRef.current = null;
      setShowRerunConfirm(false);
    }
  }, [id, conversation]);

  const stopAnalysis = useCallback(() => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setAnalyzing(false);
    setStartedAt(null);
  }, []);

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
      const data = await fetchJson<{ result: string }>("/api/analyze/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, prompt: customPrompt }),
      });
      const custom = { prompt: customPrompt, result: data.result };
      saveCustomAnalysis(id, custom);
      setCustomResult(data.result);
      setStoredAnalysis((prev) =>
        prev ? { ...prev, custom: { ...custom, timestamp: new Date().toISOString() } } : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Custom analysis failed");
    } finally {
      setCustomAnalyzing(false);
    }
  }, [id, customPrompt]);

  const handleExportObsidian = useCallback(() => {
    if (!storedAnalysis) return;
    const { uri, uriTooLong } = exportToObsidian(storedAnalysis);
    if (uriTooLong) {
      // The OS may silently drop very long obsidian:// URIs — deliver the
      // same note as a file download instead.
      downloadMarkdown(storedAnalysis);
    } else {
      window.open(uri, "_blank");
    }
    markExported("thesis-obsidian");
  }, [storedAnalysis, markExported]);

  const handleDownload = useCallback(() => {
    if (!storedAnalysis) return;
    downloadMarkdown(storedAnalysis);
    markExported("thesis-download");
  }, [storedAnalysis, markExported]);

  const executeAdhd = useCallback(async () => {
    setAdhdAnalyzing(true);
    setError(null);
    try {
      const data = await fetchJson<{ analysis: AdhdAnalysis; conversation?: Conversation }>("/api/analyze-adhd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id }),
      });
      setAdhd(data.analysis);
      if (data.conversation?.transcript_segments?.length) {
        setConversation(data.conversation);
        cacheSet(`conversation:${id}`, data.conversation);
      }
      const stored = saveAdhdAnalysis({
        conversationId: id,
        title: data.conversation?.structured?.title || conversation?.structured?.title || "Untitled",
        date: data.conversation?.created_at || conversation?.created_at,
        analysis: data.analysis,
      });
      setAdhdDoneKeys(stored.doneKeys);
      // People come from this lens's own output — no second transcript pass.
      // See suggestFromAdhdPeople for why runExtraction isn't called here.
      const adhdDate = data.conversation?.created_at || conversation?.created_at;
      if (adhdDate) {
        const geo = (data.conversation as { geolocation?: OmiGeolocation } | undefined)?.geolocation;
        suggestFromAdhdPeople(id, adhdDate, data.analysis.people, geo);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "ADHD analysis failed");
    } finally {
      setAdhdAnalyzing(false);
    }
  }, [id, conversation]);

  const handleToggleDone = useCallback((key: string) => {
    setAdhdDoneKeys(toggleCommitmentDone(id, key));
  }, [id]);

  const handleAdhdExport = useCallback(() => {
    const stored = getAdhdAnalysis(id);
    if (!stored) return;
    const { uri, uriTooLong } = exportAdhdToObsidian(stored);
    if (uriTooLong) downloadAdhdMarkdown(stored);
    else window.open(uri, "_blank");
    markExported("adhd-obsidian");
  }, [id, markExported]);

  const handleAdhdDownload = useCallback(() => {
    const stored = getAdhdAnalysis(id);
    if (!stored) return;
    downloadAdhdMarkdown(stored);
    markExported("adhd-download");
  }, [id, markExported]);

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

  // Carry the day back: a bare "/" resets the list to today, so returning
  // from a conversation browsed on another day dumped the user on an
  // unrelated (often empty) view. The conversation's own date is the right
  // target even when it was reached via cross-day search.
  const backHref = conversation ? `/?day=${dayOf(conversation.created_at)}` : "/";

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <Link href={backHref} className="text-slate-400 hover:text-white text-sm inline-flex items-center gap-1.5 min-h-[44px] py-2">
          <ArrowLeftIcon className="w-4 h-4" />
          Back to conversations
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400" aria-live="polite">
            {refreshing ? "Refreshing…" : lastSynced ? `Synced ${getAnalysisAge(lastSynced).label}` : ""}
          </span>
          {/* Both of these need the conversation to still exist on Omi. Leaving
              them enabled on a 404 offers the user two actions that cannot
              succeed, which is worse than offering none. */}
          {!isGone && (
          <button
            onClick={() => loadConversation("refresh")}
            disabled={loading || refreshing}
            aria-label="Refresh this conversation and transcript from Omi"
            className={`${BUTTON_GHOST} flex-shrink-0`}
          >
            <RefreshIcon className={`w-4 h-4 flex-shrink-0 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
          )}
          {isGone ? null : scanState === "done" ? (
            <Link
              href="/people"
              className="text-sm min-h-[44px] px-3 py-2 rounded-lg text-cyan-300 hover:text-cyan-200 hover:bg-slate-800 transition-colors flex items-center"
            >
              Review suggestions →
            </Link>
          ) : scanState === "error" ? (
            <button
              onClick={scanForPeople}
              className="text-sm min-h-[44px] px-3 py-2 rounded-lg text-amber-300 hover:text-amber-200 hover:bg-slate-800 transition-colors"
            >
              Scan failed — tap to retry
            </button>
          ) : (
            <button
              onClick={scanForPeople}
              disabled={scanState === "scanning"}
              aria-label="Scan this conversation for people"
              className={BUTTON_GHOST}
            >
              {scanState === "scanning" ? "Scanning…" : "Scan for people"}
            </button>
          )}
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

      {/* The whole page used to be gated on `conversation`, so when Omi was
          unreachable and nothing was cached the route rendered an error card
          and literally nothing else — no h1, no title, no recovery path — even
          though an analysis for this conversation was sitting in local
          storage. That contradicts the app's own promise that the browser is
          the working copy. The saved analysis is shown on its own terms
          instead, with the missing shell named rather than implied. */}
      {!loading && !conversation && (storedAnalysis || adhd) && (
        <>
          <header className="mb-6">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
              Saved copy
            </p>
            <h1 className="font-bold text-white mb-2">
              {storedAnalysis?.title || adhdTitle || "Saved analysis"}
            </h1>
            <p className="text-slate-400 font-serif italic text-[0.95rem]">
              Couldn&apos;t reach Omi, so the recording and transcript aren&apos;t available. This is the
              analysis already saved on this device.
            </p>
          </header>

          {storedAnalysis && (
            <section className="mb-8" aria-label="Saved Pioneer Sovereignty analysis">
              <h2 className="font-bold text-white mb-4 flex items-center gap-2">
                <CompassIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                Pioneer Sovereignty Analysis
              </h2>
              <ThesisResults analysis={storedAnalysis} animate={false} />
            </section>
          )}

          {adhd && (
            <section className="mb-8" aria-label="Saved ADHD Aid analysis">
              <h2 className="font-bold text-white mb-4 flex items-center gap-2">
                <ZapIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                ADHD Aid
              </h2>
              <AdhdResults
                analysis={adhd}
                doneKeys={adhdDoneKeys}
                onToggleDone={handleToggleDone}
                animate={false}
              />
            </section>
          )}
        </>
      )}

      {/* Nothing cached and nothing saved — say what to do next rather than
          leaving a bare error card with no heading. */}
      {!loading && !conversation && !storedAnalysis && !adhd && (
        <header className="mb-6">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
            Unavailable
          </p>
          {/* The body used to assert "Omi couldn't be reached" regardless of
              why. When the cause is a 404 the banner above simultaneously says
              the conversation was deleted — two different diagnoses on one
              screen — and Refresh is offered for something no amount of
              retrying will fix. The copy follows the actual cause now. */}
          <h1 className="font-bold text-white mb-2">
            {isGone ? "Conversation deleted" : "Conversation unavailable"}
          </h1>
          <p className="text-slate-400 font-serif italic text-[0.95rem]">
            {isGone
              ? "Omi no longer has this conversation, so there's nothing left to fetch. Any analysis you already saved for it would appear here — there isn't one."
              : "This conversation isn't cached on this device and Omi couldn't be reached. Try Refresh above, or go back to the list."}
          </p>
        </header>
      )}

      {conversation && (
        <>
          <header className="mb-6">
            <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
              {conversation.structured?.category || "Entry"}
            </p>
            <h1 className="font-bold text-white mb-2">
              <span aria-hidden="true">{conversation.structured?.emoji || "💬"}</span>{" "}
              {conversation.structured?.title || enrichedTitle || "Untitled"}
            </h1>
            {conversation.structured?.overview && (
              <p className="text-slate-400 font-serif italic text-[0.95rem]">{conversation.structured.overview}</p>
            )}
            <p className="text-slate-400 text-sm mt-2 font-mono">
              {formatDateTime(conversation.created_at, {
                weekday: "long", day: "numeric", month: "long", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </p>
          </header>

          {/* Where it happened. Omi attaches coordinates to only some
              recordings, and the ones it does attach can sit far enough from
              the real spot to break place resolution — so this section is
              always present and always editable, showing either the map or an
              invitation to add the location that's missing. */}
          <section className="mb-6" aria-label="Where this conversation happened">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
                Location
              </p>
              {!editingLocation && (
                <button
                  onClick={() => setEditingLocation(true)}
                  className="text-sm text-cyan-400 hover:text-cyan-300 min-h-[44px] px-2 transition-colors"
                >
                  {effectiveLocation ? "Edit location" : "Add location"}
                </button>
              )}
            </div>

            {effectiveLocation ? (
              <>
                {effectiveLocation.label && (
                  <p className="text-slate-400 font-serif italic text-sm mb-2">
                    {effectiveLocation.label}
                    {effectiveLocation.corrected && (
                      <span className="not-italic font-mono text-xs text-slate-400"> · corrected</span>
                    )}
                  </p>
                )}
                <MeetingMap
                  markers={
                    [
                      {
                        lat: effectiveLocation.lat,
                        lng: effectiveLocation.lng,
                        label: conversation.structured?.title || enrichedTitle || "This conversation",
                        sublabel: effectiveLocation.label || undefined,
                      },
                    ] satisfies MapMarker[]
                  }
                />
              </>
            ) : (
              !editingLocation && (
                <p className="text-slate-400 font-serif italic text-sm">
                  This recording arrived without a location.
                </p>
              )
            )}

            {editingLocation && (
              <MeetingLocationEditor
                conversationId={id}
                omiLat={conversation.geolocation?.latitude ?? undefined}
                omiLng={conversation.geolocation?.longitude ?? undefined}
                omiPlaceName={
                  conversation.geolocation?.address ||
                  conversation.geolocation?.location_type ||
                  undefined
                }
                onSaved={() => {
                  setEditingLocation(false);
                  setLocationVersion((v) => v + 1);
                }}
                onCancel={() => setEditingLocation(false)}
              />
            )}
          </section>

          {/* Lens toggle */}
          <div className="flex gap-1 mb-6 p-1 bg-slate-900 rounded-lg w-fit" role="radiogroup" aria-label="Analysis lens">
            {(["thesis", "adhd", "both"] as const).map((l) => (
              <button
                key={l}
                onClick={() => {
                  // Mark whatever is currently showing as "seen" before switching,
                  // so flipping back to this lens later reveals it instantly instead
                  // of replaying the entrance stagger.
                  if (analysis) setThesisSeen(analysis);
                  if (adhd) setAdhdSeen(adhd);
                  setLens(l);
                  setLensPref(l);
                }}
                {...rovingLens(l)}
                className={`px-4 py-2 min-h-[44px] rounded-md text-sm transition-colors ${
                  // False positive below: the scanner pairs the unselected branch's text-slate-300
                  // with the selected branch's bg-cyan-400, but the two are mutually exclusive.
                  // Real pairs, both verified: slate-950/cyan-400 (7.87:1) and slate-300/slate-900
                  // (11.35:1) — the unselected pill has no fill and sits on the toggle's own track.
                  lens === l ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:text-white" // impeccable-disable-line gray-on-color
                }`}
              >
                {l === "thesis" ? "Thesis" : l === "adhd" ? "ADHD Aid" : "Both"}
              </button>
            ))}
          </div>

          {/* Analyze button */}
          {(lens === "thesis" || lens === "both") && !analysis && (
            <div className="mb-8">
              <button
                onClick={handleAnalyzeClick}
                disabled={analyzing}
                aria-label="Run Pioneer Sovereignty analysis on this conversation"
                className="w-full card p-6 text-center hover:border-cyan-500/50 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
              >
                {analyzing ? (
                  <div className="flex items-center justify-center gap-3">
                    <LoaderIcon className="w-6 h-6 text-cyan-400 animate-spin flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-white">
                        Analyzing conversation…{elapsed > 0 && <span className="font-mono text-sm text-slate-400"> {fmtElapsed(elapsed)}</span>}
                      </p>
                      <p className="text-slate-400 font-serif italic text-sm mt-1">Running 8-dimension Pioneer Sovereignty analysis</p>
                    </div>
                  </div>
                ) : (
                  <div>
                    <CompassIcon className="w-7 h-7 mx-auto mb-2 text-cyan-400" />
                    <p className="font-semibold text-white">Run Pioneer Sovereignty Analysis</p>
                    <p className="text-slate-400 font-serif italic text-sm mt-1">4 research questions + conditions + rival hypothesis + refutation</p>
                    {/* Cost and duration were stated nowhere before the spend. */}
                    <p className="text-slate-400 font-mono text-xs mt-2">1 API call · usually under a minute</p>
                  </div>
                )}
              </button>
              {analyzing && (
                <button
                  onClick={stopAnalysis}
                  className="mt-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors"
                >
                  Stop
                </button>
              )}
            </div>
          )}

          {/* Analysis results */}
          {(lens === "thesis" || lens === "both") && analysis && (
            <section className="mb-8" aria-label="Pioneer Sovereignty analysis results">
              <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
                <h2 className="font-bold text-white flex items-center gap-2 flex-wrap">
                  <CompassIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                  Pioneer Sovereignty Analysis
                  {storedAnalysis && (
                    <AnalysisAgeBadge timestamp={storedAnalysis.timestamp} />
                  )}
                  {viewingVersion && (
                    <span className="text-xs bg-rose-900/50 text-rose-300 px-2 py-0.5 rounded-full font-normal">
                      viewing previous version
                    </span>
                  )}
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  {viewingVersion && (
                    <button
                      onClick={viewCurrent}
                      aria-label="Return to current analysis"
                      className={`${BUTTON_SECONDARY} whitespace-nowrap`}
                    >
                      <ArrowLeftIcon className="w-3.5 h-3.5" />
                      Current
                    </button>
                  )}
                  {storedAnalysis && !viewingVersion && (
                    <>
                      <button
                        onClick={handleExportObsidian}
                        aria-label="Export analysis to Obsidian vault"
                        className={`${BUTTON_SECONDARY} whitespace-nowrap`}
                      >
                        <span key={exported["thesis-obsidian"] ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                          {exported["thesis-obsidian"] ? (
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
                        onClick={handleDownload}
                        aria-label="Download analysis as markdown file"
                        className={`${BUTTON_SECONDARY} whitespace-nowrap`}
                      >
                        <span key={exported["thesis-download"] ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                          {exported["thesis-download"] ? (
                            <>
                              <CheckIcon className="w-3.5 h-3.5" />
                              Saved
                            </>
                          ) : (
                            <>
                              <DownloadIcon className="w-3.5 h-3.5" />
                              Download .md
                            </>
                          )}
                        </span>
                      </button>
                    </>
                  )}
                  {!viewingVersion && (
                    <button
                      onClick={handleAnalyzeClick}
                      disabled={analyzing}
                      aria-label="Re-run analysis"
                      className="text-slate-400 hover:text-cyan-400 disabled:opacity-50 transition-colors p-2 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      <RefreshIcon className={`w-4 h-4 ${analyzing ? "animate-spin" : ""}`} />
                    </button>
                  )}
                </div>
              </div>
              {analysis && <ThesisResults analysis={analysis} animate={animateThesis} />}

              {/* Version history */}
              {!viewingVersion && (
                <VersionHistory versions={versions} onSelect={viewVersion} />
              )}
            </section>
          )}

          {/* ADHD Aid results */}
          {(lens === "adhd" || lens === "both") && (
            <section className="mb-8" aria-label="ADHD Aid analysis">
              {!adhd && (
                <button
                  onClick={executeAdhd}
                  disabled={adhdAnalyzing}
                  aria-label="Run ADHD Aid analysis on this conversation"
                  className="w-full card p-6 text-center hover:border-cyan-500/50 transition-colors cursor-pointer disabled:opacity-50 mb-6 min-h-[44px]"
                >
                  {adhdAnalyzing ? (
                    <div className="flex items-center justify-center gap-3">
                      <LoaderIcon className="w-6 h-6 text-cyan-400 animate-spin flex-shrink-0" />
                      <p className="font-semibold text-white">Running ADHD Aid…</p>
                    </div>
                  ) : (
                    <div>
                      <ClipboardIcon className="w-7 h-7 mx-auto mb-2 text-cyan-400" />
                      <p className="font-semibold text-white">Run ADHD Aid</p>
                      <p className="text-slate-400 font-serif italic text-sm mt-1">Commitments, people, open loops, and next actions</p>
                    </div>
                  )}
                </button>
              )}
              {adhd && (
                <>
                  <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
                    <h2 className="font-bold text-white flex items-center gap-2">
                      <ClipboardIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
                      ADHD Aid
                    </h2>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={handleAdhdExport} className={`${BUTTON_SECONDARY} whitespace-nowrap`}>
                        <span key={exported["adhd-obsidian"] ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                          {exported["adhd-obsidian"] ? (
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
                      <button onClick={handleAdhdDownload} className={`${BUTTON_SECONDARY} whitespace-nowrap`}>
                        <span key={exported["adhd-download"] ? "saved" : "idle"} className="label-swap inline-flex items-center gap-1.5">
                          {exported["adhd-download"] ? (
                            <>
                              <CheckIcon className="w-3.5 h-3.5" />
                              Saved
                            </>
                          ) : (
                            <>
                              <DownloadIcon className="w-3.5 h-3.5" />
                              Download .md
                            </>
                          )}
                        </span>
                      </button>
                      <button onClick={() => setShowAdhdRerunConfirm(true)} disabled={adhdAnalyzing} aria-label="Re-run ADHD Aid" className="text-slate-400 hover:text-cyan-400 disabled:opacity-50 transition-colors p-2 min-h-[44px] min-w-[44px] flex items-center justify-center">
                        <RefreshIcon className={`w-4 h-4 ${adhdAnalyzing ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                  </div>
                  <AdhdResults analysis={adhd} doneKeys={adhdDoneKeys} onToggleDone={handleToggleDone} animate={animateAdhd} />
                </>
              )}
            </section>
          )}

          {/* Re-run confirmation dialogs. Both lenses are guarded, but they
              carry different stakes: thesis keeps 3 versions, ADHD keeps none,
              so the ADHD copy has to say what is actually lost. */}
          {showRerunConfirm && storedAnalysis && (
            <ConfirmDialog
              title="Replace existing analysis?"
              body={
                <>
                  This conversation was last analyzed{" "}
                  <strong className="text-slate-200">{getAnalysisAge(storedAnalysis.timestamp).label}</strong>.
                  Re-running will replace the current analysis. A copy will be saved in version history
                  (last 3 versions kept).
                </>
              }
              confirmLabel="Re-analyze"
              onConfirm={() => {
                setShowRerunConfirm(false);
                executeAnalysis();
              }}
              onCancel={() => setShowRerunConfirm(false)}
            />
          )}

          {showAdhdRerunConfirm && adhd && (
            <ConfirmDialog
              title="Replace this ADHD Aid analysis?"
              tone="danger"
              body={
                <>
                  ADHD Aid analyses keep no version history, so the current one will be gone. Any commitments
                  you have ticked off will reset to unchecked.
                </>
              }
              confirmLabel="Replace it"
              onConfirm={() => {
                setShowAdhdRerunConfirm(false);
                executeAdhd();
              }}
              onCancel={() => setShowAdhdRerunConfirm(false)}
            />
          )}

          {/* Custom analysis — collapsed by default; auto-collapses after an
              analysis runs so it tucks away without disappearing. Thesis lens
              only (not "both"): the free-prompt card frames every question
              through Pioneer Sovereignty, which has no business on a page the
              user opened for executive-function output. */}
          {lens === "thesis" && (
          <section className="mb-8" aria-label="Custom analysis">
            <button
              onClick={() => setShowCustom(!showCustom)}
              aria-expanded={showCustom}
              aria-controls="custom-analysis-panel"
              className="w-full card p-5 text-left hover:border-amber-500/50 transition-colors cursor-pointer flex items-center justify-between min-h-[44px]"
            >
              <div className="flex items-center gap-3">
                <CogIcon className="w-5 h-5 text-slate-400 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-white">Custom Analysis</p>
                  <p className="text-slate-400 font-serif italic text-sm">
                    {customResult
                      ? `Last: "${customPrompt.length > 50 ? `${customPrompt.substring(0, 50)}…` : customPrompt}"`
                      : "Ask any question about this conversation through the lens of Pioneer Sovereignty"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {customResult && <span className="text-xs bg-amber-900/40 text-amber-200 px-2 py-0.5 rounded-full">saved</span>}
                <svg
                  className={`w-5 h-5 text-slate-400 transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${showCustom ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {showCustom && (
              <div id="custom-analysis-panel" className="enter-rise card mt-2 p-6 border-amber-500/30">
                <label className="block mb-3">
                  <span className="text-sm font-medium text-slate-300 mb-2 block">What do you want to explore?</span>
                  <textarea
                    value={customPrompt}
                    onChange={(e) => setCustomPrompt(e.target.value)}
                    placeholder="e.g., Does the double erasure appear here? Is this public or intimate register? What would Rifkin's 'settler common sense' say?"
                    aria-label="Custom analysis question"
                    maxLength={2000}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 placeholder-slate-400 focus:border-amber-500 focus:outline-none resize-none"
                    rows={3}
                  />
                  <div className="text-xs text-slate-400 text-right mt-1">{customPrompt.length}/2000</div>
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
                      className="text-sm bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white px-3 py-2 min-h-[44px] rounded-md transition-colors"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <button
                  onClick={runCustomAnalysis}
                  disabled={customAnalyzing || !customPrompt.trim()}
                  aria-label="Run custom analysis"
                  className={`${BUTTON_PRIMARY} px-5`}
                >
                  {customAnalyzing ? (
                    <span className="flex items-center gap-2">
                      <LoaderIcon className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </span>
                  ) : (
                    "Run Custom Analysis"
                  )}
                </button>
              </div>
            )}

            {customResult && (
              <div className="card mt-2 p-6 border-amber-500/30">
                <div className="analysis-section" style={{ background: "var(--custom-analysis-bg, rgba(245, 158, 11, 0.06))" }}>
                  <h3 className="flex items-center gap-2" style={{ color: "var(--custom-analysis-text)" }}>
                    <CogIcon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
                    Custom Analysis
                  </h3>
                  <p className="text-xs text-slate-400 mb-1">Prompt: &ldquo;{customPrompt}&rdquo;</p>
                  <Prose text={customResult} className="text-sm leading-relaxed mt-3" />
                </div>
              </div>
            )}
          </section>
          )}

          {/* Transcript — collapsed by default; auto-collapses after an
              analysis runs. Expands to the full, page-scrollable transcript. */}
          {conversation.transcript_segments && conversation.transcript_segments.length > 0 && (
            <details
              className="card"
              open={transcriptOpen}
              onToggle={(e) => setTranscriptOpen(e.currentTarget.open)}
            >
              <summary className="p-5 cursor-pointer font-semibold text-white hover:text-cyan-300 transition-colors min-h-[44px] flex items-center gap-2">
                <FileTextIcon className="w-4 h-4 flex-shrink-0" />
                Transcript ({conversation.transcript_segments.length} segments)
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
