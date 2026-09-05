import type { AbsSpan, SessionState } from "./types";

/**
 * When speech becomes a conversation. Pure rules, no clock of their own — the
 * caller passes `nowMs` — so they can be tested to the millisecond.
 */

/** Ninety silent seconds end a conversation — shortened from Omi's three
 *  minutes (2026-09-05) because back-to-back talks were merging; the
 *  "End conversation now" button covers anything in between. */
export const SESSION_GAP_MS = 90_000;
export const SESSION_MAX_WALL_MS = 4 * 3_600_000;
/** Keeps the assembled WAV (~86 MB) inside one function's memory and time. */
export const SESSION_MAX_VOICED_MS = 45 * 60_000;
/** Below this, nothing is worth a Deepgram call — the audio-level junk floor. */
export const SESSION_MIN_VOICED_MS = 2_000;

function fresh(span: AbsSpan, deviceId: string, id: string): SessionState {
  return {
    id,
    deviceId,
    startedAtMs: span.startMs,
    lastSpeechAtMs: span.endMs,
    voicedMs: span.endMs - span.startMs,
    spans: [span],
  };
}

export function placeSpan(
  open: SessionState | null,
  span: AbsSpan,
  newId: () => string,
  deviceId = open?.deviceId ?? "",
): { close: SessionState | null; open: SessionState } {
  if (!open) return { close: null, open: fresh(span, deviceId, newId()) };
  const gapExceeded = span.startMs - open.lastSpeechAtMs > SESSION_GAP_MS;
  const wallExceeded = span.endMs - open.startedAtMs > SESSION_MAX_WALL_MS;
  const voicedExceeded = open.voicedMs >= SESSION_MAX_VOICED_MS;
  if (gapExceeded || wallExceeded || voicedExceeded) {
    return { close: open, open: fresh(span, open.deviceId, newId()) };
  }
  return {
    close: null,
    open: {
      ...open,
      lastSpeechAtMs: Math.max(open.lastSpeechAtMs, span.endMs),
      voicedMs: open.voicedMs + (span.endMs - span.startMs),
      spans: [...open.spans, span],
    },
  };
}

export function isStale(open: SessionState, nowMs: number): boolean {
  return nowMs - open.lastSpeechAtMs > SESSION_GAP_MS;
}

export function disposition(s: SessionState): "transcribe" | "discard" {
  return s.voicedMs >= SESSION_MIN_VOICED_MS ? "transcribe" : "discard";
}
