import { test } from "node:test";
import assert from "node:assert/strict";
import {
  placeSpan, isStale, disposition,
  SESSION_GAP_MS, SESSION_MAX_VOICED_MS, SESSION_MAX_WALL_MS, SESSION_MIN_VOICED_MS,
} from "../src/lib/capture/sessions.ts";

let n = 0;
const id = () => `s${++n}`;
const span = (startMs: number, ms: number, chunkId = "c") => ({ chunkId, startMs, endMs: startMs + ms });

test("first span opens a session", () => {
  const r = placeSpan(null, span(1000, 500), id);
  assert.equal(r.close, null);
  assert.equal(r.open.startedAtMs, 1000);
  assert.equal(r.open.lastSpeechAtMs, 1500);
  assert.equal(r.open.voicedMs, 500);
  assert.equal(r.open.spans.length, 1);
});

test("a span within the gap joins; one past the gap closes and reopens", () => {
  const first = placeSpan(null, span(0, 1000), id).open;
  const joined = placeSpan(first, span(1000 + SESSION_GAP_MS, 1000), id);
  assert.equal(joined.close, null);
  assert.equal(joined.open.id, first.id);
  assert.equal(joined.open.voicedMs, 2000);
  const split = placeSpan(first, span(1000 + SESSION_GAP_MS + 1, 1000), id);
  assert.equal(split.close?.id, first.id);
  assert.notEqual(split.open.id, first.id);
  assert.equal(split.open.voicedMs, 1000);
  assert.equal(first.spans.length, 1, "inputs are not mutated");
});

test("the voiced cap and the wall cap both force a close", () => {
  const open = placeSpan(null, span(0, SESSION_MAX_VOICED_MS), id).open;
  const r = placeSpan(open, span(SESSION_MAX_VOICED_MS + 10, 100), id);
  assert.equal(r.close?.id, open.id);
  const early = placeSpan(null, span(0, 100), id).open;
  const late = placeSpan(early, span(SESSION_MAX_WALL_MS + 1, 100), id);
  assert.equal(late.close?.id, early.id);
});

test("isStale is the gap measured from the last speech", () => {
  const open = placeSpan(null, span(0, 1000), id).open;
  assert.equal(isStale(open, 1000 + SESSION_GAP_MS), false);
  assert.equal(isStale(open, 1000 + SESSION_GAP_MS + 1), true);
});

test("disposition discards under the voiced floor", () => {
  assert.equal(disposition(placeSpan(null, span(0, SESSION_MIN_VOICED_MS - 1), id).open), "discard");
  assert.equal(disposition(placeSpan(null, span(0, SESSION_MIN_VOICED_MS), id).open), "transcribe");
});
