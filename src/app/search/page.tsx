"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchJson } from "@/lib/fetch-json";
import type { ConversationSearchResult, GroupSearchResult } from "@/lib/search";
import { ArrowLeftIcon, SearchIcon } from "@/components/icons";
import { LINK_BACK } from "@/lib/ui";

interface SearchResponse {
  configured: boolean;
  conversationResults: ConversationSearchResult[];
  groupResults: GroupSearchResult[];
}

const EMPTY: SearchResponse = { configured: true, conversationResults: [], groupResults: [] };
const DEBOUNCE_MS = 300;

function formatDate(date?: string): string {
  if (!date) return "";
  return date.length >= 10 ? date.slice(0, 10) : date;
}

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<SearchResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- kicks off the debounced fetch triggered by this query change; the fetch itself runs in a timeout callback, not synchronously
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      fetchJson<SearchResponse>(`/api/search?q=${encodeURIComponent(query.trim())}`)
        .then((data) => {
          setResult(data);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Search failed."))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const hasQuery = query.trim().length > 0;
  const hasResults = result.conversationResults.length > 0 || result.groupResults.length > 0;

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
        Archive
      </p>
      <h1 className="font-bold text-white mb-6">Search Analyses</h1>

      <div className="relative mb-6">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          aria-label="Search thesis and group analyses"
          type="text"
          value={query}
          onChange={(e) => {
            const value = e.target.value;
            setQuery(value);
            if (!value.trim()) {
              setResult(EMPTY);
              setLoading(false);
              setError(null);
            }
          }}
          placeholder="Search inside analysis text…"
          data-shortcut-search
          className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400"
        />
      </div>

      {error && <p role="alert" className="text-sm text-red-400 mb-4">{error}</p>}

      {!hasQuery && !error && (
        <p className="text-sm text-slate-400 font-serif italic">
          Search across every stored thesis analysis and group analysis.
        </p>
      )}

      {hasQuery && !result.configured && !error && (
        <p className="text-sm text-slate-400 font-serif italic">
          Search needs the server-side store configured (same one used for cross-device sync). Nothing to search yet.
        </p>
      )}

      {hasQuery && loading && <p className="text-sm text-slate-400 font-mono">Searching…</p>}

      {hasQuery && !loading && result.configured && !hasResults && !error && (
        <p className="text-sm text-slate-400 font-serif italic">No matches for &ldquo;{query.trim()}&rdquo;.</p>
      )}

      {result.conversationResults.length > 0 && (
        <section className="mb-8">
          <h2 className="text-slate-400 mb-3">Conversations</h2>
          <ul className="space-y-3 list-none">
            {result.conversationResults.map((r) => (
              <li key={r.conversationId} className="card p-4">
                <Link href={`/conversation/${r.conversationId}`} className="block">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-slate-200 font-serif font-medium">{r.title}</span>
                    <span className="text-xs font-mono text-slate-400 flex-shrink-0">{formatDate(r.date)}</span>
                  </div>
                  <div className="space-y-1.5">
                    {r.matches.map((m) => (
                      <div key={m.field} className="text-sm">
                        <span className="text-cyan-400 font-mono text-xs uppercase tracking-wide">{m.label}: </span>
                        <span className="text-slate-400 font-serif italic">{m.snippet}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.groupResults.length > 0 && (
        <section>
          <h2 className="text-slate-400 mb-3">Groups</h2>
          <ul className="space-y-3 list-none">
            {result.groupResults.map((r) => (
              <li key={r.conversationIds.join(",")} className="card p-4">
                <Link href={`/analyze-group?ids=${r.conversationIds.map(encodeURIComponent).join(",")}`} className="block">
                  <div className="text-slate-200 font-serif font-medium mb-2">
                    {r.conversationTitles.length > 0 ? r.conversationTitles.join(", ") : `${r.conversationIds.length} conversations`}
                  </div>
                  <div className="space-y-1.5">
                    {r.matches.map((m) => (
                      <div key={m.field} className="text-sm">
                        <span className="text-cyan-400 font-mono text-xs uppercase tracking-wide">{m.label}: </span>
                        <span className="text-slate-400 font-serif italic">{m.snippet}</span>
                      </div>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
