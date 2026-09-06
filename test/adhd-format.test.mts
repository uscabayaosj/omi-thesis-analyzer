import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDeadline, meaningful } from "../src/lib/adhd-format.ts";

/**
 * The model returns deadlines three ways — a bare date, an "Estimated: "
 * prefix when it inferred one, and the literal "None". Rendering the raw
 * value behind a fixed label produced "Deadline: Estimated: 2026-08-15" and
 * "Deadline: None" on the conversation page while the ledger normalised it.
 */
test("a bare date keeps the plain label", () => {
  assert.deepEqual(formatDeadline("2026-08-15"), { label: "Deadline:", value: "2026-08-15" });
});

test("an inferred deadline says so once, not twice", () => {
  assert.deepEqual(formatDeadline("Estimated: 15 August"), { label: "Estimated deadline:", value: "15 August" });
  assert.deepEqual(formatDeadline("estimated:next Friday"), { label: "Estimated deadline:", value: "next Friday" });
});

test("no deadline renders nothing rather than a 'None' row", () => {
  assert.equal(formatDeadline("None"), null);
  assert.equal(formatDeadline("none."), null);
  assert.equal(formatDeadline("No date given"), null);
  assert.equal(formatDeadline(""), null);
  assert.equal(formatDeadline(undefined), null);
});

test("meaningful treats the model's None as absent and keeps everything else", () => {
  assert.equal(meaningful("None"), undefined);
  assert.equal(meaningful(" none. "), undefined);
  assert.equal(meaningful(""), undefined);
  assert.equal(meaningful(undefined), undefined);
  assert.equal(meaningful("Owes a reply about the lease"), "Owes a reply about the lease");
});
