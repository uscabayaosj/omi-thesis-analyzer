import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMaps } from "../src/lib/merge.ts";

/**
 * An undo is a NEW user action, so the record it writes must be able to win the
 * next merge. Replaying the original record verbatim cannot: the destructive
 * act it undoes already pushed a newer record (or a tombstone) to the server,
 * so the stale replay loses and the undo silently reverts on reload — the same
 * failure as a ticked promise reappearing unchecked.
 */

const OLD = "2026-08-31T09:00:00.000Z";
const NEWER = "2026-08-31T10:00:00.000Z";
const RESTORE = "2026-08-31T10:00:05.000Z";

test("restoring a removed suggestion beats the tombstone already on the server", () => {
  const local = { s1: { id: "s1", extractedName: "Ray", timestamp: RESTORE } };
  const remote = { s1: { deleted: true, timestamp: NEWER } };
  const merged = mergeMaps(local, remote);
  assert.equal(merged.s1.deleted, undefined, "the restored suggestion must survive the merge");
  assert.equal(merged.s1.extractedName, "Ray");
});

test("replaying it with its ORIGINAL timestamp would lose — the bug this guards", () => {
  const local = { s1: { id: "s1", extractedName: "Ray", timestamp: OLD } };
  const remote = { s1: { deleted: true, timestamp: NEWER } };
  assert.equal(
    mergeMaps(local, remote).s1.deleted,
    true,
    "a stale replay is beaten by the tombstone — which is why restore must restamp"
  );
});

test("restoring a replaced rollup beats the regenerated one on the server", () => {
  const local = { "2026-08-30": { day: "2026-08-30", rollup: { a: 1 }, generatedAt: OLD, timestamp: RESTORE } };
  const remote = { "2026-08-30": { day: "2026-08-30", rollup: { a: 2 }, timestamp: NEWER } };
  const merged = mergeMaps(local, remote);
  assert.deepEqual(merged["2026-08-30"].rollup, { a: 1 }, "the restored rollup must survive");
  assert.equal(
    merged["2026-08-30"].generatedAt,
    OLD,
    "and must still report when it was really generated, not when it was restored"
  );
});
