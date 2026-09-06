"use client";

import { parseBackup, planRestore, type BackupFile, type RestorePlan } from "./restore-core";

export type { BackupFile, RestorePlan } from "./restore-core";
import { SYNCED_NAMESPACES, type SyncedNamespace } from "./kv";
import { schedulePush } from "./sync";
import { notifyAnalysesChanged } from "./badge";

/** Anything larger is not a TRACE backup: every namespace together runs to a
 *  few megabytes at most, and a runaway file should fail fast rather than be
 *  parsed on the main thread. */
const MAX_BYTES = 64 * 1024 * 1024;

export interface ReadBackupResult {
  backup: BackupFile;
  plan: RestorePlan;
  /** Namespace keys in the file this version does not know; reported, not restored. */
  ignored: string[];
}

function snapshotDevice(): Partial<Record<SyncedNamespace, unknown>> {
  const out: Partial<Record<SyncedNamespace, unknown>> = {};
  for (const ns of SYNCED_NAMESPACES) {
    try {
      const raw = localStorage.getItem(ns);
      if (raw) out[ns] = JSON.parse(raw);
    } catch {
      // Unparseable local value: treat as absent, so the backup fills it in
      // rather than the restore failing on a namespace it could repair.
    }
  }
  return out;
}

/** Read and validate a backup file and plan the merge. Throws a message fit
 *  for the screen; nothing is written. */
export async function readBackupFile(file: File): Promise<ReadBackupResult> {
  if (file.size > MAX_BYTES) throw new Error("That file is too large to be a TRACE backup.");
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const parsed = parseBackup(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return { backup: parsed.backup, plan: planRestore(parsed.backup, snapshotDevice()), ignored: parsed.ignored };
}

/**
 * Write a plan's merged namespaces to this device and queue them for the
 * server. Each namespace is written independently so a quota failure on one
 * (photos make omi-people the likely one) does not lose the others.
 */
export function applyRestore(plan: RestorePlan): { written: SyncedNamespace[]; failed: SyncedNamespace[] } {
  const written: SyncedNamespace[] = [];
  const failed: SyncedNamespace[] = [];
  for (const p of plan.namespaces) {
    if (!p.changed) continue;
    try {
      localStorage.setItem(p.namespace, JSON.stringify(p.merged));
      schedulePush(p.namespace);
      written.push(p.namespace);
    } catch (e) {
      console.error(`restore: could not write ${p.namespace}`, e);
      failed.push(p.namespace);
    }
  }
  // Written past adhd-storage's own write path, so the badge needs the nudge
  // the sync merge also gives it.
  if (written.includes("omi-adhd-analyses")) notifyAnalysesChanged();
  return { written, failed };
}
