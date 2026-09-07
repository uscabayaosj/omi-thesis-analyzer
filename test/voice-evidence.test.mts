import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVoiceEvidence } from "../src/lib/voice-evidence.ts";
import type { Conversation } from "../src/lib/conversation-types.ts";

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  created_at: "2026-09-07T06:40:00.000Z",
  source: "trace",
  structured: { title: "Field visit", overview: "" },
  transcript_segments: [
    { text: "yeah", speaker_id: 2, start: 0, end: 0.5 },
    { text: "So we moved the herd up past the old fence line last week.", speaker_id: 2, start: 1, end: 5 },
    { text: "Right, and how did that go?", speaker_id: 1, speaker_name: "Ana", start: 5, end: 7 },
    { text: "Better than the year before, honestly, once the water was running again.", speaker_id: 2, start: 7, end: 11 },
    { text: "mm-hm", speaker_id: 2, start: 11, end: 11.5 },
    { text: "Good.", speaker_id: 0, speaker_name: "Marco", start: 12, end: 12.5 },
  ],
  ...over,
});

test("quotes the speaker's longest lines, in the order they were spoken", () => {
  const e = buildVoiceEvidence(conv(), 2);
  assert.equal(e.quotes.length, 3);
  assert.ok(e.quotes[0].startsWith("So we moved the herd"));
  assert.ok(e.quotes[1].startsWith("Better than the year before"));
  // "mm-hm" (5 chars) beats "yeah" (4), and is spoken last of the three —
  // so this pins both the longest-first selection and the chronological output.
  assert.equal(e.quotes[2], "mm-hm");
});

test("counts only the target speaker's lines and speech time", () => {
  const e = buildVoiceEvidence(conv(), 2);
  assert.equal(e.lineCount, 4);
  assert.ok(Math.abs(e.speechSeconds - 9) < 1e-9);
});

test("lists the other named speakers, deduped, excluding the target", () => {
  const e = buildVoiceEvidence(conv(), 2);
  assert.deepEqual(e.othersPresent, ["Ana", "Marco"]);
});

test("omits unnamed speakers from othersPresent", () => {
  const e = buildVoiceEvidence(
    conv({
      transcript_segments: [
        { text: "one", speaker_id: 2, start: 0, end: 1 },
        { text: "two", speaker_id: 3, start: 1, end: 2 },
      ],
    }),
    2
  );
  assert.deepEqual(e.othersPresent, []);
});

test("truncates a long quote on a word boundary", () => {
  const long = "word ".repeat(60).trim();
  const e = buildVoiceEvidence(
    conv({ transcript_segments: [{ text: long, speaker_id: 2, start: 0, end: 1 }] }),
    2
  );
  assert.ok(e.quotes[0].length <= 141, "truncated to the cap plus the ellipsis");
  assert.ok(e.quotes[0].endsWith("…"));
  assert.ok(!e.quotes[0].includes("wor…"), "must not cut mid-word");
});

test("speechSeconds is 0 when segments carry no timings", () => {
  const e = buildVoiceEvidence(
    conv({ transcript_segments: [{ text: "hello there", speaker_id: 2 }] }),
    2
  );
  assert.equal(e.speechSeconds, 0);
  assert.equal(e.lineCount, 1);
});

test("skips blank segments when choosing quotes", () => {
  const e = buildVoiceEvidence(
    conv({
      transcript_segments: [
        { text: "   ", speaker_id: 2, start: 0, end: 1 },
        { text: "real line", speaker_id: 2, start: 1, end: 2 },
      ],
    }),
    2
  );
  assert.deepEqual(e.quotes, ["real line"]);
});

test("uses the structured title when there is one", () => {
  assert.equal(buildVoiceEvidence(conv(), 2).title, "Field visit");
});

test("falls back to a title derived from the conversation's timestamp", () => {
  const morning = buildVoiceEvidence(
    conv({ structured: undefined, created_at: "2026-09-07T06:40:00.000Z" }),
    2
  );
  const evening = buildVoiceEvidence(
    conv({ structured: undefined, created_at: "2026-09-10T19:05:00.000Z" }),
    2
  );
  assert.notEqual(morning.title, "");
  assert.notEqual(morning.title, "Field visit");
  // The real assertion: the fallback is a function of created_at, not a
  // constant. Locale-independent, so it holds wherever this suite runs.
  assert.notEqual(morning.title, evening.title);
});

test("an unparseable timestamp still yields a usable title", () => {
  assert.equal(
    buildVoiceEvidence(conv({ structured: undefined, created_at: "not a date" }), 2).title,
    "Untitled conversation"
  );
});

test("canPlay is true only for TRACE-captured conversations", () => {
  assert.equal(buildVoiceEvidence(conv(), 2).canPlay, true);
  assert.equal(buildVoiceEvidence(conv({ source: "omi" }), 2).canPlay, false);
  assert.equal(buildVoiceEvidence(conv({ source: undefined }), 2).canPlay, false);
});

test("a speaker with no segments yields an empty but valid evidence block", () => {
  const e = buildVoiceEvidence(conv(), 9);
  assert.deepEqual(e.quotes, []);
  assert.equal(e.lineCount, 0);
  assert.equal(e.speechSeconds, 0);
});
