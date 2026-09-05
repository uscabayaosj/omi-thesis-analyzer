"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format";
import { BUTTON_SECONDARY } from "@/lib/ui";

interface OpenSession {
  id: string;
  startedAt: string;
  lastSpeechAt: string;
  voicedMs: number;
}

/**
 * The conversation being captured right now. A session only becomes a
 * conversation ninety seconds after the talking stops, and until this banner
 * existed that interval read as "nothing is happening". Ending it here closes
 * and transcribes immediately.
 */
export function CaptureBanner({ onEnded }: { onEnded: () => void }) {
  const [open, setOpen] = useState<OpenSession[]>([]);
  const [ending, setEnding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await fetchJson<{ open?: OpenSession[] }>("/api/capture/status", { cache: "no-store" });
      setOpen(s.open ?? []);
    } catch {
      setOpen([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: a fetch on mount plus a slow poll; every setState lands after an await
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const endNow = async () => {
    setEnding(true);
    setNote(null);
    try {
      const r = await fetchJson<{ closed: string[] }>("/api/capture/close", { method: "POST" });
      setNote(r.closed.length ? "Ended — transcribing now; it will appear in a moment." : "Nothing was being captured.");
      await load();
      onEnded();
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not end the conversation.");
    } finally {
      setEnding(false);
    }
  };

  if (open.length === 0 && !note) return null;
  const s = open[0];

  return (
    <div className="card p-4 mt-3 border-cyan-500/30" role="status">
      {s ? (
        <p className="text-slate-200">
          Capturing a conversation since <span className="font-mono">{formatDateTime(s.startedAt)}</span> —{" "}
          {Math.round(s.voicedMs / 60_000)} min of speech so far.
          <span className="block text-sm text-slate-400 mt-1">
            It appears here about ninety seconds after the talking stops.{" "}
            <Link href="/capture" className="text-cyan-400 hover:underline">Capture status</Link>
          </span>
        </p>
      ) : (
        <p className="text-slate-400 text-sm">{note}</p>
      )}
      {s && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button onClick={endNow} disabled={ending} className={BUTTON_SECONDARY}>
            {ending ? "Ending…" : "End conversation now"}
          </button>
          {note && <span className="text-sm text-slate-400">{note}</span>}
        </div>
      )}
    </div>
  );
}
