import { test } from "node:test";
import assert from "node:assert/strict";
import { stableStringify, mergeMaps } from "../src/lib/merge.ts";

/**
 * The browser writes objects in source order; the server stores them as
 * Postgres `jsonb`, which normalises keys by length then bytewise. Deciding
 * "has anything changed?" with raw JSON.stringify therefore always said yes,
 * and every page load pushed the whole namespace back to the server.
 */

// Exactly the reordering observed on production for a real stored analysis.
const CLIENT = { conversationId: "c1", timestamp: "2026-08-07T16:09:22.919Z", title: "t", date: "2026-08-07", analysis: { summary: "s" }, doneKeys: ["k1"] };
const SERVER = { date: "2026-08-07", title: "t", analysis: { summary: "s" }, doneKeys: ["k1"], timestamp: "2026-08-07T16:09:22.919Z", conversationId: "c1" };

test("raw JSON.stringify reports a false difference across the storage boundary", () => {
  assert.notEqual(JSON.stringify(CLIENT), JSON.stringify(SERVER), "the bug this guards: same content, different string");
});

test("stableStringify sees them as identical", () => {
  assert.equal(stableStringify(CLIENT), stableStringify(SERVER));
});

test("an in-sync namespace produces no spurious push signal", () => {
  const merged = mergeMaps({ c1: { ...CLIENT } } as never, { c1: { ...SERVER } } as never);
  assert.equal(
    stableStringify(merged),
    stableStringify({ c1: SERVER }),
    "merged must compare equal to remote when nothing actually changed"
  );
});

test("a real difference is still detected", () => {
  const changed = { ...SERVER, doneKeys: ["k1", "k2"] };
  assert.notEqual(stableStringify({ c1: CLIENT }), stableStringify({ c1: changed }));
});

test("stableStringify preserves array order (arrays are ordered data, not bags)", () => {
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

test("handles null, primitives and nesting", () => {
  assert.equal(stableStringify({ b: null, a: [1, { y: 2, x: 1 }] }), '{"a":[1,{"x":1,"y":2}],"b":null}');
});
