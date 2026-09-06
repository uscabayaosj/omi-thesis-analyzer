import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateTime, formatTime, dayOf, todayString } from "../src/lib/format.ts";

/**
 * formatDateTime/formatTime went from `toLocaleDateString` (which builds a
 * new Intl.DateTimeFormat on every call) to a shared formatter per option
 * set. The output must be byte-identical: the calendar's aria-labels, the
 * rollup datelines, and the export filenames all read these strings.
 */

const SAMPLE = "2026-09-05T15:30:00.000Z";

const OPTION_SETS: Intl.DateTimeFormatOptions[] = [
  { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" },
  { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  { weekday: "long", day: "numeric", month: "long" },
  { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" },
  { month: "long", year: "numeric" },
];

test("formatDateTime matches toLocaleDateString for every option set the app uses", () => {
  for (const options of OPTION_SETS) {
    assert.equal(
      formatDateTime(SAMPLE, options),
      new Date(SAMPLE).toLocaleDateString("en-GB", options),
      JSON.stringify(options)
    );
  }
});

test("the default option set is unchanged", () => {
  assert.equal(
    formatDateTime(SAMPLE),
    new Date(SAMPLE).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
  );
});

test("formatTime matches toLocaleTimeString", () => {
  assert.equal(
    formatTime(SAMPLE),
    new Date(SAMPLE).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  );
});

test("a shared formatter does not leak one option set into another", () => {
  const long = formatDateTime(SAMPLE, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const short = formatDateTime(SAMPLE);
  assert.notEqual(long, short);
  // And asking for the first set again returns the same string as the first time.
  assert.equal(formatDateTime(SAMPLE, { weekday: "long", day: "numeric", month: "long", year: "numeric" }), long);
});

test("garbage and missing timestamps never throw", () => {
  assert.equal(formatDateTime(undefined), "Unknown date");
  assert.equal(formatDateTime("not a date"), "Unknown date");
  assert.equal(formatTime(null), "Unknown time");
});

/**
 * Day grouping is in local time. The regression this guards: a conversation
 * at 19:00 Montana time (01:00 UTC next day) was filed under tomorrow, and a
 * 07:00 Manila conversation (23:00 UTC yesterday) under yesterday.
 */
function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

test("dayOf groups by the device's local calendar day", () => {
  // Late evening local, whatever the zone: build from local components so the
  // expectation is independent of where the test runs.
  const late = new Date(2026, 8, 5, 23, 30, 0);
  assert.equal(dayOf(late.toISOString()), localDay(late));
  const early = new Date(2026, 8, 5, 0, 30, 0);
  assert.equal(dayOf(early.toISOString()), localDay(early));
});

test("dayOf leaves a bare date alone and never throws on garbage", () => {
  assert.equal(dayOf("2026-09-05"), "2026-09-05");
  assert.equal(dayOf("garbage-but-long-enough"), "unknown-date");
  assert.equal(dayOf(""), "unknown-date");
});

test("todayString is today's local day", () => {
  assert.equal(todayString(), localDay(new Date()));
});
