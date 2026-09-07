"use client";

import type { Conversation, TranscriptSegment } from "./conversation-types";

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
    title: conversation.structured?.title?.trim() || fallbackTitle(conversation.created_at),
    quotes,
    othersPresent: others,
    lineCount: mine.length,
    speechSeconds,
    canPlay: conversation.source === "trace",
  };
}
