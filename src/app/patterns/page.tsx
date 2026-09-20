"use client";

/**
 * Patterns.
 *
 * The rollup tells you about one day and the weekly about one week. This is
 * the longer read: are days getting closed, are promises getting kept, who
 * is owed, what keeps coming back, does the plan get done. Computed on the
 * device from what is already stored — no model call, so it is free to open
 * as often as it helps and never a synthesis you have to trust.
 *
 * Charts: one series each, so a bar is a plain bar in survey blue with the
 * value written beside it. No legends, no second axis.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAllAdhdAnalyses, getAllRollups } from "@/lib/adhd-storage";
import { computePatterns, type Patterns } from "@/lib/patterns";
import { addDays, dayOf, formatDateTime, mondayOf, todayString } from "@/lib/format";
import { getPeople, matchPerson, type Person } from "@/lib/people";
import { pullAndMerge } from "@/lib/sync";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ArrowLeftIcon, TrendingUpIcon } from "@/components/icons";
import { LINK_BACK } from "@/lib/ui";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function weekLabel(monday: string): string {
  return formatDateTime(`${monday}T12:00:00`, { month: "short", day: "numeric" });
}

/** A labelled horizontal bar. `max` sets the scale so bars in one chart
 *  share it; a zero renders as a hairline so the row still reads. */
