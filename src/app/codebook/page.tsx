"use client";

/**
 * The Codebook.
 *
 * Eight analyses per conversation are evidence; a dissertation needs them
 * sorted into named categories with the excerpt, the conversation and the
 * date beside each one. This page is that codebook. The researcher owns the
 * codes; the model only proposes excerpts (verbatim, checked server-side),
 * and each proposal is accepted or discarded one tick at a time.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fetchJson } from "@/lib/fetch-json";
import { addDays, dayOf, mondayOf, todayString } from "@/lib/format";
import { getStoredAnalyses, type StoredAnalysis } from "@/lib/storage";
import {
  THESIS_FIELD_LABELS, THESIS_FIELDS, buildCodebookMarkdown, weeklyCounts,
  type Code, type CodeEvidence, type Suggestion,
} from "@/lib/codebook";
import {
  getCodes, createCode, findCodeByName, updateCode, deleteCode, restoreCode,
  getEvidence, addEvidence, deleteEvidence, restoreEvidence,
} from "@/lib/codebook-storage";
import { pullAndMerge } from "@/lib/sync";
import { useUndoOffer } from "@/components/UndoProvider";
import { useDocumentTitle } from "@/lib/use-document-title";
import {
  ArrowLeftIcon, BookIcon, CheckSquareIcon, SquareIcon, DownloadIcon, LoaderIcon, SparklesIcon, TrashIcon, XIcon,
} from "@/components/icons";
import { BUTTON_PRIMARY, BUTTON_GHOST, BUTTON_SECONDARY, LINK_BACK, optionLabel } from "@/lib/ui";

const INPUT = "w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400";
const LABEL = "font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400";

/** Eight weekly bars, one hue, height by count. A code still gaining
 *  excerpts is not saturated — that is the whole reading. */
