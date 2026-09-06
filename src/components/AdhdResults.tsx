"use client";

import type { ComponentType, ReactNode } from "react";
import { confidenceLabel, formatDeadline, meaningful, type AdhdAnalysis } from "@/lib/adhd";
import { Inline } from "@/components/Prose";
import SectionNav, { sectionId } from "@/components/SectionNav";
import {
  ZapIcon, ClipboardIcon, CogIcon, UsersIcon, RefreshIcon,
  CalendarIcon, CheckSquareIcon, SquareIcon, ScaleIcon, FeatherIcon,
  TargetIcon, CompassIcon,
} from "@/components/icons";

function Block({
  icon: Icon, title, children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="card p-6" id={sectionId(title)} style={{ scrollMarginTop: "6rem" }}>
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

/** A labelled line that is omitted when the model said "None" — six "None"
 *  rows under every person read as gaps, not as the good news they are. */
function Meta({ label, value, tone }: { label: string; value: string | undefined; tone?: string }) {
  const v = meaningful(value);
  if (!v) return null;
  return <p className={`text-xs ${tone ?? "text-slate-400"}`}>{label}: {v}</p>;
}

export function AdhdResults({
  analysis,
  doneKeys,
  letGoKeys = [],
  onToggleDone,
  onToggleLetGo,
  animate = true,
}: {
  analysis: AdhdAnalysis;
  doneKeys: string[];
  /** Promises retired without being done. The conversation page showed these
   *  as open, unticked boxes — the ledger and the page disagreed about the
   *  same promise. */
  letGoKeys?: string[];
  onToggleDone: (key: string) => void;
  /** Optional: when absent (the read-only saved-copy view) no let-go control
   *  is rendered, but a let-go state is still shown. */
  onToggleLetGo?: (key: string) => void;
  animate?: boolean;
}) {
  const done = new Set(doneKeys);
  const letGo = new Set(letGoKeys);

  // A conversation with nothing actionable in it is a normal outcome (small
  // talk, a lecture, background noise). Rendering six stacked "None." cards
  // makes that read as a failure and buries the one line that actually
  // answers the question — so collapse to the summary instead.
  const nothingCaptured =
    analysis.do_today.length === 0 &&
    analysis.commitments.length === 0 &&
    analysis.remember.length === 0 &&
    analysis.people.length === 0 &&
    analysis.open_loops.length === 0 &&
    analysis.ahead.length === 0 &&
    !analysis.reflection?.social_balance?.length &&
    !analysis.reflection?.emotional_check?.length &&
    !analysis.reflection?.capacity_check?.length &&
    !analysis.reflection?.strategic_takeaway?.length;

  if (nothingCaptured) {
    return (
      <div className={`${animate ? "stagger-in" : ""} space-y-6`}>
        <div className="card p-5 border-cyan-500/30">
          <p className="text-sm text-slate-200">{analysis.summary}</p>
        </div>
        <div className="card p-8 text-center">
          <p className="text-slate-300">Nothing actionable was captured here.</p>
          <p className="text-slate-400 text-sm mt-1">
            No commitments, people, or open loops came up — nothing to carry forward from this one.
          </p>
        </div>
      </div>
    );
  }

  // Mirrors each block's own render guard, so the strip never offers an
  // anchor that isn't on the page. The reflection blocks are individually
  // conditional — an absent observation is the good outcome, not a gap.
  const r = analysis.reflection;
  const navSections = [
    "Do today", "Promises", "Worth remembering", "People",
    "Unfinished threads", "Coming up",
    ...(r?.social_balance?.length ? ["How the conversation went"] : []),
    ...(r?.emotional_check?.length ? ["Feelings check"] : []),
    ...(r?.capacity_check?.length ? ["Promised too much?"] : []),
    ...(r?.strategic_takeaway?.length ? ["Bigger picture"] : []),
  ].map((label) => ({ id: sectionId(label), label }));

  return (
    <div className={`${animate ? "stagger-in" : ""} space-y-6`}>
      <SectionNav sections={navSections} />
      {/* One-line summary */}
      <div className="card p-5 border-cyan-500/30">
        <p className="text-sm text-slate-200">{analysis.summary}</p>
      </div>

      <Block icon={ZapIcon} title="Do today">
        {analysis.do_today.length ? (
          <ul className="space-y-2">
            {analysis.do_today.map((item, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-cyan-400 flex-shrink-0">→</span>
                <span className="min-w-0"><Inline text={item} /></span>
              </li>
            ))}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={ClipboardIcon} title="Promises">
        {analysis.commitments.length ? (
          <ul className="space-y-3">
            {analysis.commitments.map((c) => {
              const isDone = done.has(c.key);
              const isLetGo = letGo.has(c.key);
              const dir = c.direction === "other_to_user" ? `${c.who} → me` : `me → ${c.who}`;
              const deadline = formatDeadline(c.deadline);
              return (
                <li key={c.key} className="flex gap-3">
                  <button
                    onClick={() => onToggleDone(c.key)}
                    aria-pressed={isDone}
                    aria-label={isDone ? "Mark commitment not done" : "Mark commitment done"}
                    className="flex-shrink-0 mt-0.5 min-h-[44px] min-w-[44px] flex items-start justify-center text-slate-400 hover:text-emerald-400 transition-colors"
                  >
                    {/* The unchecked box used to be the same glyph at
                        opacity-40, which composited to 2.08:1 — below the 3:1
                        floor for a control's own state indicator, on the one
                        checklist this product exists to make tickable. State
                        is carried by two different glyphs now (empty vs
                        checked), not by transparency. */}
                    {isDone
                      ? <CheckSquareIcon className="w-5 h-5 text-emerald-400" />
                      : <SquareIcon className="w-5 h-5" />}
                  </button>
                  {/* `opacity-50` on a done item dropped its text to 3.81:1 and
                      its meta line to 2.54:1 — a completed promise became the
                      hardest thing on the page to re-read, which is exactly
                      backwards when you are checking what you already did.
                      The line-through already says "done". */}
                  <div className={`min-w-0 flex-1 ${isDone || isLetGo ? "line-through decoration-slate-500" : ""}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-mono text-slate-400">{dir}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300">{confidenceLabel(c.confidence)}</span>
                      {isLetGo && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full border border-slate-600 bg-slate-800 text-slate-300">
                          let go
                        </span>
                      )}
                    </div>
                    <p className="text-slate-200 mt-0.5">{c.what}</p>
                    {/* The raw value used to render behind a fixed "Deadline:"
                        label — "Deadline: Estimated: 2026-08-15", "Deadline:
                        None." — while the ledger normalised the same field. */}
                    {deadline && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        {deadline.label} <strong className="text-slate-200"><Inline text={deadline.value} /></strong>
                      </p>
                    )}
                    {c.quote && <p className="text-xs text-slate-400 italic mt-1">&ldquo;{c.quote}&rdquo;</p>}
                    {onToggleLetGo && (
                      <button
                        onClick={() => onToggleLetGo(c.key)}
                        aria-pressed={isLetGo}
                        className={`text-xs min-h-[44px] px-2 -ml-2 rounded-lg transition-colors ${
                          isLetGo ? "text-slate-300 hover:text-white" : "text-slate-400 hover:text-slate-200"
                        }`}
                      >
                        {isLetGo ? "Bring back" : "Let go"}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={CogIcon} title="Worth remembering">
        {analysis.remember.length ? (
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-500">
            {analysis.remember.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={UsersIcon} title="People">
        {analysis.people.length ? (
          <div className="space-y-3">
            {analysis.people.map((p, i) => (
              <div key={i} className="rounded-lg bg-slate-900/60 p-3">
                <p className="font-medium text-slate-200">{p.name} <span className="text-slate-400 font-normal">— {p.relationship}</span></p>
                <div className="mt-1 space-y-0.5">
                  <Meta label="Shared" value={p.shared} />
                  <Meta label="Tone" value={p.tone} />
                  <Meta label="Owed" value={p.owed} tone="text-slate-300" />
                  <Meta label="Met at" value={p.place} />
                </div>
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Block>

      <Block icon={RefreshIcon} title="Unfinished threads">
        {analysis.open_loops.length ? (
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-500">
            {analysis.open_loops.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        ) : <Empty />}
      </Block>

      <Block icon={CalendarIcon} title="Coming up">
        {analysis.ahead.length ? (
          <div className="space-y-3">
            {analysis.ahead.map((x, i) => (
              <div key={i} className="rounded-lg bg-slate-900/60 p-3">
                <p className="font-medium text-slate-200">{x.event} <span className="text-slate-400 font-normal">({x.date})</span></p>
                <div className="mt-1 space-y-0.5">
                  <Meta label="Prep" value={x.prep} />
                  <Meta label="Start" value={x.start_when} />
                  <Meta label="Conflict" value={x.conflict} tone="text-amber-300" />
                </div>
              </div>
            ))}
          </div>
        ) : <Empty />}
      </Block>

      {/* Reflection pass — meta-cognition and interpersonal dynamics, rendered
          only for analyses that carry it (older stored analyses predate it,
          and four "None." blocks would wrongly imply the pass ran and found
          nothing). Sections with no observations are likewise skipped: an
          absent observation is the good outcome, not a gap worth a card. */}
      {analysis.reflection?.social_balance?.length ? (
        <Block icon={ScaleIcon} title="How the conversation went">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-500">
            {analysis.reflection.social_balance.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        </Block>
      ) : null}

      {analysis.reflection?.emotional_check?.length ? (
        <Block icon={FeatherIcon} title="Feelings check">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-500">
            {analysis.reflection.emotional_check.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        </Block>
      ) : null}

      {analysis.reflection?.capacity_check?.length ? (
        <Block icon={TargetIcon} title="Promised too much?">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-500">
            {analysis.reflection.capacity_check.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        </Block>
      ) : null}

      {analysis.reflection?.strategic_takeaway?.length ? (
        <Block icon={CompassIcon} title="Bigger picture">
          <ul className="list-disc pl-5 space-y-1.5 marker:text-slate-500">
            {analysis.reflection.strategic_takeaway.map((item, i) => <li key={i}><Inline text={item} /></li>)}
          </ul>
        </Block>
      ) : null}
    </div>
  );
}
