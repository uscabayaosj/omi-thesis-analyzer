"use client";

import { getAllAdhdAnalyses, type StoredAdhdAnalysis } from "./adhd-storage";
import type { AdhdCommitment } from "./adhd";

/**
 * A commitment lifted out of the conversation it was spoken in.
 *
 * Commitments are the one thing this product tracks that a notes app does not:
 * they persist, they age, and they are supposed to be renegotiated rather than
 * silently dropped. But the only place one could ever be ticked was inside a
 * single conversation's analysis card, three screens down — so in practice
 * they were extracted and then never touched again. Carrying the provenance
 * (which conversation, which day) alongside the commitment is what lets the
 * ledger show them all in one place and still link back to the evidence.
 */
export interface OpenCommitment {
  key: string;
  conversationId: string;
  conversationTitle: string;
  /** Conversation date (YYYY-MM-DD) when known, else the analysis timestamp. */
  date: string;
  /** Whole days since that date. Drives the ageing treatment. */
  ageDays: number;
  commitment: AdhdCommitment;
  done: boolean;
}

function dayOf(a: StoredAdhdAnalysis): string {
  // `date` is a full ISO timestamp in practice ("2026-08-07T16:09:22.919767Z"),
  // not the YYYY-MM-DD its type comment implies. Appending "T00:00:00" to that
  // produced an unparseable string, so every age silently computed as NaN and
  // clamped to 0 — the ageing bands never rendered and the sort was inert on a
  // ledger whose entire premise is that a promise gets older.
  return (a.date ?? a.timestamp).slice(0, 10);
}

function daysBetween(day: string, now: number): number {
  const t = new Date(`${day}T00:00:00`).getTime();
  // A NaN here means the input was not a bare date. Returning 0 hid exactly
  // that bug once already, so it is surfaced rather than swallowed.
  if (Number.isNaN(t)) {
    console.warn(`commitments: unparseable day "${day}" — age will show as 0`);
    return 0;
  }
  return Math.max(0, Math.floor((now - t) / 86_400_000));
}

/**
 * Every commitment across every analysis, newest-owed first within each age
 * band. `includeDone` keeps ticked items so the ledger can show what was
 * closed today rather than having them vanish mid-tap.
 */
export function getAllCommitments(includeDone = false): OpenCommitment[] {
  const now = Date.now();
  const out: OpenCommitment[] = [];
  for (const a of getAllAdhdAnalyses()) {
    const done = new Set(a.doneKeys ?? []);
    const date = dayOf(a);
    for (const c of a.analysis.commitments) {
      const isDone = done.has(c.key);
      if (isDone && !includeDone) continue;
      out.push({
        key: c.key,
        conversationId: a.conversationId,
        conversationTitle: a.title,
        date,
        ageDays: daysBetween(date, now),
        commitment: c,
        done: isDone,
      });
    }
  }
  // Oldest first: an ageing promise is the one at risk, and the point of the
  // ledger is that nothing slides out of view by getting old.
  out.sort((x, y) => y.ageDays - x.ageDays || x.commitment.who.localeCompare(y.commitment.who));
  return out;
}

/** Group by the counterparty, because that is how a social debt is settled. */
export function groupByPerson(items: OpenCommitment[]): { who: string; items: OpenCommitment[] }[] {
  const map = new Map<string, OpenCommitment[]>();
  for (const it of items) {
    const who = it.commitment.who.trim() || "Unattributed";
    const list = map.get(who);
    if (list) list.push(it);
    else map.set(who, [it]);
  }
  return [...map.entries()]
    .map(([who, list]) => ({ who, items: list }))
    .sort((a, b) => {
      const oldestA = Math.max(...a.items.map((i) => i.ageDays));
      const oldestB = Math.max(...b.items.map((i) => i.ageDays));
      // Oldest-owed person first, so the page reads oldest-first overall and
      // not merely within each group.
      return oldestB - oldestA || b.items.length - a.items.length || a.who.localeCompare(b.who);
    });
}

export function countOpen(): number {
  return getAllCommitments(false).length;
}
