"use client";

import { formatDateTime } from "./format";

/** The fields a title needs — the shape every conversation list item and the
 *  detail page's conversation already have. */
export interface TitleSource {
  created_at: string;
  structured?: { title?: string; category?: string } | null;
}

/**
 * What to call a conversation, in one place.
 *
 * TRACE-captured conversations carry no `structured.title` at all (that was
 * Omi's post-processing), and Omi left most of its own empty. The enrichment
 * pass exists to name them, and the ADHD pass writes a one-line gist; the home
 * list used both, but every other screen — the promises ledger, search
 * results, the rollup coverage list, group chips — read only the raw field and
 * showed "Untitled". Analyses were even *saved* with "Untitled", freezing the
 * gap into the record. Every display and every save now resolves through
 * here, so a name found anywhere is the name used everywhere.
 *
 * Preference order: the source's own title, then the enrichment title (the
 * pass whose job is naming), then the ADHD gist (a summary pressed into
 * service), then the timestamp with the category — never a bare placeholder.
 */
export function conversationTitle(
  convo: TitleSource,
  enrichment?: { title?: string } | null,
  gist?: string | null
): string {
  const own = convo.structured?.title?.trim();
  if (own) return own;
  const named = enrichment?.title?.trim();
  if (named) return named;
  const g = gist?.trim();
  if (g) return g;
  const when = formatDateTime(convo.created_at);
  const cat = convo.structured?.category?.trim();
  return cat ? `${when} · ${cat}` : when;
}