function Bar({ value, max, label, tone = "bg-cyan-400" }: { value: number; max: number; label: string; tone?: string }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-3 min-h-[28px]">
      <span className="font-mono text-xs text-slate-400 w-14 flex-shrink-0 text-right">{label}</span>
      <div className="flex-1 h-2.5 bg-slate-800 rounded-[3px] overflow-hidden" aria-hidden="true">
        <div className={`h-full ${tone} rounded-r-[3px]`} style={{ width: `${w}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-200 w-8 flex-shrink-0">{value}</span>
    </div>
  );
}

function Section({ q, children, note }: { q: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="card p-5" aria-label={q}>
      <h2 className="text-slate-100 font-serif font-semibold text-base">{q}</h2>
      {note && <p className="text-sm text-slate-400 mt-0.5 mb-3">{note}</p>}
      <div className={note ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[6rem]">
      <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-slate-100 leading-tight mt-0.5" style={{ fontFamily: "var(--font-barlow), ui-sans-serif, sans-serif" }}>{value}</div>
    </div>
  );
}

export default function PatternsPage() {
  useDocumentTitle("Patterns");
  const [data, setData] = useState<Patterns | null>(null);
  const [people, setPeople] = useState<Person[]>([]);

  useEffect(() => {
    const load = () => {
      setData(computePatterns(getAllAdhdAnalyses(), getAllRollups(), { dayOf, mondayOf, addDays, today: todayString() }));
      setPeople(getPeople());
    };
    load();
    pullAndMerge().then((changed) => { if (changed) load(); }).catch(() => {});
  }, []);

  const personHref = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const p of data.people) {
      const match = matchPerson(p.who, people);
      if (match.kind === "confident") m.set(p.who, `/people/${match.personId}`);
    }
    return m;
  }, [data, people]);

  const empty = data && data.weeks.every((w) => w.created === 0) && data.coverage.every((c) => c.activeDays === 0) && data.planDays.length === 0;

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <h1 className="font-bold text-white flex items-center gap-2">
          <TrendingUpIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
          Patterns
        </h1>
        <p className="font-serif italic text-slate-400 mt-1">
          The last eight weeks of the ADHD lens, read back as tendencies. Computed here, nothing sent anywhere.
        </p>
      </header>

      {!data ? (
        <p className="text-sm text-slate-400 font-mono">Reading…</p>
      ) : empty ? (
        <p className="text-sm text-slate-400 font-serif italic">
          Nothing to read yet. Run ADHD Aid on a few conversations and close a day or two with the rollup; patterns appear from there.
        </p>
      ) : (
        <div className="space-y-4">
          <Section q="Are days getting closed?" note="Days with conversations vs days you ran the rollup.">
            <div className="flex flex-wrap gap-6 mb-4">
              <Stat label="Rollup streak" value={`${data.rollupStreak} day${data.rollupStreak === 1 ? "" : "s"}`} />
              <Stat
                label="Closed, 8 wks"
                value={(() => {
                  const a = data.coverage.reduce((s, c) => s + c.activeDays, 0);
                  const r = data.coverage.reduce((s, c) => s + c.rolledDays, 0);
                  return a ? `${r}/${a}` : "—";
                })()}
              />
            </div>
            <div className="space-y-1">
              {data.coverage.map((c) => (
                <div key={c.week} className="flex items-center gap-3 min-h-[28px]">
                  <span className="font-mono text-xs text-slate-400 w-14 flex-shrink-0 text-right">{weekLabel(c.week)}</span>
                  <div className="flex gap-[3px]" role="img" aria-label={`${c.rolledDays} of ${c.activeDays} active days closed`}>
                    {Array.from({ length: 7 }).map((_, i) => {
                      const filled = i < c.rolledDays;
                      const active = i < c.activeDays;
                      return <span key={i} className={`w-3.5 h-3.5 rounded-[3px] ${filled ? "bg-cyan-400" : active ? "bg-slate-600" : "bg-slate-800"}`} />;
                    })}
                  </div>
                  <span className="font-mono text-xs text-slate-200">{c.activeDays ? `${c.rolledDays}/${c.activeDays}` : ""}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section q="Are promises getting kept?" note="Commitments by the week they were made. Done counts against done, let go and still open.">
            <div className="flex flex-wrap gap-6 mb-4">
              <Stat label="Done rate" value={pct(data.completionRate)} />
              <Stat label="Open now" value={String(data.openCount)} />
              <Stat label="Median age" value={data.openMedianAgeDays === null ? "—" : `${data.openMedianAgeDays}d`} />
              <Stat label="Over 14 days" value={String(data.openOver14)} />
            </div>
            {(() => {
              const max = Math.max(1, ...data.weeks.map((w) => w.created));
              return (
                <div className="space-y-1">
                  {data.weeks.map((w) => (
                    <div key={w.week} className="flex items-center gap-3 min-h-[28px]">
                      <span className="font-mono text-xs text-slate-400 w-14 flex-shrink-0 text-right">{weekLabel(w.week)}</span>
                      <div className="flex-1 h-2.5 bg-slate-800 rounded-[3px] overflow-hidden flex gap-[2px]" aria-hidden="true">
                        {w.done > 0 && <div className="h-full bg-cyan-400" style={{ width: `${(w.done / max) * 100}%` }} />}
                        {w.letGo > 0 && <div className="h-full bg-slate-500" style={{ width: `${(w.letGo / max) * 100}%` }} />}
                        {w.open > 0 && <div className="h-full bg-amber-400" style={{ width: `${(w.open / max) * 100}%` }} />}
                      </div>
                      <span className="font-mono text-xs text-slate-200 w-24 flex-shrink-0" aria-label={`${w.done} done, ${w.letGo} let go, ${w.open} open`}>
                        {w.created ? `${w.done}·${w.letGo}·${w.open}` : ""}
                      </span>
                    </div>
                  ))}
                  <p className="font-mono text-[11px] text-slate-500 pl-[4.25rem] pt-1">
                    <span className="inline-block w-2 h-2 rounded-[2px] bg-cyan-400 mr-1 align-middle" />done ·
                    <span className="inline-block w-2 h-2 rounded-[2px] bg-slate-500 mx-1 align-middle" />let go ·
                    <span className="inline-block w-2 h-2 rounded-[2px] bg-amber-400 mx-1 align-middle" />open
                  </p>
                </div>
              );
            })()}
          </Section>

          <Section q="Who is owed?" note="People with open promises, most first.">
            {data.people.length === 0 ? (
              <p className="text-sm text-slate-400 font-serif italic">No one. Every promise is done or let go.</p>
            ) : (
              <ul className="space-y-1 list-none">
                {data.people.map((p) => {
                  const href = personHref.get(p.who);
                  const max = Math.max(1, ...data.people.map((x) => x.open));
                  return (
                    <li key={p.who} className="flex items-center gap-3 min-h-[36px]">
                      {href ? (
                        <Link href={href} className="text-sm text-slate-200 hover:text-white hover:underline w-32 flex-shrink-0 truncate">{p.who}</Link>
                      ) : (
                        <span className="text-sm text-slate-200 w-32 flex-shrink-0 truncate">{p.who}</span>
                      )}
                      <div className="flex-1 h-2.5 bg-slate-800 rounded-[3px] overflow-hidden" aria-hidden="true">
                        <div className="h-full bg-cyan-400 rounded-r-[3px]" style={{ width: `${Math.max(2, (p.open / max) * 100)}%` }} />
                      </div>
                      <span className="font-mono text-xs text-slate-300 flex-shrink-0 w-28 text-right">
                        {p.open} open · {p.oldestOpenDays}d
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-3 text-sm"><Link href="/commitments" className="text-cyan-400 hover:underline">Work the ledger</Link></p>
          </Section>

          <Section q="What keeps coming back?" note="Open loops that appear in two or more conversations.">
            {data.loops.length === 0 ? (
              <p className="text-sm text-slate-400 font-serif italic">Nothing repeats yet.</p>
            ) : (
              <ul className="space-y-3 list-none">
                {data.loops.map((l) => (
                  <li key={l.text} className="text-sm">
                    <div className="flex items-start gap-2">
                      <span className="font-mono text-xs text-cyan-300 flex-shrink-0 mt-0.5 min-w-[1.5rem]">×{l.count}</span>
                      <span className="text-slate-200">{l.text}</span>
                    </div>
                    <div className="pl-8 mt-1 flex flex-wrap gap-x-3 gap-y-0">
                      {l.conversations.map((c, i) => (
                        <Link key={`${c.id}-${i}`} href={`/conversation/${c.id}`} className="text-xs text-slate-400 hover:text-white hover:underline min-h-[32px] inline-flex items-center">{c.title}</Link>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section q="Does the plan get done?" note="Plan steps ticked per rollup, last 14 days that had a plan.">
            <div className="flex flex-wrap gap-6 mb-4">
              <Stat label="Steps done" value={pct(data.planRate)} />
            </div>
            {data.planDays.length === 0 ? (
              <p className="text-sm text-slate-400 font-serif italic">No structured plans yet — rollups made before plan steps existed have prose only.</p>
            ) : (
              <div className="space-y-1">
                {data.planDays.map((d) => (
                  <Bar key={d.day} label={formatDateTime(`${d.day}T12:00:00`, { month: "short", day: "numeric" })} value={d.done} max={Math.max(1, ...data.planDays.map((x) => x.total))} />
                ))}
                <p className="font-mono text-[11px] text-slate-500 pl-[4.25rem] pt-1">bar = steps ticked, scale = largest plan</p>
              </div>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}
