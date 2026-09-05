import { test } from "node:test";
import assert from "node:assert/strict";
import { countWords } from "../src/lib/capture/rows.ts";

test("countWords sums whitespace-separated words across segments", () => {
  assert.equal(countWords([]), 0);
  assert.equal(countWords([{ text: "one two" }, { text: "  three " }, { text: "" }]), 3);
});
