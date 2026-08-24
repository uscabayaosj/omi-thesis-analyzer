"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import type { UsageSummary, UsagePeriodSummary, UsageBreakdownRow } from "@/lib/usage";
import { ArrowLeftIcon } from "@/components/icons";

function formatCost(costUsd: number | null): string {
  if (costUsd === null) return "—";
  return `$${costUsd.toFixed(costUsd < 1 ? 4 : 2)}`;
}

function StatTile({ title, summary }: { title: string; summary: UsagePeriodSummary }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-sm text-slate-400 mb-1">{title}</div>
      <div className="text-2xl font-semibold text-white">{formatCost(summary.costUsd)}</div>
      <div className="text-sm text-slate-400 mt-1">
        {summary.callCount} {summary.callCount === 1 ? "call" : "calls"}
      </div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: UsageBreakdownRow[] }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-sm text-slate-400 mb-3">{title} — this month</div>
      {rows.length === 0 ? (
        <div className="text-sm text-slate-500">No calls yet this month.</div>
      ) : (
        <table className="w-full text-sm">
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

  useEffect(() => {
    fetchJson<UsageSummary>("/api/usage")
      .then(setSummary)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load usage."));
  }, []);

  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/"
        className="text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2"
      >
        <ArrowLeftIcon className="w-4 h-4" />
        Back
      </Link>

      <h1 className="text-2xl font-bold text-white mb-6">Usage</h1>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {!summary && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {summary && !summary.configured && (
        <p className="text-sm text-slate-400">
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
