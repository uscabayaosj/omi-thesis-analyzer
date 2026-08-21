"use client";

import type { StoredAdhdAnalysis } from "./adhd-storage";

/** Dispatched whenever the ADHD-analyses store changes outside the normal
 * write path (e.g. a background sync merge) so listeners can react without
 * polling. */
export const ANALYSES_CHANGED_EVENT = "trace:adhd-analyses-changed";

export function notifyAnalysesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(ANALYSES_CHANGED_EVENT));
}

function countUnacknowledged(analyses: StoredAdhdAnalysis[]): number {
  return analyses.reduce((sum, a) => {
    const done = new Set(a.doneKeys ?? []);
    return sum + a.analysis.commitments.filter((c) => !done.has(c.key)).length;
  }, 0);
}

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
};

/**
 * Sets the PWA app icon badge to the count of commitments not yet marked
 * done. Only Chromium/Safari-iOS 16.4+ implement the Badging API, and only
 * when installed — everywhere else this is a silent no-op.
 */
export function syncAppBadge(analyses: StoredAdhdAnalysis[]): void {
  if (typeof navigator === "undefined") return;
  const setAppBadge = (navigator as BadgeNavigator).setAppBadge;
  if (!setAppBadge) return;
  const count = countUnacknowledged(analyses);
  setAppBadge.call(navigator, count).catch(() => {});
}
