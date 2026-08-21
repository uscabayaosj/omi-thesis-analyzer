"use client";

import { useEffect } from "react";
import { ANALYSES_CHANGED_EVENT, syncAppBadge } from "@/lib/badge";
import { getAdhdAnalysis } from "@/lib/adhd-storage";

const ANALYSES_KEY = "omi-adhd-analyses";

function readAnalyses() {
  try {
    const raw = localStorage.getItem(ANALYSES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.keys(parsed)
      .map((id) => getAdhdAnalysis(id))
      .filter((a): a is NonNullable<typeof a> => a !== null);
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
