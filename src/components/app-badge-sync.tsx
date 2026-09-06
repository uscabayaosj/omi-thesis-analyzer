"use client";

import { useEffect } from "react";
import { ANALYSES_CHANGED_EVENT, syncAppBadge } from "@/lib/badge";
import { getAllAdhdAnalyses } from "@/lib/adhd-storage";

const ANALYSES_KEY = "omi-adhd-analyses";

// One parse of the namespace. The previous version listed the keys and then
// called getAdhdAnalysis() per key — each of which re-read and re-parsed the
// entire map — so a resync cost O(n²) JSON parsing: with a hundred analyses
// of ~10 KB each, roughly 100 MB of parsing on every page load, tab switch,
// and cross-device merge, on the main thread.
function readAnalyses() {
  try {
    return getAllAdhdAnalyses();
  } catch {
    return [];
  }
}

/**
 * Keeps the PWA icon badge in sync with state this component itself never
 * writes: a fresh page load, another tab's edit (`storage`), or a merged
 * background sync from another device (`ANALYSES_CHANGED_EVENT`). Same-tab
 * edits are already covered at the write choke point in adhd-storage.ts.
 */
export default function AppBadgeSync() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const resync = () => syncAppBadge(readAnalyses());
    resync();

    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === ANALYSES_KEY) resync();
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(ANALYSES_CHANGED_EVENT, resync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ANALYSES_CHANGED_EVENT, resync);
    };
  }, []);

  return null;
}
