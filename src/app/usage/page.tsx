"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import type { UsageSummary, UsagePeriodSummary, UsageBreakdownRow, UsageTimezoneKey } from "@/lib/usage";
import { USAGE_TIMEZONES, DEFAULT_USAGE_TIMEZONE, isUsageTimezoneKey } from "@/lib/usage";
import { ArrowLeftIcon } from "@/components/icons";
import { LINK_BACK } from "@/lib/ui";

const USAGE_TZ_STORAGE_KEY = "omi-usage-tz";

function formatCost(costUsd: number | null): string {
  // An em-dash for a real zero read as "no data" rather than "nothing spent",
  // which is a materially different claim on a page about money. Null (the
  // store genuinely has nothing to report) keeps the dash; a measured zero
  // says so.
  if (costUsd === null) return "—";
  if (costUsd === 0) return "$0.00";
  return `$${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
}

function StatTile({ title, summary }: { title: string; summary: UsagePeriodSummary }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400 mb-1">{title}</div>
      <div className="font-mono text-2xl font-semibold text-white">{formatCost(summary.costUsd)}</div>
      <div className="font-mono text-sm text-slate-400 mt-1">
        {summary.callCount} {summary.callCount === 1 ? "call" : "calls"}
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: UsageBreakdownRow[] }) {
  return (
    <div className="card p-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-400 mb-3">{title} — this month</div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-400 font-serif italic">No calls yet this month.</div>
      ) : (
        <table className="w-full font-mono text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-slate-800 first:border-t-0">
                <td className="py-2 text-slate-200">{row.key}</td>
                <td className="py-2 text-right text-slate-400">{row.callCount}</td>
                <td className="py-2 text-right text-white w-20">{formatCost(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Same shape as the hydration bug fixed on /rollup/week: reading
  // localStorage in the initializer made the client's first render disagree
  // with the server's. It never threw here only because the divergence landed
  // on a <select> value, which React does not hydration-check as text — so the
  // page silently rendered the default while already fetching the stored
  // timezone. Restore the preference after mount instead.
  const [tz, setTz] = useState<UsageTimezoneKey>(DEFAULT_USAGE_TIMEZONE);

  useEffect(() => {
    const stored = window.localStorage.getItem(USAGE_TZ_STORAGE_KEY);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydration-safe mount flag: it exists to hold the first client render to the server's output before any localStorage-derived value is read
    if (isUsageTimezoneKey(stored)) setTz(stored);
  }, []);

  useEffect(() => {
    fetchJson<UsageSummary>(`/api/usage?tz=${tz}`)
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load usage."));
  }, [tz]);

  function handleTzChange(next: UsageTimezoneKey) {
    setTz(next);
    window.localStorage.setItem(USAGE_TZ_STORAGE_KEY, next);
  }

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/"
        className={LINK_BACK}
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">
        System
      </p>
      <h1 className="font-bold text-white mb-2">Usage</h1>

      <div className="mb-4">
        {/* This was a bare dropdown reading "London" under the page title —
            no visible label and no accessible name, so neither a sighted nor
            a screen-reader user was told what it controls. */}
        <label htmlFor="usage-tz" className="block text-sm text-slate-400 mb-1">
          Day boundary timezone
        </label>
        <select
          id="usage-tz"
          value={tz}
          onChange={(e) => handleTzChange(e.target.value as UsageTimezoneKey)}
          className="bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 px-2 py-1.5 min-h-[44px]"
        >
          {(Object.keys(USAGE_TIMEZONES) as UsageTimezoneKey[]).map((key) => (
            <option key={key} value={key}>
              {key === "london" ? "London" : key === "phoenix" ? "Phoenix" : "Manila"}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-slate-400 font-serif italic mb-4">
        Estimates are approximate — they don&apos;t account for prompt-caching discounts.
      </p>

      {error && <p role="alert" className="text-sm text-red-400 mb-4">{error}</p>}

      {!summary && !error && <p className="text-sm text-slate-400 font-mono">Loading…</p>}

      {summary && !summary.configured && (
        <p className="text-sm text-slate-400 font-serif italic">
          Usage tracking needs the server-side store configured (same one used for cross-device sync). Nothing to show yet.
        </p>
      )}

      {summary && summary.configured && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <StatTile title="Today" summary={summary.today} />
            <StatTile title="This Week" summary={summary.thisWeek} />
            <StatTile title="This Month" summary={summary.thisMonth} />
          </div>
          <BreakdownTable title="By feature" rows={summary.byLabel} />
          <BreakdownTable title="By model" rows={summary.byModel} />
        </div>
      )}
    </main>
  );
}
