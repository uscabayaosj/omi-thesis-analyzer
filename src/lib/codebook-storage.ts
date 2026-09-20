"use client";

import { readMap, writeMap } from "./map-storage";
import type { Code, CodeEvidence } from "./codebook";

const CODES_KEY = "omi-thesis-codes";
const EVIDENCE_KEY = "omi-thesis-code-evidence";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ── codes ──

export function getCodes(): Code[] {
  return Object.values(readMap<Code>(CODES_KEY))
    .filter((c) => !c.deleted && typeof c.name === "string")
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createCode(init: { name: string; description?: string }): Code {
  const map = readMap<Code>(CODES_KEY);
  const code: Code = { id: newId("code"), name: init.name.trim(), description: (init.description ?? "").trim(), timestamp: now() };
  map[code.id] = code;
  writeMap(CODES_KEY, map);
  return code;
}

export function updateCode(id: string, patch: { name?: string; description?: string }): Code | null {
  const map = readMap<Code>(CODES_KEY);
  const existing = map[id];
  if (!existing || existing.deleted) return null;
  const updated: Code = {
    ...existing,
    name: patch.name !== undefined ? patch.name.trim() : existing.name,
    description: patch.description !== undefined ? patch.description.trim() : existing.description,
    timestamp: now(),
  };
  map[id] = updated;
  writeMap(CODES_KEY, map);
  return updated;
}

/** Tombstones the code and every excerpt under it. Returns what was removed
 *  so the undo bar can put it back. */
export function deleteCode(id: string): { code: Code; evidence: CodeEvidence[] } | null {
  const codes = readMap<Code>(CODES_KEY);
  const code = codes[id];
  if (!code || code.deleted) return null;
  const t = now();
  codes[id] = { ...code, deleted: true, timestamp: t };
  writeMap(CODES_KEY, codes);
  const ev = readMap<CodeEvidence>(EVIDENCE_KEY);
  const removed: CodeEvidence[] = [];
  for (const e of Object.values(ev)) {
    if (e.codeId === id && !e.deleted) {
      removed.push(e);
      ev[e.id] = { ...e, deleted: true, timestamp: t };
    }
  }
  if (removed.length) writeMap(EVIDENCE_KEY, ev);
  return { code, evidence: removed };
}

export function restoreCode(code: Code, evidence: CodeEvidence[]): void {
  const t = now();
  const codes = readMap<Code>(CODES_KEY);
  codes[code.id] = { ...code, deleted: false, timestamp: t };
  writeMap(CODES_KEY, codes);
  if (evidence.length) {
    const ev = readMap<CodeEvidence>(EVIDENCE_KEY);
    for (const e of evidence) ev[e.id] = { ...e, deleted: false, timestamp: t };
    writeMap(EVIDENCE_KEY, ev);
  }
}

// ── evidence ──

export function getEvidence(): CodeEvidence[] {
  return Object.values(readMap<CodeEvidence>(EVIDENCE_KEY))
    .filter((e) => !e.deleted && typeof e.excerpt === "string" && typeof e.codeId === "string")
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function addEvidence(items: Omit<CodeEvidence, "id" | "timestamp">[]): CodeEvidence[] {
  if (items.length === 0) return [];
  const map = readMap<CodeEvidence>(EVIDENCE_KEY);
  // The same excerpt under the same code for the same conversation is one
  // piece of evidence, however many times a suggestion run repeats it.
  const existing = new Set(
    Object.values(map).filter((e) => !e.deleted).map((e) => `${e.codeId}|${e.conversationId}|${e.excerpt}`),
  );
  const added: CodeEvidence[] = [];
  const t = now();
  for (const it of items) {
    const k = `${it.codeId}|${it.conversationId}|${it.excerpt}`;
    if (existing.has(k)) continue;
    existing.add(k);
    const rec: CodeEvidence = { ...it, id: newId("ev"), timestamp: t };
    map[rec.id] = rec;
    added.push(rec);
  }
  if (added.length) writeMap(EVIDENCE_KEY, map);
  return added;
}

export function deleteEvidence(id: string): CodeEvidence | null {
  const map = readMap<CodeEvidence>(EVIDENCE_KEY);
  const e = map[id];
  if (!e || e.deleted) return null;
  map[id] = { ...e, deleted: true, timestamp: now() };
  writeMap(EVIDENCE_KEY, map);
  return e;
}

export function restoreEvidence(e: CodeEvidence): void {
  const map = readMap<CodeEvidence>(EVIDENCE_KEY);
  map[e.id] = { ...e, deleted: false, timestamp: now() };
  writeMap(EVIDENCE_KEY, map);
}
