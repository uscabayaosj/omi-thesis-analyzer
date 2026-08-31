"use client";

/**
 * The manual.
 *
 * Organised by the question being asked, not by feature: the design review
 * found nothing in the app explained the difference between the daily and
 * weekly rollup, what a commitment "ageing" means, what "Let go today" is for,
 * what the export writes, which of the two searches is which, or what the app
 * badge counts — all of which are decisions the user makes repeatedly and had
 * to re-derive each time.
 */

import Link from "next/link";
import { ArrowLeftIcon } from "@/components/icons";
import { LINK_BACK } from "@/lib/ui";
import { SHORTCUTS } from "@/lib/shortcuts";

function Answer({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="card overflow-hidden group">
      <summary className="cursor-pointer list-none px-5 py-4 min-h-[44px] flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors">
        <span className="font-serif font-semibold text-slate-100">{q}</span>
        <span className="font-mono text-xs text-slate-400 flex-shrink-0 group-open:hidden">Open</span>
        <span className="font-mono text-xs text-slate-400 flex-shrink-0 hidden group-open:inline">Close</span>
      </summary>
      <div className="px-5 pb-5 text-sm text-slate-300 leading-relaxed space-y-3">{children}</div>
    </details>
  );
}

export default function HelpPage() {
  return (
    <main className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">Manual</p>
        <h1 className="font-bold text-white">How this works</h1>
        <p className="font-serif italic text-slate-400 mt-1">
          The parts that aren&apos;t obvious, and what happens to your data.
        </p>
      </header>

      <div className="space-y-3">
        <Answer q="What are the two lenses?">
          <p>
            Every conversation can be read two ways, and they never mix. <strong className="text-slate-100">Thesis</strong> reads
            a recording as fieldwork — five dimensions against the Pioneer Sovereignty research questions.
            <strong className="text-slate-100"> ADHD Aid</strong> reads the same recording as a to-do source: promises made,
            decisions worth keeping, people owed a reply, loops left open.
          </p>
          <p>
            Running <strong className="text-slate-100">Both</strong> runs them independently and costs two analyses. Neither
            one sees the other&apos;s output, on purpose — a thesis reading should never be shaped by what
            you happen to owe someone.
          </p>
        </Answer>

        <Answer q="Daily rollup vs. weekly rollup — which do I want?">
          <p>
            The <strong className="text-slate-100">daily rollup</strong> closes out one day. It reads every ADHD Aid analysis
            from that day, plus the previous day&apos;s rollup, and produces tomorrow&apos;s plan. This is the
            one you run as a habit.
          </p>
          <p>
            The <strong className="text-slate-100">weekly rollup</strong> synthesises the daily rollups you already have for a
            week. It cannot invent days you never closed out — if a day has no daily rollup, it is not
            in the week. Run the dailies first.
          </p>
        </Answer>

        <Answer q="What does it mean that a promise is “3 days old”?">
          <p>
            Each daily rollup chains to the previous one, so a promise you haven&apos;t ticked carries
            forward and its age goes up. That age is the whole point: something at three days is not a
            fresh task, it&apos;s a thing that is quietly not happening.
          </p>
          <p>
            At three days or more the rollup starts suggesting wording you could send to ask for more
            time, because renegotiating is usually the real next step rather than trying harder.
            Ticking a promise anywhere — in a conversation, or in{" "}
            <Link href="/commitments" className="text-cyan-400 hover:underline">Open promises</Link> — stops the ageing.
          </p>
        </Answer>

        <Answer q="What is “Let go today” for?">
          <p>
            It lists what stopped being live today — loops that closed, tasks that resolved, things you
            decided not to do. It exists so nothing disappears without being named.
          </p>
          <p>
            The rule this app runs on is that a tracked thing is either still shown to you or explicitly
            logged as dropped, never silently removed. &ldquo;Let go today&rdquo; is where the second half
            of that happens.
          </p>
        </Answer>

        <Answer q="There are two search boxes. Which is which?">
          <p>
            The box on the conversations list filters <em>that list</em> — titles and overviews of your
            recordings, instantly, on this device.
          </p>
          <p>
            <Link href="/search" className="text-cyan-400 hover:underline">Search analyses</Link> is different: it searches
            the <em>text of the analyses themselves</em>, thesis and group, on the server. Use it when you
            remember something the model wrote rather than what the conversation was called.
          </p>
        </Answer>

        <Answer q="What does the number on the app icon mean?">
          <p>
            It is the count of promises not yet ticked, across every conversation you have run ADHD Aid
            on. It is the same number as the one on{" "}
            <Link href="/commitments" className="text-cyan-400 hover:underline">Open promises</Link>, which is where you can
            actually act on them.
          </p>
          <p>
            If it looks alarmingly high, that usually means promises have been extracted but never
            ticked off — the ledger is the place to work it down.
          </p>
        </Answer>

        <Answer q="What does “Send to Obsidian” actually write?">
          <p>
            A markdown file, via Obsidian&apos;s URI scheme, with the analysis as headed sections and a
            link back to the conversation. Nothing is uploaded anywhere — it opens Obsidian on the same
            device and hands it the text.
          </p>
          <p>
            <strong className="text-slate-100">Download .md</strong> is the same content as a plain file, for when you want
            it outside Obsidian.
          </p>
        </Answer>

        <Answer q="Where does my data live?">
          <p>
            Your browser is the working copy. Every analysis, rollup, person and place is written to
            this device&apos;s local storage first, which is why the app keeps working with no network.
          </p>
          <p>
            A private server-side mirror then copies it so the same data is on your phone and your
            desktop. If that mirror is unreachable the app carries on unchanged — you just lose
            cross-device sync until it comes back.
          </p>
        </Answer>

        <Answer q="What does an analysis cost, and can I stop one?">
          <p>
            Each run is one API call against the full transcript. Running <strong className="text-slate-100">Both</strong> is
            two. A daily rollup is one call on top of the per-conversation analyses it reads.
          </p>
          <p>
            Actual spend to date is on <Link href="/usage" className="text-cyan-400 hover:underline">Usage</Link>, broken
            down by feature and model. A run in progress can be stopped with the Stop button beside the
            progress indicator; anything already finished is kept.
          </p>
        </Answer>

        <Answer q="Keyboard shortcuts">
          <p>Available on every screen. Press <kbd className="font-mono text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5">?</kbd> anywhere to see this list.</p>
          <ul className="space-y-1.5 mt-2">
            {SHORTCUTS.map((s) => (
              <li key={s.keys} className="flex items-baseline gap-3">
                <kbd className="font-mono text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 flex-shrink-0 min-w-[3.5rem] text-center">
                  {s.keys}
                </kbd>
                <span>{s.label}</span>
              </li>
            ))}
          </ul>
        </Answer>
      </div>
    </main>
  );
}
