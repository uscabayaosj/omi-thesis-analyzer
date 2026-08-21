"use client";

import { SYNCED_NAMESPACES, type SyncedNamespace } from "@/lib/kv";
import { notifyAnalysesChanged } from "@/lib/badge";

const ANALYSES_NS = "omi-adhd-analyses";

/**
 * Cross-device sync for the analysis stores.
 *
 * Design: localStorage stays the synchronous source the UI reads, so every
 * existing call site keeps working unchanged and the app still runs fully
 * offline. This layer mirrors those maps to the server — pull-and-merge when a
 * page loads, push after each write. The server is durability, not latency.
 *
 * Conflict rule: last write wins, per record, by the `timestamp` the storage
 * libs already stamp on every record. Two devices editing the *same*
 * conversation within one sync window is the only lossy case, and for a
 * single-user tool that is an acceptable trade against the complexity of real
 * causal merging.
 */

type RecordMap = Record<string, { timestamp?: string } & Record<string, unknown>>;

function readLocal(ns: string): RecordMap {
  try {
    const raw = localStorage.getItem(ns);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(ns: string, map: RecordMap): void {
  try {
    localStorage.setItem(ns, JSON.stringify(map));
  } catch (e) {
    console.error(`Failed to write ${ns}:`, e);
  }
}

/** Newest `timestamp` wins; a record only one side has is always kept. */
function mergeMaps(local: RecordMap, remote: RecordMap): RecordMap {
  const merged: RecordMap = { ...remote };
  for (const [id, localRec] of Object.entries(local)) {
    const remoteRec = remote[id];
    if (!remoteRec) {
      merged[id] = localRec;
      continue;
    }
    const l = localRec?.timestamp ?? "";
    const r = remoteRec?.timestamp ?? "";
    merged[id] = l > r ? localRec : remoteRec;
  }
  return merged;
}

// The group-analyses namespace is an array, not a keyed map, so it can't use
// the per-record merge above. It is also the one store where a whole-list
// replace is harmless: entries are keyed by their conversation-id set and
// re-runnable. Newest-list-wins by its first entry's timestamp.
function isArrayNamespace(ns: string): boolean {
  return ns === "omi-thesis-group-analyses";
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingPush = new Set<SyncedNamespace>();

/**
 * Queue a namespace to be mirrored to the server. Debounced: a batch run
 * writes the same namespace once per conversation, and each of those would
 * otherwise be its own request.
 */
export function schedulePush(ns: SyncedNamespace): void {
  if (typeof window === "undefined") return;
  pendingPush.add(ns);
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const namespaces = Array.from(pendingPush);
    pendingPush.clear();
    pushTimer = null;
    for (const n of namespaces) {
      const body = isArrayNamespace(n)
        ? { namespace: n, map: { list: JSON.parse(localStorage.getItem(n) || "[]") } }
        : { namespace: n, map: readLocal(n) };
      // Fire-and-forget: a failed mirror must never block or surface in the
      // UI — localStorage already holds the write, and the next successful
      // push carries it.
      fetch("/api/store", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      }).catch(() => {});
    }
  }, 1200);
}

let pulled = false;

/**
 * Pull the server's copy once per page load and merge it into localStorage.
 * Returns true if anything changed locally, so the caller can re-read.
 */
export async function pullAndMerge(): Promise<boolean> {
  if (typeof window === "undefined" || pulled) return false;
  pulled = true;
  try {
    const res = await fetch("/api/store");
    if (!res.ok) return false;
    const { configured, data } = await res.json();
    if (!configured || !data) return false;

    let changed = false;
    for (const ns of SYNCED_NAMESPACES) {
      const remote = data[ns];
      if (!remote) continue;

      if (isArrayNamespace(ns)) {
        const remoteList = Array.isArray(remote.list) ? remote.list : [];
        const localList = JSON.parse(localStorage.getItem(ns) || "[]");
        if (remoteList.length > localList.length) {
          localStorage.setItem(ns, JSON.stringify(remoteList));
          changed = true;
        }
        continue;
      }

      const local = readLocal(ns);
      const merged = mergeMaps(local, remote as RecordMap);
      if (JSON.stringify(merged) !== JSON.stringify(local)) {
        writeLocal(ns, merged);
        changed = true;
        // This write bypasses adhd-storage's writeMap, so the badge listener
        // needs an explicit nudge to recompute from the merged commitments.
        if (ns === ANALYSES_NS) notifyAnalysesChanged();
      }
      // Push back whenever the local copy held anything the server lacked, so
      // the first device to run this seeds the server with its history.
      if (JSON.stringify(merged) !== JSON.stringify(remote)) schedulePush(ns);
    }
    return changed;
  } catch {
    return false;
  }
}
