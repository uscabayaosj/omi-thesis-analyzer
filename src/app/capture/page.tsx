"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime, formatTime } from "@/lib/format";
import { ArrowLeftIcon, RefreshIcon } from "@/components/icons";
import { BUTTON_GHOST, BUTTON_SECONDARY } from "@/lib/ui";
import { describeClose } from "@/components/CaptureBanner";

interface Status {
  configured: boolean;
  /** Deployment self-checks: the WASM Opus decoder and the native
   *  onnxruntime binding — the two dependencies that can silently go missing
   *  from a function bundle. "ok", or the failure text. */
  decoder?: string;
  onnxruntime?: string;
  lastChunkAt?: string | null;
  open?: { id: string; deviceId: string; startedAt: string; lastSpeechAt: string; voicedMs: number }[];
  byStatus7d?: Record<string, number>;
  failed?: { id: string; startedAt: string; error: string; attempts: number }[];
  /** Newest chunks with their level percentiles — the VAD tuning readout the
   *  route has always returned and this page never showed. */
  recentChunks?: { startedAt: string; durationMs: number; voicedMs: number; p10: number | null; p50: number | null; p90: number | null }[];
  error?: string;
}

interface Outcome {
  transcribed?: number;
  discarded?: number;
  failed?: number;
}

const dbfs = (v: number | null) => (v == null ? "—" : `${Math.round(v)} dB`);

const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;

/** Plain words for session states — the raw status values are system vocabulary. */
const STATUS_LABEL: Record<string, string> = {
  open: "in progress",
  transcribing: "being transcribed",
  done: "transcribed",
  discarded: "too short to keep",
  failed: "needing attention",
};

