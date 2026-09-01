import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMaps } from "../src/lib/merge.ts";

/**
 * Ticking a promise writes `doneKeys` to localStorage but deliberately leaves
 * the record's `timestamp` alone — the analysis keeps its own identity. The
 * push to the server is debounced by 1.2s and fire-and-forget. So there is a
 * window (a fast reload, an offline tick, a dropped request) where the server
 * still holds the pre-tick record with an IDENTICAL timestamp.
 *
 * If the merge resolves that tie to the remote copy, the user's tick is
 * silently reverted and the promise reappears unchecked — the exact failure
 * reported, and a direct violation of the product's "nothing tracked ever
 * vanishes silently" principle.
 */

const T = "2026-08-31T10:00:00.000Z";
const EARLIER = "2026-08-31T09:00:00.000Z";
const LATER = "2026-08-31T11:00:00.000Z";

test("a tick survives a merge when the debounced push has not landed yet", () => {
  const local = { c1: { timestamp: T, doneKeys: ["k1"], doneKeysUpdatedAt: T } };
  const remote = { c1: { timestamp: T, doneKeys: [] } };
  assert.deepEqual(
    mergeMaps(local, remote).c1.doneKeys,
    ["k1"],
    "a stamped local tick must beat an unstamped server copy"
  );
});

test("an untick also survives (the rule must not be direction-specific)", () => {
  const local = { c1: { timestamp: T, doneKeys: [], doneKeysUpdatedAt: T } };
  const remote = { c1: { timestamp: T, doneKeys: ["k1"] } };
  assert.deepEqual(mergeMaps(local, remote).c1.doneKeys, [], "unticking must survive too");
});

test("the most recent tick wins across devices, whichever device made it", () => {
  // The other device ticked more recently than this one unticked.
  const local = { c1: { timestamp: T, doneKeys: [], doneKeysUpdatedAt: EARLIER } };
  const remote = { c1: { timestamp: T, doneKeys: ["k1"], doneKeysUpdatedAt: LATER } };
  assert.deepEqual(
    mergeMaps(local, remote).c1.doneKeys,
    ["k1"],
    "a newer remote tick must not be clobbered by a stale local one"
  );
});

test("a tick is not reverted by an otherwise-newer remote analysis", () => {
  // Remote re-ran the analysis (newer record) but never ticked; local ticked.
  const local = { c1: { timestamp: T, doneKeys: ["k1"], doneKeysUpdatedAt: LATER } };
  const remote = { c1: { timestamp: LATER, doneKeys: [] } };
  const merged = mergeMaps(local, remote);
  assert.equal(merged.c1.timestamp, LATER, "the newer analysis body still wins");
  assert.deepEqual(merged.c1.doneKeys, ["k1"], "but the tick rides along with it");
});

test("plan-step ticks follow the same rule", () => {
  const local = { "2026-08-30": { timestamp: T, planDoneKeys: ["p1"], planDoneUpdatedAt: T } };
  const remote = { "2026-08-30": { timestamp: T, planDoneKeys: [] } };
  assert.deepEqual(mergeMaps(local, remote)["2026-08-30"].planDoneKeys, ["p1"]);
});

test("legacy records with no stamp on either side behave exactly as before", () => {
  const local = { c1: { timestamp: T, doneKeys: ["k1"] } };
  const remote = { c1: { timestamp: T, doneKeys: [] } };
  assert.deepEqual(
    mergeMaps(local, remote).c1.doneKeys,
    [],
    "unstamped tie still resolves to remote — no behaviour change for old data"
  );
});

test("a genuinely newer remote record still wins", () => {
  const local = { c1: { timestamp: T, doneKeys: ["k1"] } };
  const remote = { c1: { timestamp: "2026-08-31T11:00:00.000Z", doneKeys: ["k1", "k2"] } };
  assert.deepEqual(mergeMaps(local, remote).c1.doneKeys, ["k1", "k2"], "newer server record wins");
});

test("a record only one side has is always kept", () => {
  const merged = mergeMaps({ a: { timestamp: T } }, { b: { timestamp: T } });
  assert.ok(merged.a && merged.b, "neither side's unique records may be dropped");
});
