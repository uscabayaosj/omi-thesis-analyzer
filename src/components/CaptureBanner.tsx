"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { formatDateTime } from "@/lib/format";
import { BUTTON_SECONDARY } from "@/lib/ui";
import { XIcon } from "@/components/icons";

// How long the "Ended — transcribing now" note stays up on its own. It used
// to persist until a full reload: once the session closed and the list
// refreshed, the banner kept telling the user something was in progress that
// had already finished, with no way to dismiss it.
const NOTE_TTL_MS = 20_000;

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
    // A hidden tab has nobody to tell; the visibilitychange listener below
    // re-polls the moment it is looked at again.
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    try {
      // `scope=open` answers with one query instead of the full diagnostic
      // report the /capture page reads — see the status route.
      const s = await fetchJson<{ open?: OpenSession[] }>("/api/capture/status?scope=open", { cache: "no-store" });
      setOpen(s.open ?? []);
    } catch {
      setOpen([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: a fetch on mount plus a slow poll; every setState lands after an await
    void load();
    const t = setInterval(() => void load(), 60_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), NOTE_TTL_MS);
    return () => clearTimeout(t);
  }, [note]);

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
        <div className="flex items-start justify-between gap-3">
          <p className="text-slate-400 text-sm">{note}</p>
          <button
            onClick={() => setNote(null)}
            aria-label="Dismiss"
            className="flex-shrink-0 -mt-2 -mr-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-white transition-colors"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>
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
