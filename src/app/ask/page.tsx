"use client";

/**
 * Ask the Corpus.
 *
 * Search finds a phrase the model once wrote. This answers a question across
 * everything it has written — every thesis analysis and group analysis — and
 * cites which conversation each claim came from. Runs only on an explicit
 * Ask; answers are kept, so the archive of questions becomes its own record
 * and re-reading one costs nothing.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import { dayOf, formatDateTime } from "@/lib/format";
import { normalizeQuestion, type AskSource } from "@/lib/ask";
import { getInquiries, saveInquiry, deleteInquiry, restoreInquiry, type StoredInquiry } from "@/lib/ask-storage";
import { pullAndMerge } from "@/lib/sync";
import { useUndoOffer } from "@/components/UndoProvider";
import { useDocumentTitle } from "@/lib/use-document-title";
import { ArrowLeftIcon, MessageIcon, LoaderIcon, TrashIcon } from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_GHOST, LINK_BACK } from "@/lib/ui";

interface AskResponse {
  answer: string;
  sources: AskSource[];
  passageCount: number;
  skipped?: boolean;
}

const MAX_QUESTION = 1000;

function sourceHref(s: AskSource): string {
  if (s.kind === "conversation" && s.conversationId) return `/conversation/${s.conversationId}`;
  if (s.conversationIds?.length) return `/analyze-group?ids=${s.conversationIds.map(encodeURIComponent).join(",")}`;
  return "/";
}

/** Turn "[C2]" tags into links to their sources; unknown tags stay text. */
function CitedText({ text, sources }: { text: string; sources: AskSource[] }) {
  const byTag = useMemo(() => new Map(sources.map((s) => [s.tag, s])), [sources]);
  const paragraphs = text.split(/\n{2,}|\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="space-y-3 text-sm text-slate-200 leading-relaxed">
      {paragraphs.map((p, i) => {
        const parts: ReactNode[] = [];
        const re = /\[([CG]\d+)(?:\s*,\s*([CG]\d+))*\]/g;
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(p)) !== null) {
          if (m.index > last) parts.push(p.slice(last, m.index));
          const tags = m[0].slice(1, -1).split(/\s*,\s*/);
          tags.forEach((tag, j) => {
            const s = byTag.get(tag);
            parts.push(
              s ? (
                <Link
                  key={`${i}-${m!.index}-${j}`}
                  href={sourceHref(s)}
                  title={`${s.title} — ${s.label}`}
                  className="font-mono text-[11px] text-cyan-300 hover:text-cyan-200 hover:underline align-baseline"
                >
                  [{tag}]
                </Link>
              ) : (
                <span key={`${i}-${m!.index}-${j}`} className="font-mono text-[11px] text-slate-400">[{tag}]</span>
              ),
            );
          });
          last = m.index + m[0].length;
        }
        if (last < p.length) parts.push(p.slice(last));
        return <p key={i}>{parts}</p>;
      })}
    </div>
  );
}

