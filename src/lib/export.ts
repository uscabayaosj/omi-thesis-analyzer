"use client";

import { fetchJson } from "./fetch-json";
import { SYNCED_NAMESPACES } from "./kv";

type ExportResponse =
  | { configured: false }
  | { configured: true; exportedAt: string; namespaces: Record<string, unknown> };

/** Local date+time, filename-safe. Local (not UTC) so an evening backup
 *  isn't stamped with tomorrow's date, and time-stamped so two backups on
 *  the same day don't collide. */
function stampStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
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
  download(`trace-backup-${stampStr()}.json`, {
    source: "local",
    exportedAt: new Date().toISOString(),
    namespaces,
  });
}

export async function exportAllData(): Promise<"server" | "local"> {
  const res = await fetchJson<ExportResponse>("/api/export");

  if (!res.configured) {
    exportFromLocalStorage();
    return "local";
  }

  download(`trace-backup-${stampStr()}.json`, {
    source: "server",
    exportedAt: res.exportedAt,
    namespaces: res.namespaces,
  });
  return "server";
}
