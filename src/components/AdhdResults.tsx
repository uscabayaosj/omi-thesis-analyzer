"use client";

import type { ComponentType, ReactNode } from "react";
import { confidenceLabel, type AdhdAnalysis } from "@/lib/adhd";
import {
  ZapIcon, ClipboardIcon, CogIcon, UsersIcon, RefreshIcon,
  CalendarIcon, CheckSquareIcon,
} from "@/components/icons";

function Block({
  icon: Icon, title, children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="card p-6">
      <div className="analysis-section">
        <h3 className="flex items-center gap-2">
          <Icon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          {title}
        </h3>
        <div className="text-sm leading-relaxed mt-3">{children}</div>
      </div>
    </div>
  );
}

function Empty() {
  return <p className="text-slate-400">None.</p>;
}

export function AdhdResults({
  analysis,
  doneKeys,
  onToggleDone,
  animate = true,
}: {
  analysis: AdhdAnalysis;
  doneKeys: string[];
  onToggleDone: (key: string) => void;
  animate?: boolean;
}) {
  const done = new Set(doneKeys);

  return (
    <div className={`${animate ? "stagger-in" : ""} space-y-6`}>
      {/* One-line summary */}
      <div className="card p-5 border-indigo-500/30">
        <p className="text-sm text-slate-200">{analysis.summary}</p>
      </div>

      <Block icon={ZapIcon} title="Do today">
        {analysis.do_today.length ? (
          <ul className="space-y-2">
            {analysis.do_today.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-indigo-400 flex-shrink-0">→</span>
                <span className="min-w-0">{item}</span>
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={ClipboardIcon} title="Commitments">
        {analysis.commitments.length ? (
          <ul className="space-y-3">
            {analysis.commitments.map((c) => {
              const isDone = done.has(c.key);
              const dir = c.direction === "other_to_user" ? `${c.who} → me` : `me → ${c.who}`;
              return (
                <li key={c.key} className="flex gap-3">
                  <button
                    onClick={() => onToggleDone(c.key)}
                    aria-pressed={isDone}
                    aria-label={isDone ? "Mark commitment not done" : "Mark commitment done"}
                    className="flex-shrink-0 mt-0.5 min-h-[44px] min-w-[44px] flex items-start justify-center text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    {isDone
                      ? <CheckSquareIcon className="w-5 h-5 text-emerald-400" />
                      : <CheckSquareIcon className="w-5 h-5 opacity-40" />}
                  </button>
                  <div className={`min-w-0 ${isDone ? "opacity-50 line-through" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{dir}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">{confidenceLabel(c.confidence)}</span>
                    </div>
                    <p className="text-slate-200 mt-0.5">{c.what}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Deadline: <strong className="text-slate-200">{c.deadline}</strong></p>
                    {c.quote && <p className="text-xs text-slate-400 italic mt-1">&ldquo;{c.quote}&rdquo;</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={CogIcon} title="Remember">
        {analysis.remember.length ? (
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-600">
            {analysis.remember.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={UsersIcon} title="People">
        {analysis.people.length ? (
          <div className="space-y-3">
            {analysis.people.map((p, i) => (
              <div key={i} className="rounded-lg bg-slate-900/60 p-3">
                <p className="font-medium text-slate-200">{p.name} <span className="text-slate-400 font-normal">— {p.relationship}</span></p>
                <p className="text-xs text-slate-400 mt-1">Shared: {p.shared}</p>
                <p className="text-xs text-slate-400">Tone: {p.tone}</p>
                <p className="text-xs text-slate-400">Owed: {p.owed}</p>
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Block>

      <Block icon={RefreshIcon} title="Open loops">
        {analysis.open_loops.length ? (
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-600">
            {analysis.open_loops.map((item, i) => <li key={i}>{item}</li>)}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={CalendarIcon} title="Ahead">
        {analysis.ahead.length ? (
          <div className="space-y-3">
            {analysis.ahead.map((x, i) => (
              <div key={i} className="rounded-lg bg-slate-900/60 p-3">
                <p className="font-medium text-slate-200">{x.event} <span className="text-slate-400 font-normal">({x.date})</span></p>
                <p className="text-xs text-slate-400 mt-1">Prep: {x.prep}</p>
                <p className="text-xs text-slate-400">Start: {x.start_when}</p>
                {x.conflict && x.conflict !== "None" && (
                  <p className="text-xs text-amber-300 mt-1">Conflict: {x.conflict}</p>
                )}
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Block>
    </div>
  );
}
