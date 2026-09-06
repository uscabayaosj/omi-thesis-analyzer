import { test } from "node:test";
import assert from "node:assert/strict";
import { friendlyError } from "../src/lib/api-error.ts";

/**
 * The rate-limit check used to be `includes("rate")`, which matched
 * "generate", "accurate" and "separate" — and, running before the timeout and
 * JSON checks, hid their more useful messages behind "AI service is busy".
 */
test("a real rate limit is still recognised", () => {
  assert.equal(friendlyError(new Error("openai API 429: Too Many Requests")).status, 429);
  assert.equal(friendlyError(new Error("Rate limit exceeded for model")).status, 429);
  assert.equal(friendlyError(new Error("rate-limited, retry later")).status, 429);
});

test("'generate' in a message is not a rate limit", () => {
  const timeout = friendlyError(new Error("Failed to generate rollup: openai API request timed out after 120s"));
  assert.equal(timeout.status, 504, "the timeout message must win");
  const json = friendlyError(new Error("could not generate: AI response did not return valid JSON"));
  assert.equal(json.status, 502);
  const generic = friendlyError(new Error("separate failure while accurate"));
  assert.equal(generic.status, 500);
});

test("a 429 embedded in a longer number is not a rate limit", () => {
  assert.equal(friendlyError(new Error("wrote 14290 bytes")).status, 500);
});
