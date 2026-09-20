/**
 * Patterns — the ADHD lens's own record, read back as tendencies.
 *
 * Every number here is computed from what the app already stores (ADHD
 * analyses, daily rollups). No model call: this page must be free to open
 * as often as the user likes, and it must be exactly right, not a synthesis.
 *
 * Pure and dependency-free so it is testable; the page supplies the data and
 * the date helpers.
 */

import type { StoredAdhdAnalysis, StoredRollup } from "./adhd-storage";

export interface WeekRow {
  /** Monday, YYYY-MM-DD. */
  week: string;
  created: number;
  done: number;
  letGo: number;
  open: number;
}

export interface PersonRow {
  who: string;
  open: number;
  oldestOpenDays: number;
  done: number;
}

export interface RecurringLoop {
  text: string;
  count: number;
  conversations: { id: string; title: string }[];
}

export interface CoverageWeek {
  week: string;
  /** Distinct days with at least one ADHD analysis. */
  activeDays: number;
  /** Days with a rollup among those. */
  rolledDays: number;
}

export interface Patterns {
  coverage: CoverageWeek[];
  rollupStreak: number;
  weeks: WeekRow[];
  completionRate: number | null;
  openCount: number;
  openMedianAgeDays: number | null;
  openOver14: number;
  people: PersonRow[];
  loops: RecurringLoop[];
  planRate: number | null;
  planDays: { day: string; done: number; total: number }[];
}

export interface DateHelpers {
  dayOf: (iso: string) => string;
  mondayOf: (day: string) => string;
  addDays: (day: string, n: number) => string;
  today: string;
}

function daysBetween(day: string, today: string): number {
  const a = new Date(`${day}T12:00:00`).getTime();
  const b = new Date(`${today}T12:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Loop text reduced to a comparable key: lowercase, punctuation stripped,
 *  first 60 characters. Two loops the model phrased nearly the same way
 *  collapse; genuinely different loops do not. */
export function loopKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export function computePatterns(
  analyses: StoredAdhdAnalysis[],
  rollups: StoredRollup[],
  h: DateHelpers,
  weekCount = 8,
): Patterns {
  const start = h.mondayOf(h.today);
  const weekKeys: string[] = [];
  for (let i = weekCount - 1; i >= 0; i--) weekKeys.push(h.addDays(start, -7 * i));
  const weekSet = new Set(weekKeys);

  // ── coverage & streak ──
  const activeDays = new Set<string>();
  for (const a of analyses) activeDays.add(h.dayOf(a.date ?? a.timestamp));
  const rollupDays = new Set(rollups.map((r) => r.day));
  const coverage: CoverageWeek[] = weekKeys.map((week) => {
    let active = 0;
    let rolled = 0;
    for (let d = 0; d < 7; d++) {
      const day = h.addDays(week, d);
      if (day > h.today) break;
      if (activeDays.has(day)) {
        active++;
        if (rollupDays.has(day)) rolled++;
      }
    }
    return { week, activeDays: active, rolledDays: rolled };
  });
  // Streak: walking back from today (or yesterday, if today is not closed
  // yet), count days with a rollup. An active day with no rollup ends it. A
  // quiet day — nothing recorded, nothing to close — is skipped, but three in
  // a row ends it too, so a streak cannot survive a long absence.
  let rollupStreak = 0;
  {
    let day = rollupDays.has(h.today) ? h.today : h.addDays(h.today, -1);
    let quiet = 0;
    for (let guard = 0; guard < 365; guard++) {
      if (rollupDays.has(day)) {
        rollupStreak++;
        quiet = 0;
      } else if (activeDays.has(day)) {
        break;
      } else if (++quiet >= 3) {
        break;
      }
      day = h.addDays(day, -1);
    }
  }

  // ── commitments ──
  const weeks = new Map<string, WeekRow>(weekKeys.map((w) => [w, { week: w, created: 0, done: 0, letGo: 0, open: 0 }]));
  const people = new Map<string, PersonRow>();
  const openAges: number[] = [];
  let doneAll = 0;
  let letGoAll = 0;
  let openAll = 0;
  for (const a of analyses) {
    const day = h.dayOf(a.date ?? a.timestamp);
    const week = h.mondayOf(day);
    const row = weekSet.has(week) ? weeks.get(week) : undefined;
    const done = new Set(a.doneKeys ?? []);
    const letGo = new Set(a.letGoKeys ?? []);
    for (const c of a.analysis.commitments) {
      const who = c.who.trim() || "Unattributed";
      const p = people.get(who) ?? { who, open: 0, oldestOpenDays: 0, done: 0 };
      if (row) row.created++;
      if (done.has(c.key)) {
        doneAll++;
        p.done++;
        if (row) row.done++;
      } else if (letGo.has(c.key)) {
        letGoAll++;
        if (row) row.letGo++;
      } else {
        openAll++;
        const age = daysBetween(day, h.today);
        openAges.push(age);
        p.open++;
        p.oldestOpenDays = Math.max(p.oldestOpenDays, age);
        if (row) row.open++;
      }
      people.set(who, p);
    }
  }
  const resolvedTotal = doneAll + letGoAll + openAll;
  const completionRate = resolvedTotal ? doneAll / resolvedTotal : null;

  // ── recurring loops ──
  const loops = new Map<string, RecurringLoop>();
  for (const a of analyses) {
    const seenHere = new Set<string>();
    for (const text of a.analysis.open_loops ?? []) {
      const k = loopKey(text);
      if (!k || seenHere.has(k)) continue;
      seenHere.add(k);
      const l = loops.get(k) ?? { text, count: 0, conversations: [] };
      l.count++;
      l.conversations.push({ id: a.conversationId, title: a.title });
      loops.set(k, l);
    }
  }

  // ── plan follow-through ──
  const planDays: { day: string; done: number; total: number }[] = [];
  let planDone = 0;
  let planTotal = 0;
  for (const r of [...rollups].sort((x, y) => x.day.localeCompare(y.day))) {
    const steps = r.rollup.plan_steps ?? [];
    if (steps.length === 0) continue;
    const keys = new Set(steps.map((s) => s.key));
    const done = (r.planDoneKeys ?? []).filter((k) => keys.has(k)).length;
    planDays.push({ day: r.day, done, total: steps.length });
    planDone += done;
    planTotal += steps.length;
  }

  return {
    coverage,
    rollupStreak,
    weeks: weekKeys.map((w) => weeks.get(w)!),
    completionRate,
    openCount: openAll,
    openMedianAgeDays: median(openAges),
    openOver14: openAges.filter((d) => d > 14).length,
    people: [...people.values()]
      .filter((p) => p.open > 0)
      .sort((a, b) => b.open - a.open || b.oldestOpenDays - a.oldestOpenDays || a.who.localeCompare(b.who))
      .slice(0, 8),
    loops: [...loops.values()].filter((l) => l.count >= 2).sort((a, b) => b.count - a.count).slice(0, 12),
    planRate: planTotal ? planDone / planTotal : null,
    planDays: planDays.slice(-14),
  };
}
