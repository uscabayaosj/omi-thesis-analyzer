import { test } from "node:test";
import assert from "node:assert/strict";
import { computePatterns, loopKey } from "../src/lib/patterns.ts";

const toDay = (dt: Date) => {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};
const dayOf = (iso: string) => (iso.length === 10 ? iso : toDay(new Date(iso)));
const addDays = (d: string, n: number) => { const dt = new Date(`${d}T12:00:00`); dt.setDate(dt.getDate() + n); return toDay(dt); };
const mondayOf = (d: string) => { const dt = new Date(`${d}T12:00:00`); const dow = dt.getDay(); dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow)); return toDay(dt); };
const h = { dayOf, addDays, mondayOf, today: "2026-09-20" };

function analysis(id: string, day: string, commitments: { key: string; who: string }[], opts: { done?: string[]; letGo?: string[]; loops?: string[] } = {}) {
  return {
    conversationId: id,
    timestamp: `${day}T12:00:00`,
    title: `Conv ${id}`,
    date: day,
    doneKeys: opts.done ?? [],
    letGoKeys: opts.letGo ?? [],
    analysis: {
      do_today: [], remember: [], people: [], ahead: [], summary: "",
      open_loops: opts.loops ?? [],
      commitments: commitments.map((c) => ({ ...c, direction: "user_to_other" as const, what: "x", deadline: "None", confidence: "FIRM" as const, quote: "" })),
    },
  };
}

function rollup(day: string, steps: string[], done: string[] = []) {
  return {
    day, timestamp: `${day}T20:00:00`, conversationIds: [],
    planDoneKeys: done,
    rollup: {
      tomorrow_plan: "", aging_commitments: "", conflicts_at_risk: "", social_ledger: "", tomorrow_events: "", today_paragraph: "", dropped: "",
      plan_steps: steps.map((k) => ({ key: k, what: k })),
    },
  };
}

test("commitments are bucketed by week and split into done, let go, open", () => {
  const p = computePatterns(
    [analysis("a", "2026-09-15", [{ key: "k1", who: "Ann" }, { key: "k2", who: "Ann" }, { key: "k3", who: "Bob" }], { done: ["k1"], letGo: ["k2"] })],
    [], h,
  );
  const wk = p.weeks.find((w) => w.week === "2026-09-14")!;
  assert.deepEqual({ created: wk.created, done: wk.done, letGo: wk.letGo, open: wk.open }, { created: 3, done: 1, letGo: 1, open: 1 });
  assert.equal(p.completionRate, 1 / 3);
  assert.equal(p.openCount, 1);
  assert.equal(p.openMedianAgeDays, 5);
  assert.deepEqual(p.people.map((x) => x.who), ["Bob"]);
});

test("rollup streak counts closed days back from yesterday and stops at an unclosed active day", () => {
  const p = computePatterns(
    [analysis("a", "2026-09-19", []), analysis("b", "2026-09-18", []), analysis("c", "2026-09-17", [])],
    [rollup("2026-09-19", []), rollup("2026-09-18", [])], h,
  );
  assert.equal(p.rollupStreak, 2);
});

test("quiet days do not break a streak but three in a row end it", () => {
  const p = computePatterns(
    [analysis("a", "2026-09-19", []), analysis("b", "2026-09-17", [])],
    [rollup("2026-09-19", []), rollup("2026-09-17", []), rollup("2026-09-10", [])], h,
  );
  assert.equal(p.rollupStreak, 2);
});

test("recurring loops need two conversations, not two mentions in one", () => {
  const p = computePatterns(
    [
      analysis("a", "2026-09-15", [], { loops: ["Call the vet about the bull.", "call the vet about the bull"] }),
      analysis("b", "2026-09-16", [], { loops: ["Call the vet about the bull!"] }),
      analysis("c", "2026-09-16", [], { loops: ["Fix the gate"] }),
    ],
    [], h,
  );
  assert.equal(p.loops.length, 1);
  assert.equal(p.loops[0].count, 2);
  assert.equal(loopKey("Call the vet about the bull!"), "call the vet about the bull");
});

test("plan follow-through ignores ticks for steps that no longer exist", () => {
  const p = computePatterns([], [rollup("2026-09-18", ["s1", "s2"], ["s1", "gone"]), rollup("2026-09-19", ["s3"], [])], h);
  assert.equal(p.planRate, 1 / 3);
  assert.deepEqual(p.planDays.map((d) => d.done), [1, 0]);
});

test("coverage counts active days and how many were closed", () => {
  const p = computePatterns(
    [analysis("a", "2026-09-15", []), analysis("b", "2026-09-16", [])],
    [rollup("2026-09-15", [])], h,
  );
  const wk = p.coverage.find((c) => c.week === "2026-09-14")!;
  assert.deepEqual({ a: wk.activeDays, r: wk.rolledDays }, { a: 2, r: 1 });
});
