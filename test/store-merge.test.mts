import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeNamespaceValue, mergeConversationList, mergeGroupList, mergeArrayNamespace,
} from "../src/lib/merge.ts";

/**
 * PUT /api/store used to replace a namespace with whatever the client sent.
 * A device with an empty localStorage that wrote before its first pull landed
 * (a new browser, cleared site data, a slow connection) therefore pushed a
 * one-record map and the server lost everything else. The route now merges
 * with the client's own rules; these pin the properties that matter.
 */

const OLD = "2026-09-01T09:00:00.000Z";
const NEW = "2026-09-01T10:00:00.000Z";
const NEWER = "2026-09-01T11:00:00.000Z";

test("a one-record push cannot remove the records the server already holds", () => {
  const existing = { a: { timestamp: OLD, name: "A" }, b: { timestamp: OLD, name: "B" } };
  const incoming = { c: { timestamp: NEW, name: "C" } };
  const merged = mergeNamespaceValue("omi-people", false, incoming, existing) as Record<string, unknown>;
  assert.deepEqual(Object.keys(merged).sort(), ["a", "b", "c"]);
});

test("a newer incoming record replaces the stored one; an older one does not", () => {
  const existing = { a: { timestamp: NEW, name: "server" } };
  assert.equal(
    (mergeNamespaceValue("omi-people", false, { a: { timestamp: NEWER, name: "client" } }, existing) as { a: { name: string } }).a.name,
    "client"
  );
  assert.equal(
    (mergeNamespaceValue("omi-people", false, { a: { timestamp: OLD, name: "stale" } }, existing) as { a: { name: string } }).a.name,
    "server"
  );
});

test("a tombstone still deletes — removal is explicit, not implied by absence", () => {
  const existing = { a: { timestamp: OLD, name: "A" } };
  const incoming = { a: { deleted: true, timestamp: NEW } };
  const merged = mergeNamespaceValue("omi-people", false, incoming, existing) as { a: { deleted?: boolean } };
  assert.equal(merged.a.deleted, true);
});

test("an empty row takes the incoming map as-is", () => {
  const incoming = { a: { timestamp: OLD } };
  assert.deepEqual(mergeNamespaceValue("omi-people", false, incoming, null), incoming);
});

test("array namespaces keep their { list } transport wrapper on the way back", () => {
  const existing = { list: [{ conversationId: "c1", current: { timestamp: OLD } }] };
  const incoming = { list: [{ conversationId: "c2", current: { timestamp: OLD } }] };
  const merged = mergeNamespaceValue("omi-thesis-analyses", true, incoming, existing) as { list: { conversationId: string }[] };
  assert.deepEqual(merged.list.map((r) => r.conversationId).sort(), ["c1", "c2"]);
});

/**
 * A custom analysis is saved onto an existing record without bumping
 * `current.timestamp` (that clock means "when analyzed"). Under a merge, a
 * tie on that clock used to resolve to the copy WITHOUT the custom result.
 */
test("a custom analysis survives a merge against an identical-clock server copy", () => {
  const local = [{ conversationId: "c1", current: { timestamp: OLD, title: "t", custom: { prompt: "p", result: "r", timestamp: NEW } } }];
  const remote = [{ conversationId: "c1", current: { timestamp: OLD, title: "t" } }];
  const merged = mergeConversationList(local, remote);
  assert.equal(merged.length, 1);
  assert.deepEqual((merged[0].current as { custom?: { result: string } }).custom?.result, "r");
});

test("a newer re-analysis on the server keeps the client's newer custom result", () => {
  const local = [{ conversationId: "c1", current: { timestamp: OLD, title: "old body", custom: { prompt: "p", result: "mine", timestamp: NEWER } } }];
  const remote = [{ conversationId: "c1", current: { timestamp: NEW, title: "new body", custom: { prompt: "p", result: "theirs", timestamp: OLD } } }];
  const [m] = mergeConversationList(local, remote);
  const current = m.current as { title: string; custom?: { result: string } };
  assert.equal(current.title, "new body", "the newer analysis body wins");
  assert.equal(current.custom?.result, "mine", "the newer custom result rides along");
});

/**
 * Group analyses merged by list LENGTH ("longer wins"), so a group added on
 * one device vanished whenever the other side held more groups.
 */
test("a new group is kept even when the other side has more groups", () => {
  const local = [{ conversationIds: ["a", "b"], timestamp: NEW, analysis: { synthesis: "new" } }];
  const remote = [
    { conversationIds: ["c", "d"], timestamp: OLD, analysis: {} },
    { conversationIds: ["e", "f"], timestamp: OLD, analysis: {} },
  ];
  const merged = mergeGroupList(local, remote);
  assert.equal(merged.length, 3);
  assert.ok(merged.some((g) => (g.analysis as { synthesis?: string }).synthesis === "new"));
});

test("the same group is matched regardless of id order, newest wins, custom on its own clock", () => {
  const local = [{ conversationIds: ["b", "a"], timestamp: OLD, analysis: { synthesis: "old" }, custom: { result: "mine", timestamp: NEWER } }];
  const remote = [{ conversationIds: ["a", "b"], timestamp: NEW, analysis: { synthesis: "new" } }];
  const merged = mergeGroupList(local, remote);
  assert.equal(merged.length, 1);
  assert.equal((merged[0].analysis as { synthesis: string }).synthesis, "new");
  assert.equal((merged[0].custom as { result: string }).result, "mine");
});

test("mergeArrayNamespace routes each array namespace to its own rule", () => {
  const local = [{ conversationIds: ["a"], timestamp: NEW }];
  const remote = [{ conversationIds: ["b"], timestamp: OLD }, { conversationIds: ["c"], timestamp: OLD }];
  assert.equal(mergeArrayNamespace("omi-thesis-group-analyses", local, remote).length, 3, "groups merge by key, not length");
});