function SaturationStrip({ evidence }: { evidence: CodeEvidence[] }) {
  const weeks = useMemo(() => weeklyCounts(evidence, mondayOf, addDays, todayString()), [evidence]);
  const max = Math.max(1, ...weeks.map((w) => w.count));
  const total = weeks.reduce((s, w) => s + w.count, 0);
  return (
    <div className="flex items-end gap-2" aria-label={`New excerpts per week, last 8 weeks: ${weeks.map((w) => w.count).join(", ")}`}>
      <div className="flex items-end gap-[3px] h-6" role="img" aria-hidden="true">
        {weeks.map((w) => (
          <span
            key={w.week}
            title={`Week of ${w.week}: ${w.count}`}
            className={`w-2 rounded-t-[2px] ${w.count ? "bg-cyan-400" : "bg-slate-700"}`}
            style={{ height: `${w.count ? Math.max(3, Math.round((w.count / max) * 24)) : 2}px` }}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-slate-500">{total} in 8 wks</span>
    </div>
  );
}

function CodeCard({
  code, evidence, onEdit, onDelete, onDeleteEvidence,
}: {
  code: Code;
  evidence: CodeEvidence[];
  onEdit: (patch: { name: string; description: string }) => void;
  onDelete: () => void;
  onDeleteEvidence: (e: CodeEvidence) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(code.name);
  const [desc, setDesc] = useState(code.description);
  const convoCount = new Set(evidence.map((e) => e.conversationId)).size;

  return (
    <li className="card overflow-hidden">
      <div className="px-5 py-4 flex items-start justify-between gap-3">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-left min-w-0 flex-1 min-h-[44px]">
          <span className="text-slate-100 font-serif font-semibold block">{code.name}</span>
          {code.description && <span className="text-sm text-slate-400 block mt-0.5">{code.description}</span>}
          <span className="font-mono text-xs text-slate-500 block mt-1.5">
            {evidence.length} excerpt{evidence.length === 1 ? "" : "s"} · {convoCount} conversation{convoCount === 1 ? "" : "s"}
          </span>
        </button>
        <SaturationStrip evidence={evidence} />
      </div>
      {open && (
        <div className="px-5 pb-5 border-t border-slate-800 pt-4">
          {editing ? (
            <form
              onSubmit={(e) => { e.preventDefault(); onEdit({ name, description: desc }); setEditing(false); }}
              className="space-y-2 mb-4"
            >
              <input aria-label="Code name" value={name} onChange={(e) => setName(e.target.value)} className={INPUT} required />
              <input aria-label="Code description" value={desc} onChange={(e) => setDesc(e.target.value)} className={INPUT} placeholder="What counts as this code" />
              <div className="flex gap-2">
                <button type="submit" className={`${BUTTON_PRIMARY} px-4`}>Save</button>
                <button type="button" onClick={() => { setEditing(false); setName(code.name); setDesc(code.description); }} className={BUTTON_GHOST}>Cancel</button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-1 mb-3 -ml-3">
              {/* The form reads the code's current values when editing
                  starts, so a sync pull that renamed the code between
                  renders is not overwritten by stale initial state. */}
              <button type="button" onClick={() => { setName(code.name); setDesc(code.description); setEditing(true); }} className={BUTTON_GHOST}>Edit</button>
              <button type="button" onClick={onDelete} className={BUTTON_GHOST}><TrashIcon className="w-4 h-4" /> Delete code</button>
            </div>
          )}
          {evidence.length === 0 ? (
            <p className="text-sm text-slate-400 font-serif italic">No excerpts yet. Suggest from a conversation, or add one by hand.</p>
          ) : (
            <ul className="space-y-3 list-none">
              {evidence.map((e) => (
                <li key={e.id} className="text-sm">
                  <blockquote className="border-l-2 border-cyan-500/50 pl-3 text-slate-200 font-serif">{e.excerpt}</blockquote>
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pl-3">
                    <Link href={`/conversation/${e.conversationId}`} className="text-xs text-slate-400 hover:text-white hover:underline min-h-[44px] inline-flex items-center">
                      {e.conversationTitle}{e.date ? ` · ${e.date}` : ""} · {THESIS_FIELD_LABELS[e.field] ?? e.field}
                      {e.source === "manual" && <span className="ml-1 font-mono text-[10px] text-slate-500">manual</span>}
                    </Link>
                    <button type="button" onClick={() => onDeleteEvidence(e)} aria-label="Remove excerpt" className={BUTTON_GHOST}><XIcon className="w-4 h-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function CodebookPageInner() {
  useDocumentTitle("Codebook");
  const { offerUndo } = useUndoOffer();
  const params = useSearchParams();
  const [codes, setCodes] = useState<Code[]>([]);
  const [evidence, setEvidence] = useState<CodeEvidence[]>([]);
  const [analyses, setAnalyses] = useState<StoredAnalysis[]>([]);

  const reload = useCallback(() => {
    setCodes(getCodes());
    setEvidence(getEvidence());
    setAnalyses(getStoredAnalyses().slice().sort((a, b) => (b.date ?? b.timestamp).localeCompare(a.date ?? a.timestamp)));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads localStorage on mount, which is only available client-side after hydration
    reload();
    pullAndMerge().then((changed) => { if (changed) reload(); }).catch(() => {});
  }, [reload]);

  // ── new code ──
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [dupName, setDupName] = useState<string | null>(null);

  // ── suggest ──
  const [suggestId, setSuggestId] = useState(params.get("suggest") ?? "");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // ── manual excerpt ──
  const [manualCode, setManualCode] = useState("");
  const [manualConvo, setManualConvo] = useState("");
  const [manualField, setManualField] = useState(THESIS_FIELDS[0]);
  const [manualText, setManualText] = useState("");

  const byCode = useMemo(() => {
    const m = new Map<string, CodeEvidence[]>();
    for (const e of evidence) {
      const list = m.get(e.codeId);
      if (list) list.push(e);
      else m.set(e.codeId, [e]);
    }
    return m;
  }, [evidence]);

  const codedConvos = useMemo(() => new Set(evidence.map((e) => e.conversationId)).size, [evidence]);
  const suggestTarget = useMemo(() => analyses.find((a) => a.conversationId === suggestId) ?? null, [analyses, suggestId]);

  const runSuggest = useCallback(async () => {
    if (!suggestTarget || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestion(null);
    try {
      const analysis: Record<string, string> = {};
      for (const f of THESIS_FIELDS) analysis[f] = (suggestTarget as unknown as Record<string, string>)[f] ?? "";
      const data = await fetchJson<Suggestion>("/api/codebook/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: suggestTarget.title,
          analysis,
          codes: codes.map((c) => ({ id: c.id, name: c.name, description: c.description })),
        }),
      });
      setSuggestion(data);
      const all = new Set<string>();
      data.applications.forEach((_, i) => all.add(`a${i}`));
      data.proposed.forEach((_, i) => all.add(`p${i}`));
      setTicked(all);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : "Suggestion failed.");
    } finally {
      setSuggesting(false);
    }
  }, [suggestTarget, suggesting, codes]);

  const acceptSuggestion = useCallback(() => {
    if (!suggestion || !suggestTarget) return;
    const date = suggestTarget.date ? dayOf(suggestTarget.date) : undefined;
    const base = { conversationId: suggestTarget.conversationId, conversationTitle: suggestTarget.title, date, source: "suggested" as const };
    const items: Omit<CodeEvidence, "id" | "timestamp">[] = [];
    // Codes can change between Suggest and Accept (deleted here, or on
    // another device and pulled in). Re-read rather than trust the render.
    const live = new Set(getCodes().map((c) => c.id));
    suggestion.applications.forEach((a, i) => {
      if (ticked.has(`a${i}`) && live.has(a.codeId)) items.push({ ...base, codeId: a.codeId, field: a.field, excerpt: a.excerpt });
    });
    suggestion.proposed.forEach((p, i) => {
      if (!ticked.has(`p${i}`)) return;
      // A proposal that already exists as a code (the model re-proposing
      // one it was given, or two proposals with the same name) reuses it.
      const code = findCodeByName(p.name) ?? createCode({ name: p.name, description: p.description });
      items.push({ ...base, codeId: code.id, field: p.field, excerpt: p.excerpt });
    });
    addEvidence(items);
    setSuggestion(null);
    reload();
  }, [suggestion, suggestTarget, ticked, reload]);

  const addManual = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const convo = analyses.find((a) => a.conversationId === manualConvo);
    if (!manualCode || !convo || !manualText.trim()) return;
    addEvidence([{
      codeId: manualCode,
      conversationId: convo.conversationId,
      conversationTitle: convo.title,
      date: convo.date ? dayOf(convo.date) : undefined,
      field: manualField,
      excerpt: manualText.trim().slice(0, 600),
      source: "manual",
    }]);
    setManualText("");
    reload();
  }, [analyses, manualCode, manualConvo, manualField, manualText, reload]);

  const exportMarkdown = useCallback(() => {
    const { markdown, filename } = buildCodebookMarkdown(codes, evidence);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [codes, evidence]);

  const toggleTick = (k: string) => setTicked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const codeName = (id: string) => codes.find((c) => c.id === id)?.name ?? id;

  return (
    <main id="main" tabIndex={-1} className="max-w-3xl mx-auto px-4 py-8">
      <Link href="/" className={LINK_BACK}>
        <ArrowLeftIcon className="w-4 h-4" />
        Back to conversations
      </Link>

      <header className="mb-6">
        <h1 className="font-bold text-white flex items-center gap-2">
          <BookIcon className="w-5 h-5 text-cyan-400 flex-shrink-0" />
          Codebook
        </h1>
        <p className="font-serif italic text-slate-400 mt-1">
          Named codes, each with verbatim excerpts from the thesis analyses that evidence it.
        </p>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-slate-400">
          <div><dt className="inline">Codes </dt><dd className="inline text-slate-200">{codes.length}</dd></div>
          <div><dt className="inline">Excerpts </dt><dd className="inline text-slate-200">{evidence.length}</dd></div>
          <div><dt className="inline">Conversations coded </dt><dd className="inline text-slate-200">{codedConvos}</dd></div>
        </dl>
      </header>

      {/* Suggest */}
      <section className="card p-4 mb-4" aria-labelledby="suggest-h">
        <h2 id="suggest-h" className="text-slate-200 mb-2 flex items-center gap-2"><SparklesIcon className="w-4 h-4 text-cyan-400" /> Suggest from a conversation</h2>
        {analyses.length === 0 ? (
          <p className="text-sm text-slate-400 font-serif italic">Run the thesis lens on a conversation first; the codebook works from those analyses.</p>
        ) : (
          <div className="flex flex-col sm:flex-row gap-2">
            <select aria-label="Conversation to code" value={suggestId} onChange={(e) => { setSuggestId(e.target.value); setSuggestion(null); }} className={`${INPUT} flex-1`}>
              <option value="">Choose an analyzed conversation…</option>
              {analyses.map((a) => (
                <option key={a.conversationId} value={a.conversationId}>
                  {a.date ? `${dayOf(a.date)} · ` : ""}{optionLabel(a.title)}
                </option>
              ))}
            </select>
            <button type="button" onClick={runSuggest} disabled={!suggestTarget || suggesting} className={`${BUTTON_PRIMARY} px-4 inline-flex items-center gap-1.5 justify-center`}>
              {suggesting ? <LoaderIcon className="w-4 h-4 animate-spin" /> : <SparklesIcon className="w-4 h-4" />}
              {suggesting ? "Reading…" : "Suggest"}
            </button>
          </div>
        )}
        {suggestError && <p role="alert" className="mt-3 text-sm text-red-400">{suggestError}</p>}
        {suggestion && (
          <div className="mt-4 space-y-4">
            {suggestion.applications.length === 0 && suggestion.proposed.length === 0 && (
              <p className="text-sm text-slate-400 font-serif italic">Nothing verifiable to suggest for this conversation.</p>
            )}
            {suggestion.applications.length > 0 && (
              <div>
                <p className={LABEL}>Excerpts for existing codes</p>
                <ul className="mt-2 space-y-2 list-none">
                  {suggestion.applications.map((a, i) => {
                    const k = `a${i}`;
                    const on = ticked.has(k);
                    return (
                      <li key={k}>
                        <button type="button" onClick={() => toggleTick(k)} aria-pressed={on} className="w-full text-left flex items-start gap-2 min-h-[44px] py-1">
                          {on ? <CheckSquareIcon className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" /> : <SquareIcon className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />}
                          <span className="min-w-0">
                            <span className="text-xs font-mono text-cyan-300">{codeName(a.codeId)}</span>
                            <span className="text-xs text-slate-500"> · {THESIS_FIELD_LABELS[a.field]}</span>
                            <span className="block text-sm text-slate-200 font-serif">{a.excerpt}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {suggestion.proposed.length > 0 && (
              <div>
                <p className={LABEL}>Proposed new codes</p>
                <ul className="mt-2 space-y-2 list-none">
                  {suggestion.proposed.map((p, i) => {
                    const k = `p${i}`;
                    const on = ticked.has(k);
                    return (
                      <li key={k}>
                        <button type="button" onClick={() => toggleTick(k)} aria-pressed={on} className="w-full text-left flex items-start gap-2 min-h-[44px] py-1">
                          {on ? <CheckSquareIcon className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" /> : <SquareIcon className="w-4 h-4 text-slate-500 flex-shrink-0 mt-0.5" />}
                          <span className="min-w-0">
                            <span className="text-sm text-slate-100 font-semibold">{p.name}</span>
                            <span className="block text-xs text-slate-400">{p.description}</span>
                            <span className="block text-sm text-slate-200 font-serif mt-1">{p.excerpt}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            {(suggestion.applications.length > 0 || suggestion.proposed.length > 0) && (
              <div className="flex gap-2">
                <button type="button" onClick={acceptSuggestion} disabled={ticked.size === 0} className={`${BUTTON_PRIMARY} px-4`}>
                  Accept {ticked.size} ticked
                </button>
                <button type="button" onClick={() => setSuggestion(null)} className={BUTTON_GHOST}>Discard</button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* New code + manual excerpt */}
      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            if (findCodeByName(newName)) { setDupName(newName.trim()); return; }
            setDupName(null);
            createCode({ name: newName, description: newDesc });
            setNewName(""); setNewDesc(""); reload();
          }}
          className="card p-4 space-y-2"
        >
          <h2 className="text-slate-200">New code</h2>
          <input aria-label="New code name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={INPUT} />
          <input aria-label="New code description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="What counts as this code" className={INPUT} />
          {dupName && <p role="alert" className="text-sm text-amber-400">A code named &ldquo;{dupName}&rdquo; already exists.</p>}
          <button type="submit" disabled={!newName.trim()} className={`${BUTTON_SECONDARY} justify-center w-full`}>Add code</button>
        </form>

        <form onSubmit={addManual} className="card p-4 space-y-2">
          <h2 className="text-slate-200">Excerpt by hand</h2>
          <select aria-label="Code" value={manualCode} onChange={(e) => setManualCode(e.target.value)} className={INPUT}>
            <option value="">Code…</option>
            {codes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Conversation" value={manualConvo} onChange={(e) => setManualConvo(e.target.value)} className={INPUT}>
            <option value="">Conversation…</option>
            {analyses.map((a) => <option key={a.conversationId} value={a.conversationId}>{optionLabel(a.title)}</option>)}
          </select>
          <select aria-label="Dimension" value={manualField} onChange={(e) => setManualField(e.target.value)} className={INPUT}>
            {THESIS_FIELDS.map((f) => <option key={f} value={f}>{THESIS_FIELD_LABELS[f]}</option>)}
          </select>
          <textarea aria-label="Excerpt" value={manualText} onChange={(e) => setManualText(e.target.value)} rows={2} placeholder="Paste the excerpt" className={`${INPUT} resize-y`} />
          <button type="submit" disabled={!manualCode || !manualConvo || !manualText.trim()} className={`${BUTTON_SECONDARY} justify-center w-full`}>Add excerpt</button>
        </form>
      </div>

      <section aria-label="Codes">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 className="text-slate-400">Codes ({codes.length})</h2>
          {codes.length > 0 && (
            <button type="button" onClick={exportMarkdown} className={BUTTON_GHOST}><DownloadIcon className="w-4 h-4" /> Export markdown</button>
          )}
        </div>
        {codes.length === 0 ? (
          <p className="text-sm text-slate-400 font-serif italic">No codes yet. Add one above, or let a suggestion propose the first few.</p>
        ) : (
          <ul className="space-y-3 list-none">
            {codes.map((c) => (
              <CodeCard
                key={c.id}
                code={c}
                evidence={byCode.get(c.id) ?? []}
                onEdit={(patch) => { updateCode(c.id, patch); reload(); }}
                onDelete={() => {
                  const removed = deleteCode(c.id);
                  if (!removed) return;
                  reload();
                  offerUndo(`Deleted code "${c.name}"`, () => { restoreCode(removed.code, removed.evidence); reload(); });
                }}
                onDeleteEvidence={(e) => {
                  const removed = deleteEvidence(e.id);
                  if (!removed) return;
                  reload();
                  offerUndo("Excerpt removed", () => { restoreEvidence(removed); reload(); });
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

export default function CodebookPage() {
  return (
    <Suspense fallback={null}>
      <CodebookPageInner />
    </Suspense>
  );
}
