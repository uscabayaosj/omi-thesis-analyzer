/**
 * Restore-from-backup, the pure half: validate a backup file and plan what
 * merging it into this device would change. No storage, no network — the
 * client half (restore.ts) supplies the device's values and writes the
 * result. Imports carry `.ts` extensions so `node --test` can load this
 * module directly, the same convention as capture/identify.ts.
 *
 * A restore is a merge, never a replace: the file is treated as a pull from
 * another device. Newest record wins, done-state fields resolve on their own
 * clocks, tombstones are records, and a tie keeps what is on the device.
 */
import {
  mergeMaps, mergeArrayNamespace, stableStringify, toList, toMap, isTombstoneRecord,
  type RecordMap, type ArrayRecord,
} from "./merge.ts";
import { SYNCED_NAMESPACES, isArrayNamespace, isSyncedNamespace, type SyncedNamespace } from "./kv.ts";

export interface BackupFile {
  source?: string;
  exportedAt?: string;
  namespaces: Partial<Record<SyncedNamespace, unknown>>;
}

export type ParseResult =
  | { ok: true; backup: BackupFile; ignored: string[] }
  | { ok: false; error: string };

/** Accepts the shape both export paths write: `{ source, exportedAt, namespaces }`. */
export function parseBackup(raw: unknown): ParseResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "That file isn't a TRACE backup." };
  }
  const r = raw as Record<string, unknown>;
  const ns = r.namespaces;
  if (!ns || typeof ns !== "object" || Array.isArray(ns)) {
    return { ok: false, error: "That file isn't a TRACE backup — it has no namespaces in it." };
  }
  const namespaces: Partial<Record<SyncedNamespace, unknown>> = {};
  const ignored: string[] = [];
  for (const [key, value] of Object.entries(ns as Record<string, unknown>)) {
    if (!isSyncedNamespace(key)) {
      ignored.push(key);
      continue;
    }
    if (value == null) continue; // a local export writes null for a key it never had
    namespaces[key] = value;
  }
  if (Object.keys(namespaces).length === 0) {
    return { ok: false, error: "That backup holds no TRACE data this version recognises." };
  }
  return {
    ok: true,
    ignored,
    backup: {
      source: typeof r.source === "string" ? r.source : undefined,
      exportedAt: typeof r.exportedAt === "string" ? r.exportedAt : undefined,
      namespaces,
    },
  };
}

export interface NamespacePlan {
  namespace: SyncedNamespace;
  /** Live records the device did not have. */
  added: number;
  /** Records present on both sides whose stored value changes. */
  updated: number;
  /** Deletions the backup carries that the device had not applied. */
  deletions: number;
  /** The value to write to localStorage — canonical client shape (bare array
   *  for the array namespaces, keyed map otherwise). */
  merged: unknown;
  changed: boolean;
}

export interface RestorePlan {
  namespaces: NamespacePlan[];
  added: number;
  updated: number;
  deletions: number;
  changed: boolean;
}

/** Identity of one array-namespace entry, for diffing. */
function arrayKey(ns: string, r: ArrayRecord): string {
  if (ns === "omi-thesis-analyses" && typeof r?.conversationId === "string") return `c:${r.conversationId}`;
  if (ns === "omi-thesis-group-analyses" && Array.isArray(r?.conversationIds)) {
    return `g:${(r.conversationIds as unknown[]).filter((x): x is string => typeof x === "string").sort().join(",")}`;
  }
  return `raw:${stableStringify(r)}`;
}

function indexArray(ns: string, list: ArrayRecord[]): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const r of list) m.set(arrayKey(ns, r), r);
  return m;
}

function diff(
  merged: Map<string, unknown>,
  device: Map<string, unknown>
): { added: number; updated: number; deletions: number } {
  let added = 0;
  let updated = 0;
  let deletions = 0;
  for (const [key, value] of merged) {
    const before = device.get(key);
    const tomb = isTombstoneRecord(value);
    if (!device.has(key)) {
      if (tomb) deletions++;
      else added++;
      continue;
    }
    if (stableStringify(value) === stableStringify(before)) continue;
    if (tomb && !isTombstoneRecord(before)) deletions++;
    else updated++;
  }
  return { added, updated, deletions };
}

/**
 * What restoring `backup` onto `device` would produce, namespace by namespace.
 * `device` maps each synced namespace to its current localStorage value
 * (already JSON-parsed; missing or unparseable entries may be omitted).
 */
export function planRestore(
  backup: BackupFile,
  device: Partial<Record<SyncedNamespace, unknown>>
): RestorePlan {
  const namespaces: NamespacePlan[] = [];
  for (const ns of SYNCED_NAMESPACES) {
    const imported = backup.namespaces[ns];
    if (imported == null) continue;
    let plan: NamespacePlan;
    if (isArrayNamespace(ns)) {
      const deviceList = toList(device[ns]);
      const merged = mergeArrayNamespace(ns, toList(imported), deviceList);
      const counts = diff(indexArray(ns, merged), indexArray(ns, deviceList));
      plan = { namespace: ns, ...counts, merged, changed: counts.added + counts.updated + counts.deletions > 0 };
    } else {
      const deviceMap: RecordMap = toMap(device[ns]);
      // The backup is "local" here so its records win only when strictly newer;
      // a tie keeps the device's copy.
      const merged = mergeMaps(toMap(imported), deviceMap);
      const counts = diff(new Map(Object.entries(merged)), new Map(Object.entries(deviceMap)));
      plan = { namespace: ns, ...counts, merged, changed: counts.added + counts.updated + counts.deletions > 0 };
    }
    namespaces.push(plan);
  }
  const total = (k: "added" | "updated" | "deletions") => namespaces.reduce((n, p) => n + p[k], 0);
  return {
    namespaces,
    added: total("added"),
    updated: total("updated"),
    deletions: total("deletions"),
    changed: namespaces.some((p) => p.changed),
  };
}