export default function CapturePage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"refresh" | "end" | "retry" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // No synchronous setState in the effect body: state changes only land after
  // the fetch resolves, which is the subscribe-then-update shape React wants.
  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await fetchJson<Status>("/api/capture/status", { cache: "no-store" }));
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not read capture status.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: a fetch on mount; every setState lands after the await, not in the effect body
    void fetchStatus();
  }, [fetchStatus]);

  const load = async () => {
    setBusy("refresh");
    await fetchStatus();
    setBusy(null);
  };

  // The same "End conversation now" the home banner offers. This page showed
  // an in-progress session and gave no way to act on it.
  const endNow = async () => {
    setBusy("end");
    setNote(null);
    try {
      const r = await fetchJson<{ closed: string[] } & Outcome>("/api/capture/close", { method: "POST" });
      await fetchStatus();
      setNote(describeClose(r));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not end the conversation.");
    } finally {
      setBusy(null);
    }
  };

  // A failed transcription used to wait for the daily sweep and be abandoned
  // after three tries, with nothing here able to touch it.
  const retryFailed = async () => {
    setBusy("retry");
    setNote(null);
    try {
      const r = await fetchJson<{ retried: string[] } & Outcome>("/api/capture/retry", { method: "POST" });
      await fetchStatus();
      if (r.retried.length === 0) setNote("Nothing needed retrying.");
      else {
        const parts: string[] = [];
        if (r.transcribed) parts.push(`${r.transcribed} transcribed`);
        if (r.discarded) parts.push(`${r.discarded} too short to keep`);
        if (r.failed) parts.push(`${r.failed} still failing`);
        setNote(`Retried ${r.retried.length}: ${parts.join(", ") || "done"}.`);
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not retry.");
    } finally {
      setBusy(null);
    }
  };


  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={BUTTON_GHOST}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>
      <p className="mt-6 mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">System</p>
      <h1 className="font-bold text-white mb-4">Capture</h1>

      {/* The old copy read "The store isn't configured here, so there is
          nothing to show." — a bare sentence, no card, no next step, and "the
          store" appears nowhere else in the UI. On a passive-capture product
          this is the screen that answers "is my pendant recording?", so
          answering it with an unnamed service's configuration state is the
          worst possible dead end: the user cannot tell whether recording is
          quietly working, quietly broken, or simply not set up here. Says which
          it is now, and where recordings still are. */}
      {status && !status.configured && (
        <div className="card p-6 space-y-3">
          <p className="text-slate-100 font-semibold">Nothing is being recorded on this device.</p>
          <p className="text-slate-300 text-sm">
            Capture runs on the deployed app, where the recording store lives. This copy of TRACE
            isn&apos;t connected to it, so it has no sessions to report — that&apos;s expected on a local
            or preview build, and nothing has been lost.
          </p>
          <p className="text-slate-300 text-sm">
            Conversations already recorded and transcribed are on the{" "}
            <Link href="/" className="text-cyan-400 hover:underline">conversations list</Link> as usual.
          </p>
        </div>
      )}

      {/* A failed read used to leave this page as a bare heading: the note was
          rendered only inside the configured branch, which never appears when
          the fetch is what failed. */}
      {!status && note && (
        <div className="card p-6 border-red-500/50" role="alert">
          <p className="text-red-400 break-words">{note}</p>
          <button onClick={load} disabled={busy !== null} className={`${BUTTON_GHOST} mt-3 -ml-3`}>
            <RefreshIcon className={`w-4 h-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
            Try again
          </button>
        </div>
      )}

      {!status && !note && (
        <p className="text-slate-400 text-sm font-mono" role="status">Loading…</p>
      )}

      {status?.configured && (
        <div className="space-y-4">
          <div className="card p-4">
            <p className="text-slate-300">
              Last chunk received:{" "}
              <span className="font-mono">{status.lastChunkAt ? formatDateTime(status.lastChunkAt) : "never"}</span>
            </p>
            {(status.open ?? []).length === 0 ? (
              <p className="text-slate-400 text-sm mt-1">No conversation in progress.</p>
            ) : (
              <>
                {status.open!.map((o) => (
                  <p key={o.id} className="text-slate-400 text-sm mt-1">
                    In progress since {formatDateTime(o.startedAt)} — {minutes(o.voicedMs)} of speech, last heard{" "}
                    {formatDateTime(o.lastSpeechAt)}.
                  </p>
                ))}
                <button onClick={endNow} disabled={busy !== null} className={`${BUTTON_SECONDARY} mt-3`}>
                  {busy === "end" ? "Ending…" : "End conversation now"}
                </button>
              </>
            )}
          </div>

          <div className="card p-4">
            <p className="text-slate-300 mb-2">Last 7 days</p>
            <ul className="text-sm text-slate-400 space-y-1">
              {Object.entries(status.byStatus7d ?? {}).map(([k, n]) => (
                <li key={k}>
                  <span className="font-mono">{n}</span> {STATUS_LABEL[k] ?? k}
                </li>
              ))}
              {Object.keys(status.byStatus7d ?? {}).length === 0 && <li>Nothing captured yet.</li>}
            </ul>
          </div>

          {(status.failed ?? []).length > 0 && (
            <div className="card p-4 border-amber-500/30">
              <p className="text-amber-300/90 mb-2">Needs attention</p>
              <ul className="text-sm text-slate-300 space-y-2">
                {status.failed!.map((f) => (
                  <li key={f.id}>
                    <span className="font-mono text-xs text-slate-400">
                      {formatDateTime(f.startedAt)} · {f.attempts} {f.attempts === 1 ? "try" : "tries"}
                    </span>
                    <span className="block break-words">{f.error}</span>
                  </li>
                ))}
              </ul>
              <button onClick={retryFailed} disabled={busy !== null} className={`${BUTTON_SECONDARY} mt-3`}>
                <RefreshIcon className={`w-4 h-4 ${busy === "retry" ? "animate-spin" : ""}`} />
                {busy === "retry" ? "Retrying…" : `Retry ${status.failed!.length === 1 ? "it" : "all"} now`}
              </button>
              <p className="text-xs text-slate-400 mt-2">
                Each retry is another transcription call. The nightly sweep also retries, up to three times per recording.
              </p>
            </div>
          )}

          {(status.recentChunks ?? []).length > 0 && (
            <div className="card p-4">
              <p className="text-slate-300 mb-1">Recent audio</p>
              <p className="text-xs text-slate-400 mb-2">
                The last few 30-second chunks: how much of each was speech, and its quiet / typical / loud levels.
                Speech being missed or noise being kept is tuned with <span className="font-mono">CAPTURE_VAD_DBFS</span>.
              </p>
              <ul className="text-sm text-slate-400 space-y-1 font-mono">
                {status.recentChunks!.map((c, i) => (
                  <li key={`${c.startedAt}-${i}`} className="flex flex-wrap gap-x-3">
                    <span>{formatTime(c.startedAt)}</span>
                    <span>{Math.round(c.voicedMs / 1000)}s / {Math.round(c.durationMs / 1000)}s speech</span>
                    <span>{dbfs(c.p10)} · {dbfs(c.p50)} · {dbfs(c.p90)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(status.decoder || status.onnxruntime) && (
            <div className="card p-4">
              <p className="text-slate-300 mb-2">Deployment checks</p>
              <ul className="text-sm text-slate-400 space-y-1">
                {(
                  [
                    ["Opus decoder", status.decoder],
                    ["Speaker model runtime", status.onnxruntime],
                  ] as const
                ).map(([label, value]) =>
                  value ? (
                    <li key={label} className="break-words">
                      {label}:{" "}
                      <span className={`font-mono ${value === "ok" ? "text-emerald-400" : "text-amber-300"}`}>
                        {value}
                      </span>
                    </li>
                  ) : null
                )}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button onClick={load} disabled={busy !== null} className={BUTTON_GHOST}>
              <RefreshIcon className={`w-4 h-4 ${busy === "refresh" ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
          {note && (
            <p className="text-sm text-slate-400" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
