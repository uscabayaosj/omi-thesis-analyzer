"use client";

import { SYNCED_NAMESPACES, type SyncedNamespace, isArrayNamespace } from "@/lib/kv";
import { notifyAnalysesChanged } from "@/lib/badge";
// The merge rule lives in its own dependency-free module so it can be tested
// directly (test/sync-merge.test.mts) rather than only through the browser —
// a ticked promise being silently reverted by a merge is precisely the class
// of bug that needs a test, not a manual check.
import { mergeMaps, mergeArrayNamespace, stableStringify, type RecordMap, type ArrayRecord } from "@/lib/merge";

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

// Every push currently in flight (from either path), keyed by the namespace
// it carries, so flushPush can wait on pushes the scheduled path already
// started firing before flush was called — and wait on only the namespace
// its caller cares about. Entries remove themselves the instant they settle,
// success or failure, so this can never grow unbounded or leak stale promises.
const inFlightPushes = new Map<Promise<void>, SyncedNamespace>();

interface PushHandle {
  ns: SyncedNamespace;
  promise: Promise<void>;
}

/**
 * Push every currently-pending namespace to the server. Shared by the
 * debounced path (schedulePush's timer, fire-and-forget) and the explicit
 * flush path (flushPush, awaited) so both stay in lockstep on batching and
 * body shape.
 *
 * `swallow` controls only whether a rejection (network failure or non-ok
 * HTTP response) is caught here or left to propagate — the request itself is
 * identical either way. schedulePush passes true (its failures must never
 * surface); flushPush passes false for the pushes it starts itself (its
 * caller needs to know), but see flushPush's docstring for how it handles
 * pushes it did *not* start.
 */
function runPendingPush(swallow: boolean): PushHandle[] {
  const namespaces = Array.from(pendingPush);
  pendingPush.clear();
  return namespaces.map((n): PushHandle => {
    const body = isArrayNamespace(n)
      ? { namespace: n, map: { list: JSON.parse(localStorage.getItem(n) || "[]") } }
      : { namespace: n, map: readLocal(n) };
    const settled = fetch("/api/store", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    }).then((res) => {
      // fetch() only rejects on network-layer failure — an HTTP 4xx/5xx
      // resolves normally, so it must be checked explicitly or a failed
      // mirror silently reads as a successful one.
      if (!res.ok) throw new Error(`push ${n} failed: HTTP ${res.status}`);
    });
    // Track the *unswallowed* promise, so a later flushPush awaiting a push
    // the scheduled path started still learns it failed. Swallowing before
    // tracking would hand flushPush a promise that always resolves — the
    // exact "reads as success" bug this function guards against above.
    inFlightPushes.set(settled, n);
    const untrack = () => inFlightPushes.delete(settled);
    settled.then(untrack, untrack);
    // Marks the rejection handled so a swallowed push cannot raise an
    // unhandledrejection; `settled` itself stays rejected for any awaiter.
    settled.catch(() => {});
    return { ns: n, promise: swallow ? settled.catch(() => {}) : settled };
  });
}

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
    pushTimer = null;
    // Fire-and-forget: a failed mirror (network failure OR a non-ok HTTP
    // response — see runPendingPush) must never block or surface in the
    // UI — localStorage already holds the write, and the next successful
    // push carries it. runPendingPush(true) already swallows these; the
    // returned promises are otherwise unused here.
    runPendingPush(true);
  }, 1200);
}

/**
 * Cancel any pending debounced push and run it immediately, awaiting the
 * fetch(es) so the caller can be sure the server has the data before
 * proceeding — e.g. before hitting a route that resolves an id against the
 * server's copy of a namespace this push just wrote.
 *
 * Unlike schedulePush, a failure in a push started by *this* call is NOT
 * swallowed: it rejects (including a non-ok HTTP response — fetch() alone
 * does not reject for those, so runPendingPush checks res.ok explicitly), so
 * the caller can tell "server has it" from "server doesn't" and avoid acting
 * as though the push succeeded (which would just recreate the race this
 * function exists to prevent). The namespace(s) are already removed from
 * `pendingPush` once this runs, matching the scheduled path's batching
 * behavior — a failed flush does not leave the namespace queued for a later
 * retry, since a caller that needs certainty is expected to handle the
 * failure itself (e.g. surface an error and let the user retry the whole
 * action).
 *
 * flushPush also awaits any push that was *already in flight* when it was
 * called (the 1200ms timer fired moments earlier, so pendingPush is already
 * empty but the fetch is still pending) — otherwise the caller would race
 * that request in exactly the narrow window flushPush exists to close.
 * Those in-flight pushes were started by the scheduled path, whose contract
 * is that failures are swallowed and never surface. flushPush deliberately
 * surfaces them anyway: the moment a caller awaits flushPush(), the only
 * fact it cares about is "does the server have the data yet," and a push
 * that failed silently in the background means the answer is no regardless
 * of which path started the request. Swallowing it here to preserve the
 * scheduled path's posture would defeat flushPush's entire purpose — the
 * scheduled path's "never surface" guarantee is about not disturbing the
 * *UI* on its own debounced timer, not about hiding the outcome from a
 * caller that explicitly asked to be told. The scheduled path itself is
 * unaffected: it still never awaits or reacts to these promises.
 *
 * Pass `ns` to await only that namespace. Everything pending is still pushed
 * (batching is unchanged), but a caller who needs `omi-people` on the server
 * should not have its action fail because an unrelated namespace's push
 * happened to error in the same batch — pushes for other namespaces keep the
 * scheduled path's swallowed, fire-and-forget posture.
 */
export async function flushPush(ns?: SyncedNamespace): Promise<void> {
  if (typeof window === "undefined") return;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  const wanted = (n: SyncedNamespace) => ns === undefined || n === ns;
  const own = runPendingPush(false);
  // Own pushes for namespaces the caller did not ask about are already marked
  // handled inside runPendingPush, so leaving them un-awaited cannot raise an
  // unhandledrejection.
  const ownWanted = own.filter((h) => wanted(h.ns)).map((h) => h.promise);
  const alreadyInFlight = Array.from(inFlightPushes)
    .filter(([p, n]) => wanted(n) && !own.some((h) => h.promise === p))
    .map(([p]) => p);
  await Promise.all([...ownWanted, ...alreadyInFlight]);
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
        if (stableStringify(merged) !== stableStringify(localList)) {
          localStorage.setItem(ns, JSON.stringify(merged));
          changed = true;
        }
        if (stableStringify(merged) !== stableStringify(remoteList)) schedulePush(ns);
        continue;
      }

      const local = readLocal(ns);
      const merged = mergeMaps(local, remote as RecordMap);
      if (stableStringify(merged) !== stableStringify(local)) {
        writeLocal(ns, merged);
        changed = true;
        // This write bypasses adhd-storage's writeMap, so the badge listener
        // needs an explicit nudge to recompute from the merged commitments.
        if (ns === ANALYSES_NS) notifyAnalysesChanged();
      }
      // Push back whenever the local copy held anything the server lacked, so
      // the first device to run this seeds the server with its history.
      if (stableStringify(merged) !== stableStringify(remote)) schedulePush(ns);
    }
    return changed;
  } catch {
    return false;
  }
}
