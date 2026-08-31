"use client";

/**
 * The open-promises ledger.
 *
 * Commitments were the product's distinguishing mechanism and its least-used
 * feature: 62 extracted, 4 ever ticked. The cause was structural rather than
 * motivational — the only place a commitment could be marked done was inside
 * one conversation's analysis card, three screens down, one conversation at a
 * time. The done-state was read by the app badge and fed to the rollup prompt,
 * but no screen ever showed it back. This is that screen: every open promise,
 * across every conversation, oldest first, tickable in place.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllCommitments, groupByPerson, type OpenCommitment } from "@/lib/commitments";
import { toggleCommitmentDone, getAllAdhdAnalyses } from "@/lib/adhd-storage";
import { notifyAnalysesChanged, syncAppBadge } from "@/lib/badge";
import { confidenceLabel } from "@/lib/adhd";
import { Inline } from "@/components/Prose";
import { pullAndMerge } from "@/lib/sync";
import { ArrowLeftIcon, CheckSquareIcon, SquareIcon, ClipboardIcon } from "@/components/icons";
import { LINK_BACK } from "@/lib/ui";

/**
 * Normalise the three shapes a deadline arrives in.
 *
 * "None." means there is no deadline and the row should simply not claim one;
 * an "Estimated: " prefix means the model inferred it, which is worth saying
 * once rather than twice.
 */
function formatDeadline(raw: string): { label: string; value: string } | null {
  const t = (raw ?? "").trim();
  if (!t || /^none\.?$/i.test(t)) return null;
  const est = t.match(/^estimated:\s*(.+)$/i);
  if (est) return { label: "Estimated deadline:", value: est[1] };
  return { label: "Deadline:", value: t };
}

/** Ageing bands. A promise that has carried for a week is a different object
 *  from one made this morning, and the ledger's whole job is to say so. */
function ageBand(days: number): { label: string; tone: string } | null {
  if (days >= 14) return { label: `${days} days old`, tone: "text-red-400 border-red-500/40 bg-red-500/10" };
  if (days >= 7) return { label: `${days} days old`, tone: "text-amber-400 border-amber-500/40 bg-amber-500/10" };
  if (days >= 3) return { label: `${days} days old`, tone: "text-slate-300 border-slate-600 bg-slate-800" };
  return null;
}

export default function CommitmentsPage() {
  const [items, setItems] = useState<OpenCommitment[]>([]);
  const [showDone, setShowDone] = useState(false);
  // Held to the server's view on the first render — this reads localStorage,
  // which the server cannot see (same hydration trap fixed on /rollup/week).
  const [mounted, setMounted] = useState(false);

  const reload = useCallback((withDone: boolean) => {
    setItems(getAllCommitments(withDone));
  }, []);

  useEffect(() => {
    setMounted(true);
    reload(showDone);
    pullAndMerge().then((changed) => {
      if (changed) reload(showDone);
    });
  }, [reload, showDone]);

  const toggle = useCallback((it: OpenCommitment) => {
    toggleCommitmentDone(it.conversationId, it.key);
    notifyAnalysesChanged();
    syncAppBadge(getAllAdhdAnalyses());
    // Keep ticked rows on screen for this session so the list doesn't reflow
    // out from under the thumb mid-tap — the exact failure the review queue has.
    setItems((prev) =>
      prev.map((p) => (p.key === it.key && p.conversationId === it.conversationId ? { ...p, done: !p.done } : p))
    );
  }, []);

  const groups = useMemo(() => groupByPerson(items), [items]);
  const openCount = items.filter((i) => !i.done).length;
  const doneCount = items.length - openCount;

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
          Ledger
        </p>
        <h1 className="font-bold text-white">Open promises</h1>
        <p className="font-serif italic text-slate-400 mt-1">
          Everything still owed, in either direction. Whoever has waited longest is first.
        </p>
      </header>

      {!mounted ? null : items.length === 0 ? (
        <div className="card p-8 text-center">
          <ClipboardIcon className="w-10 h-10 mx-auto mb-4 text-slate-500" />
          <p className="text-slate-200 mb-1">Nothing outstanding.</p>
          <p className="text-sm text-slate-400">
            Promises appear here once a conversation has been through the ADHD Aid lens.
          </p>
        </div>
      ) : (
        <>
          <div className="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-200">
              <strong className="font-semibold">{openCount}</strong> open
              {doneCount > 0 && <span className="text-slate-400"> · {doneCount} closed</span>}
            </p>
            <button
              onClick={() => setShowDone((v) => !v)}
              aria-pressed={showDone}
              className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors"
            >
              {showDone ? "Hide closed" : "Show closed"}
            </button>
          </div>

          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.who}>
                <h2 className="mb-2">{g.who}</h2>
                <ul className="space-y-3">
                  {g.items.map((it) => {
                    const band = ageBand(it.ageDays);
                    const dir =
                      it.commitment.direction === "other_to_user"
                        ? `${it.commitment.who} → me`
                        : `me → ${it.commitment.who}`;
                    return (
                      <li key={`${it.conversationId}:${it.key}`} className="card p-4 flex gap-3">
                        <button
                          onClick={() => toggle(it)}
                          aria-pressed={it.done}
                          aria-label={it.done ? "Mark promise not done" : "Mark promise done"}
                          className="flex-shrink-0 mt-0.5 min-h-[44px] min-w-[44px] flex items-start justify-center text-slate-400 hover:text-emerald-400 transition-colors"
                        >
                          {it.done
                            ? <CheckSquareIcon className="w-5 h-5 text-emerald-400" />
                            : <SquareIcon className="w-5 h-5" />}
                        </button>
                        <div className={`min-w-0 flex-1 ${it.done ? "line-through decoration-slate-500" : ""}`}>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-mono text-slate-400">{dir}</span>
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">
                              {confidenceLabel(it.commitment.confidence)}
                            </span>
                            {band && (
                              <span className={`text-xs px-1.5 py-0.5 rounded-full border ${band.tone}`}>
                                {band.label}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-200 mt-1"><Inline text={it.commitment.what} /></p>
                          {/* The model returns deadlines three ways — a bare
                              date, an "Estimated: " prefix when it inferred
                              one, and the literal string "None". Rendering the
                              raw value behind a fixed "Deadline:" label
                              produced "Deadline: Estimated: 2026-08-15" and
                              "Deadline: None", and leaked ** markdown. */}
                          {formatDeadline(it.commitment.deadline) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {formatDeadline(it.commitment.deadline)!.label}{" "}
                              <strong className="text-slate-200">
                                <Inline text={formatDeadline(it.commitment.deadline)!.value} />
                              </strong>
                            </p>
                          )}
                          <Link
                            href={`/conversation/${it.conversationId}`}
                            className="text-xs text-cyan-400 hover:underline mt-1 inline-block"
                          >
                            {it.conversationTitle} · {it.date}
                          </Link>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
