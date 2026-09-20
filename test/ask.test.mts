import { test } from "node:test";
import assert from "node:assert/strict";
import { tokenize, scorePassage, buildPassages, selectPassages, normalizeQuestion, buildAskPrompt } from "../src/lib/ask.ts";

const analyses = {
  list: [
    {
      conversationId: "c1",
      current: {
        conversationId: "c1",
        title: "Branding day",
        date: "2026-08-01T10:00:00Z",
        rq1_documentary_record: "Talk of the water compact and the grazing permit on the north pasture.",
        rq2_everyday_practices: "Cattle branding as a claim of status among the kin.",
        rq3_cskt_intersection: "",
        custom: { prompt: "What about fences?", result: "Fences were discussed at length." },
      },
      versions: [],
    },
  ],
};

const groups = {
  list: [
    {
      id: "g1",
      conversationIds: ["c1", "c2"],
      conversations: [{ title: "Branding day" }, { title: "Auction" }],
      timestamp: "2026-08-05T00:00:00Z",
      analysis: { synthesis: "Across both, the water compact recurs as the frame for federal intrusion." },
    },
  ],
};

test("tokenize drops stop words and stems plurals", () => {
  assert.deepEqual(tokenize("The ranchers and their permits"), ["rancher", "permit"]);
});

test("buildPassages yields one passage per non-empty field, including custom, and group fields", () => {
  const p = buildPassages(analyses, groups);
  assert.equal(p.filter((x) => x.kind === "conversation").length, 3);
  assert.equal(p.filter((x) => x.kind === "group").length, 1);
  assert.ok(p.some((x) => x.field === "custom.result"));
});

test("selectPassages ranks by overlap, drops zero-score, and tags in rank order", () => {
  const chosen = selectPassages(buildPassages(analyses, groups), "What is said about the water compact?");
  assert.equal(chosen.length, 2);
  assert.deepEqual(chosen.map((c) => c.tag).sort(), ["C1", "G1"]);
  assert.ok(chosen.every((c) => c.text.toLowerCase().includes("water compact")));
});

test("selectPassages honours the character budget but always keeps the best match", () => {
  const long = { list: [{ conversationId: "x", current: { conversationId: "x", title: "T", rq1_documentary_record: "compact ".repeat(2000), rq2_everyday_practices: "compact" } }] };
  const chosen = selectPassages(buildPassages(long, null), "compact", 100);
  assert.equal(chosen.length, 1);
  assert.ok(chosen[0].text.length <= 6_001);
});

test("scorePassage rewards repeated hits only a little", () => {
  const terms = new Set(tokenize("water"));
  assert.ok(scorePassage(terms, "water water water") > scorePassage(terms, "water"));
  assert.ok(scorePassage(terms, "water water water") < 2);
});

test("normalizeQuestion makes punctuation and case irrelevant", () => {
  assert.equal(normalizeQuestion("  What about FENCES?! "), normalizeQuestion("what about fences"));
});

test("buildAskPrompt carries tags, titles, and the question", () => {
  const chosen = selectPassages(buildPassages(analyses, groups), "water compact");
  const prompt = buildAskPrompt(chosen, "water compact");
  assert.ok(prompt.includes("[C1] Conversation \"Branding day\""));
  assert.ok(prompt.endsWith("Question: water compact"));
});