function SourceList({ sources }: { sources: AskSource[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="mt-4 group">
      <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400 hover:text-slate-300 min-h-[44px] flex items-center">
        Sources ({sources.length})
      </summary>
      <ul className="mt-2 space-y-1 list-none">
        {sources.map((s) => (
          <li key={s.tag} className="text-sm flex items-baseline gap-2">
            <span className="font-mono text-[11px] text-cyan-300 flex-shrink-0 min-w-[2.2rem]">[{s.tag}]</span>
            <Link href={sourceHref(s)} className="text-slate-300 hover:text-white hover:underline min-w-0">
              <span className="text-slate-200">{s.title}</span>
              <span className="text-slate-400"> — {s.label}</span>
              {s.date && <span className="text-slate-500 font-mono text-xs"> · {dayOf(s.date)}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function AskPage() {
  useDocumentTitle("Ask the corpus");
  const { offerUndo } = useUndoOffer();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inquiries, setInquiries] = useState<StoredInquiry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(() => setInquiries(getInquiries()), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage on mount, which is only available client-side after hydration
    reload();
    pullAndMerge().then((changed) => { if (changed) reload(); }).catch(() => {});
  }, [reload]);

  const trimmed = question.trim();
  const previous = useMemo(() => {
    const n = normalizeQuestion(trimmed);
    return n ? inquiries.find((i) => normalizeQuestion(i.question) === n) ?? null : null;
  }, [trimmed, inquiries]);

  const ask = useCallback(async () => {
    if (!trimmed || asking) return;
    setAsking(true);
    setError(null);
    try {
      const data = await fetchJson<AskResponse>("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      if (data.skipped) {
        setError(data.answer);
        return;
      }
      const stored = saveInquiry({ question: trimmed, answer: data.answer, sources: data.sources, passageCount: data.passageCount });
      setQuestion("");
      reload();
      setOpenId(stored.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ask failed.");
    } finally {
      setAsking(false);
    }
  }, [trimmed, asking, reload]);

  const remove = useCallback((inq: StoredInquiry) => {
    const removed = deleteInquiry(inq.id);
    if (!removed) return;
    reload();
    offerUndo("Question removed", () => { restoreInquiry(removed); reload(); });
  }, [reload, offerUndo]);

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <h1 className="font-bold text-white flex items-center gap-2">
          <MessageIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
          Ask the corpus
        </h1>
        <p className="font-serif italic text-slate-400 mt-1">
          A question across every stored thesis and group analysis, answered with citations.
        </p>
      </header>

      <form
        onSubmit={(e) => { e.preventDefault(); void ask(); }}
        className="card p-4 mb-6"
      >
        <label htmlFor="ask-question" className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">Question</label>
        <textarea
          id="ask-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, MAX_QUESTION))}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void ask(); } }}
          rows={3}
          placeholder="e.g. How do ranchers talk about the Water Compact when tribal members are not present?"
          data-shortcut-search
          className="mt-1.5 w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400 resize-y"
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-slate-500 font-mono">{trimmed.length}/{MAX_QUESTION} · ⌘↵ to ask</span>
          <div className="flex items-center gap-2">
            {previous && (
              <button type="button" onClick={() => { setOpenId(previous.id); setQuestion(""); }} className={BUTTON_GHOST}>
                Asked before — show that answer
              </button>
            )}
            <button type="submit" disabled={!trimmed || asking} className={`${BUTTON_PRIMARY} px-4 py-2 inline-flex items-center gap-1.5`}>
              {asking ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <MessageIcon className="w-4 h-4" />}
              {asking ? "Reading the archive…" : previous ? "Ask again anyway" : "Ask"}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
      </form>

      {inquiries.length === 0 ? (
        <p className="text-sm text-slate-400 font-serif italic">
          Nothing asked yet. Answers are kept here, newest first, so the questions you ask become part of the record.
        </p>
      ) : (
        <section aria-label="Past questions">
          <h2 className="text-slate-400 mb-3">Questions ({inquiries.length})</h2>
          <ul className="space-y-3 list-none">
            {inquiries.map((inq) => {
              const open = openId === inq.id;
              return (
                <li key={inq.id} className="card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : inq.id)}
                    aria-expanded={open}
                    className="w-full text-left px-5 py-4 min-h-[44px] flex items-start justify-between gap-3 hover:bg-slate-800/40 transition-colors"
                  >
                    <span className="text-slate-100 font-serif font-semibold">{inq.question}</span>
                    <span className="font-mono text-xs text-slate-400 flex-shrink-0">
                      {formatDateTime(inq.askedAt ?? inq.timestamp, { month: "short", day: "numeric" })}
                    </span>
                  </button>
                  {open && (
                    <div className="px-5 pb-5">
                      <CitedText text={inq.answer} sources={inq.sources} />
                      <SourceList sources={inq.sources} />
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">{inq.passageCount} passages read</span>
                        <button type="button" onClick={() => remove(inq)} className={BUTTON_GHOST}>
                          <TrashIcon className="w-4 h-4" /> Remove
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
