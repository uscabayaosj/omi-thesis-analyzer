"use client";

import { fetchJson } from "./fetch-json";
import { SYNCED_NAMESPACES } from "./kv";

interface ExportResponse {
  configured: boolean;
  exportedAt?: string;
  namespaces?: Record<string, unknown>;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function download(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Reads every synced namespace straight from this browser's localStorage,
 *  for when the server store isn't configured — the same fallback posture
 *  the rest of the app takes when `configured:false` comes back from any
 *  store-backed route. */
function exportFromLocalStorage(): void {
  const namespaces: Record<string, unknown> = {};
  for (const ns of SYNCED_NAMESPACES) {
    try {
      const raw = localStorage.getItem(ns);
      namespaces[ns] = raw ? JSON.parse(raw) : null;
    } catch {
      namespaces[ns] = null;
    }
  }
  download(`trace-backup-${todayStr()}.json`, {
    source: "local",
    exportedAt: new Date().toISOString(),
    namespaces,
  });
}

export async function exportAllData(): Promise<void> {
  const res = await fetchJson<ExportResponse>("/api/export");

  if (!res.configured) {
    exportFromLocalStorage();
    return;
  }

  download(`trace-backup-${todayStr()}.json`, {
    source: "server",
    exportedAt: res.exportedAt,
    namespaces: res.namespaces,
  });
}
