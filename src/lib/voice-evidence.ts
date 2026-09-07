"use client";

import type { Conversation, TranscriptSegment } from "./conversation-types";
import { fetchJson } from "./fetch-json.ts";

/** Everything the review card needs to let a person answer "who is this?",
 *  derived entirely from the conversation the suggestion already points at.
 *  No LLM, no new API — the transcript already knows all of it. */
export interface VoiceEvidence {
  title: string;
  /** ≤3 of this speaker's longest lines, shown in the order spoken. */
  quotes: string[];
  /** Distinct names of the speakers who *were* recognized here. */
  othersPresent: string[];
  lineCount: number;
  /** 0 when the transcript carries no per-segment timings (Omi imports). */
  speechSeconds: number;
  /** Omi-imported conversations have no archived audio and never will. */
  canPlay: boolean;
}

const MAX_QUOTES = 3;
const MAX_QUOTE_CHARS = 140;

/** Cuts on a word boundary: "wor…" reads as a typo, not an elision. Falls back
 *  to a hard cut only when the first 140 characters contain no late space. */
function truncate(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const body = space > max / 2 ? cut.slice(0, space) : cut;
  return `${body.trimEnd()}…`;
}

function speakerOf(s: TranscriptSegment): number {
  return s.speaker_id ?? 0;
}

function fallbackTitle(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "Untitled conversation";
  return d.toLocaleString(undefined, {
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** The one rule for what a conversation is called, everywhere it's shown as a
 *  link or heading: its own title if it has one, else a time-derived stand-in.
 *  Pulled out of `buildVoiceEvidence` so a second caller (the group-members
 *  link list) can't drift from this by restating the `??`/`trim()` logic. */
export function conversationTitle(conversation: Conversation): string {
  return conversation.structured?.title?.trim() || fallbackTitle(conversation.created_at);
}

export function buildVoiceEvidence(conversation: Conversation, speakerId: number): VoiceEvidence {
  const segments = conversation.transcript_segments ?? [];
  const mine = segments.filter((s) => speakerOf(s) === speakerId);

  // Longest-first, because the opening lines of a diarized cluster are
  // disproportionately "yeah" / "mm-hm" — onset noise that identifies nobody.
  // Re-sorted to spoken order afterwards so the block still reads as speech.
  const quotes = mine
    .map((s, i) => ({ i, text: s.text.trim() }))
    .filter((q) => q.text.length > 0)
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, MAX_QUOTES)
    .sort((a, b) => a.i - b.i)
    .map((q) => truncate(q.text, MAX_QUOTE_CHARS));

  const others: string[] = [];
  for (const s of segments) {
    if (speakerOf(s) === speakerId) continue;
    const name = s.speaker_name?.trim();
    if (name && !others.includes(name)) others.push(name);
  }

  const speechSeconds = mine.reduce((total, s) => {
    return typeof s.start === "number" && typeof s.end === "number" && s.end > s.start
      ? total + (s.end - s.start)
      : total;
  }, 0);

  return {
    title: conversationTitle(conversation),
    quotes,
    othersPresent: others,
    lineCount: mine.length,
    speechSeconds,
    canPlay: conversation.source === "trace",
  };
}

/** One in-flight request per conversation, shared by every card that needs it.
 *  A 44-card queue can span far fewer conversations, and grouping makes several
 *  cards share one outright. The route is `immutable, max-age=86400` for a
 *  finished conversation, so a resolved entry is kept for the page's lifetime;
 *  a rejected one is evicted so the next card can retry. */
const conversationCache = new Map<string, Promise<Conversation>>();

export function loadConversationCached(id: string): Promise<Conversation> {
  const hit = conversationCache.get(id);
  if (hit) return hit;
  const p = fetchJson<Conversation>(`/api/conversations/${id}`);
  p.catch(() => conversationCache.delete(id));
  conversationCache.set(id, p);
  return p;
}

/** Test-only. Nothing in the app clears this — a page load is the reset. */
export function resetConversationCache(): void {
  conversationCache.clear();
}
