import { test } from "node:test";
import assert from "node:assert/strict";
import { countTranscriptWords, toEnrichment, isHiddenJunk, JUNK_WORD_FLOOR } from "../src/lib/enrich-core.ts";
import { mergeMaps } from "../src/lib/merge.ts";

test("countTranscriptWords sums words across segments", () => {
  assert.equal(countTranscriptWords([]), 0);
  assert.equal(countTranscriptWords([{ text: "hello there" }, { text: "ok" }]), 3);
});

test("countTranscriptWords ignores whitespace runs and empty segments", () => {
  assert.equal(countTranscriptWords([{ text: "  a\n b\tc  " }, { text: "   " }, { text: "" }]), 3);
});

// The floor is a contract with the enrich route: strictly-below is junk-for-free,
// at-or-above goes to the model. Pin the boundary so a refactor can't shift it.
test("the junk floor boundary is exact", () => {
  const words = (n: number) => [{ text: Array.from({ length: n }, (_, i) => `w${i}`).join(" ") }];
  assert.equal(countTranscriptWords(words(JUNK_WORD_FLOOR - 1)) < JUNK_WORD_FLOOR, true);
  assert.equal(countTranscriptWords(words(JUNK_WORD_FLOOR)) < JUNK_WORD_FLOOR, false);
});

test("toEnrichment passes a well-formed reply through", () => {
  assert.deepEqual(
    toEnrichment({ junk: true, junk_reason: "background TV", title: "t", overview: "o" }),
    { junk: true, junk_reason: "background TV", title: "t", overview: "o" }
  );
});

test("toEnrichment defaults junk to false on garbage — over-show, never hide", () => {
  assert.deepEqual(toEnrichment({}), { junk: false, junk_reason: "", title: "", overview: "" });
  assert.equal(toEnrichment({ junk: "yes" }).junk, false); // wrong type is not a verdict
  assert.equal(toEnrichment({ junk: true, junk_reason: 3 }).junk_reason, "");
});

// The one shared definition of "hidden as noise": an explicit, unkept junk
// verdict. No record, a clean verdict, or a Keep override all mean visible.
test("isHiddenJunk hides only an unkept junk verdict", () => {
  assert.equal(isHiddenJunk(undefined), false); // absence of a verdict is not a verdict
  assert.equal(isHiddenJunk({ junk: false }), false);
  assert.equal(isHiddenJunk({ junk: true }), true);
  assert.equal(isHiddenJunk({ junk: true, keep: true }), false);
  assert.equal(isHiddenJunk({ junk: true, keep: false }), true);
});

// A junk verdict re-produced on another device (newer record timestamp) must
// not revert this device's explicit Keep override — same contract as ticks.
test("a Keep override outlives a newer remote enrichment record", () => {
  const local = {
    c1: { conversationId: "c1", timestamp: "2026-09-01T00:00:00Z", junk: true, keep: true, keepUpdatedAt: "2026-09-03T00:00:00Z" },
  };
  const remote = {
    c1: { conversationId: "c1", timestamp: "2026-09-02T00:00:00Z", junk: true },
  };
  const merged = mergeMaps(local as never, remote as never);
  assert.equal(merged.c1.keep, true);
  assert.equal(merged.c1.timestamp, "2026-09-02T00:00:00Z"); // body still newest-wins
});
