import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSuggestion, weeklyCounts, buildCodebookMarkdown, buildSuggestPrompt } from "../src/lib/codebook.ts";

const analysis = {
  rq1_documentary_record: "The grazing permit was “inherited” from his father.  It sits in a drawer.",
  rq2_everyday_practices: "Branding is a status claim.",
  rq3_cskt_intersection: "",
  rq4_wildness_imaginary: "",
  conditions_check: "",
  rival_hypothesis_test: "",
  refutation_signals: "",
  forward_thinking: "",
};

test("validateSuggestion keeps verbatim excerpts and drops paraphrase", () => {
  const out = validateSuggestion(
    {
      applications: [
        { codeId: "a", field: "rq1_documentary_record", excerpt: 'The grazing permit was "inherited" from his father. It sits in a drawer.' },
        { codeId: "a", field: "rq1_documentary_record", excerpt: "The permit came from his dad." },
        { codeId: "zzz", field: "rq2_everyday_practices", excerpt: "Branding is a status claim." },
      ],
      proposed: [
        { name: "Inheritance", description: "d", field: "wrong_field", excerpt: "Branding is a status claim." },
        { name: "", field: "rq2_everyday_practices", excerpt: "Branding is a status claim." },
      ],
    },
    analysis,
    new Set(["a"]),
  );
  assert.equal(out.applications.length, 1);
  assert.equal(out.applications[0].field, "rq1_documentary_record");
  assert.equal(out.proposed.length, 1);
  assert.equal(out.proposed[0].field, "rq2_everyday_practices");
});

test("validateSuggestion de-duplicates identical applications", () => {
  const out = validateSuggestion(
    { applications: [
      { codeId: "a", field: "rq2_everyday_practices", excerpt: "Branding is a status claim." },
      { codeId: "a", field: "rq2_everyday_practices", excerpt: "Branding is a status claim." },
    ] },
    analysis,
    new Set(["a"]),
  );
  assert.equal(out.applications.length, 1);
});

const mondayOf = (d: string) => {
  const dt = new Date(`${d}T12:00:00`);
  const dow = dt.getDay();
  dt.setDate(dt.getDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().slice(0, 10);
};
const addDays = (d: string, n: number) => {
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + n);
  return dt.toISOString().slice(0, 10);
};

test("weeklyCounts buckets by Monday over the trailing window", () => {
  const rows = weeklyCounts(
    [{ timestamp: "2026-09-15T10:00:00Z" }, { timestamp: "2026-09-16T10:00:00Z" }, { timestamp: "2026-07-01T10:00:00Z" }],
    mondayOf, addDays, "2026-09-20", 4,
  );
  assert.equal(rows.length, 4);
  assert.equal(rows[rows.length - 1].week, "2026-09-14");
  assert.equal(rows[rows.length - 1].count, 2);
  assert.equal(rows.reduce((s, r) => s + r.count, 0), 2);
});

test("buildCodebookMarkdown groups excerpts under their code", () => {
  const { markdown } = buildCodebookMarkdown(
    [{ id: "a", name: "Inheritance", description: "Land passed down", timestamp: "" }],
    [{ id: "e", codeId: "a", conversationId: "c", conversationTitle: "Branding day", date: "2026-08-01", field: "rq1_documentary_record", excerpt: "It sits in a drawer.", source: "manual", timestamp: "" }],
  );
  assert.ok(markdown.includes("## Inheritance"));
  assert.ok(markdown.includes("> It sits in a drawer."));
  assert.ok(markdown.includes("Branding day"));
});

test("buildSuggestPrompt lists codes and skips empty dimensions", () => {
  const p = buildSuggestPrompt("T", analysis, [{ id: "a", name: "Inheritance", description: "" }]);
  assert.ok(p.includes('- a: "Inheritance"'));
  assert.ok(p.includes("### rq1_documentary_record"));
  assert.ok(!p.includes("### rq3_cskt_intersection"));
});

test("weeklyCounts reads createdAt over the merge clock, and skips bad stamps", () => {
  const rows = weeklyCounts(
    [
      { timestamp: "2026-09-19T10:00:00Z", createdAt: "2026-07-01T10:00:00Z" },
      { timestamp: "2026-09-19T10:00:00Z" },
      { timestamp: "garbage" },
      { timestamp: 12 as unknown as string },
    ],
    mondayOf, addDays, "2026-09-20", 4,
  );
  assert.equal(rows.reduce((s, r) => s + r.count, 0), 1);
});

test("weeklyCounts buckets by the caller's local day, not the UTC date", () => {
  // 23:30 on Sunday the 20th in a UTC-6 zone is 05:30 UTC on Monday the 21st.
  const localDayOf = (iso: string) => (iso === "2026-09-21T05:30:00Z" ? "2026-09-20" : iso.slice(0, 10));
  const rows = weeklyCounts([{ timestamp: "2026-09-21T05:30:00Z" }], mondayOf, addDays, "2026-09-22", 2, localDayOf);
  assert.deepEqual(rows.map((r) => r.count), [1, 0]);
  const utcRows = weeklyCounts([{ timestamp: "2026-09-21T05:30:00Z" }], mondayOf, addDays, "2026-09-22", 2);
  assert.deepEqual(utcRows.map((r) => r.count), [0, 1]);
});
