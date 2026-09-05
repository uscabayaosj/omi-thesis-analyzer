"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format";
import { ArrowLeftIcon, RefreshIcon } from "@/components/icons";
import { BUTTON_GHOST } from "@/lib/ui";

interface Status {
  configured: boolean;
  lastChunkAt?: string | null;
  open?: { id: string; deviceId: string; startedAt: string; lastSpeechAt: string; voicedMs: number }[];
  byStatus7d?: Record<string, number>;
  failed?: { id: string; startedAt: string; error: string; attempts: number }[];
  error?: string;
}

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
  const [busy, setBusy] = useState<"refresh" | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // No synchronous setState in the effect body: state changes only land after
  // the fetch resolves, which is the subscribe-then-update shape React wants.
  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await fetchJson<Status>("/api/capture/status", { cache: "no-store" }));
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


  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={BUTTON_GHOST}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>
      <p className="mt-6 mb-1 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">System</p>
      <h1 className="font-bold text-white mb-4">Capture</h1>

      {status && !status.configured && (
        <p className="text-slate-400">The store isn&apos;t configured here, so there is nothing to show.</p>
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
              status.open!.map((o) => (
                <p key={o.id} className="text-slate-400 text-sm mt-1">
                  In progress since {formatDateTime(o.startedAt)} — {minutes(o.voicedMs)} of speech, last heard{" "}
                  {formatDateTime(o.lastSpeechAt)}.
                </p>
              ))
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
