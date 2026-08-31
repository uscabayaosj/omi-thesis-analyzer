"use client";

import type { RollupPlanStep } from "@/lib/adhd";
import { ZapIcon, CheckSquareIcon, SquareIcon } from "@/components/icons";

/**
 * Tomorrow's plan, rendered as things you can actually do something about.
 *
 * This is the answer to the question the design review raised: prose cannot be
 * ticked, deferred, or counted, so a plan returned as a paragraph made the
 * day-close ritual end in reading. The model now returns the same plan twice —
 * once as prose for export and once as steps — and this renders the steps.
 */
export default function PlanChecklist({
  steps, done, onToggle,
}: {
  steps: RollupPlanStep[];
  done: Set<string>;
  onToggle: (key: string) => void;
}) {
  const remaining = steps.filter((s) => !done.has(s.key)).length;
  return (
    <section className="card p-6 border-cyan-500/40" aria-label="Tomorrow's plan">
      <div className="analysis-section">
        <h2 className="flex items-center gap-2">
          <ZapIcon className="w-[1.05em] h-[1.05em] flex-shrink-0" />
          Tomorrow&apos;s plan
        </h2>
        <p className="text-xs text-slate-400 mt-1 mb-3 font-mono" role="status">
          {remaining === 0
            ? `All ${steps.length} done`
            : `${remaining} of ${steps.length} left`}
        </p>
        <ol className="space-y-2.5">
          {steps.map((step, i) => {
            const isDone = done.has(step.key);
            return (
              <li key={step.key} className="flex gap-3">
                <button
                  onClick={() => onToggle(step.key)}
                  aria-pressed={isDone}
                  aria-label={isDone ? `Mark not done: ${step.what}` : `Mark done: ${step.what}`}
                  className="flex-shrink-0 mt-0.5 min-h-[44px] min-w-[44px] flex items-start justify-center text-slate-400 hover:text-emerald-400 transition-colors"
                >
                  {isDone
                    ? <CheckSquareIcon className="w-5 h-5 text-emerald-400" />
                    : <SquareIcon className="w-5 h-5" />}
                </button>
                <div className={`min-w-0 flex-1 ${isDone ? "line-through decoration-slate-500" : ""}`}>
                  <div className="flex flex-wrap items-center gap-2 mb-0.5">
                    {/* The first step is the "first block" the prompt asks for —
                        the one thing to start the day with. Naming it is what
                        makes the list a plan rather than an undifferentiated
                        set of five tasks. */}
                    {i === 0 && !isDone && (
                      <span className="text-[11px] font-mono uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full border border-cyan-500/50 bg-cyan-950/40 text-cyan-200">
                        Start here
                      </span>
                    )}
                    {step.when && <span className="text-xs font-mono text-slate-400">{step.when}</span>}
                    {typeof step.minutes === "number" && (
                      <span className="text-xs font-mono text-slate-400">~{step.minutes} min</span>
                    )}
                    {step.deadline && (
                      <span className="text-xs px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-400">
                        due {step.deadline}
                      </span>
                    )}
                  </div>
                  <p className="text-slate-200">{step.what}</p>
                  {step.why && <p className="text-xs text-slate-400 mt-0.5">{step.why}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
