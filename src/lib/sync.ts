"use client";

import { SYNCED_NAMESPACES, type SyncedNamespace, isArrayNamespace } from "@/lib/kv";
import { notifyAnalysesChanged } from "@/lib/badge";
// The merge rule lives in its own dependency-free module so it can be tested
// directly (test/sync-merge.test.mts) rather than only through the browser —
// a ticked promise being silently reverted by a merge is precisely the class
// of bug that needs a test, not a manual check.
import { mergeMaps, mergeArrayNamespace, type RecordMap, type ArrayRecord } from "@/lib/merge";

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

// Array-shaped namespaces each have their own merge strategy below — the
// uniform keyed-map merge above only works for records addressed by a
// top-level id. Which namespaces are array-shaped is defined in kv.ts
// (isArrayNamespace), shared with the server-side export route.

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
export async function pullAndMerge(force = false): Promise<boolean> {
  if (typeof window === "undefined" || (pulled && !force)) return false;
  pulled = true;
  try {
    const res = await fetch("/api/store", { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return false;
    const { configured, data } = await res.json();
    if (!configured || !data) return false;

    let changed = false;
    for (const ns of SYNCED_NAMESPACES) {
      const remote = data[ns];
      if (!remote) continue;

      if (isArrayNamespace(ns)) {
        const remoteList: ArrayRecord[] = Array.isArray(remote.list) ? remote.list : [];
        const localRaw = localStorage.getItem(ns);
        const localList: ArrayRecord[] = localRaw ? JSON.parse(localRaw) : [];
        const merged = mergeArrayNamespace(ns, localList, remoteList);
        if (JSON.stringify(merged) !== JSON.stringify(localList)) {
          localStorage.setItem(ns, JSON.stringify(merged));
          changed = true;
        }
        if (JSON.stringify(merged) !== JSON.stringify(remoteList)) schedulePush(ns);
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
