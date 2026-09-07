import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterEmbeddings, voiceKey } from "../src/lib/capture/cluster.ts";

const A = [1, 0, 0];
const A2 = [0.99, 0.14, 0];   // ~0.99 cosine with A
const B = [0, 1, 0];
const B2 = [0.14, 0.99, 0];   // ~0.99 cosine with B

test("voiceKey joins a conversation and speaker", () => {
  assert.equal(voiceKey("c1", 2), "c1:2");
});

test("similar embeddings share a group, dissimilar ones do not", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c2:0", embedding: B },
      { key: "c3:2", embedding: A2 },
      { key: "c4:1", embedding: B2 },
    ],
    0.85
  );
  assert.equal(groups["c1:1"], groups["c3:2"]);
  assert.equal(groups["c2:0"], groups["c4:1"]);
  assert.notEqual(groups["c1:1"], groups["c2:0"]);
});

test("a group is named for its earliest member", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c3:2", embedding: A2 },
    ],
    0.85
  );
  assert.equal(groups["c1:1"], "c1:1");
  assert.equal(groups["c3:2"], "c1:1");
});

test("a below-threshold pair stays separate", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c2:0", embedding: A2 },
    ],
    0.999
  );
  assert.notEqual(groups["c1:1"], groups["c2:0"]);
});

test("a null embedding is its own group and never absorbs anyone", () => {
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: null },
      { key: "c2:0", embedding: null },
      { key: "c3:2", embedding: A },
    ],
    0.85
  );
  assert.equal(groups["c1:1"], "c1:1");
  assert.equal(groups["c2:0"], "c2:0");
  assert.equal(groups["c3:2"], "c3:2");
});

test("a bridging member merges two groups under the earliest name", () => {
  const mid = [0.7, 0.72, 0];
  const groups = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c2:0", embedding: B },
      { key: "c3:2", embedding: mid },
    ],
    0.65
  );
  assert.equal(groups["c1:1"], "c1:1");
  assert.equal(groups["c2:0"], "c1:1");
  assert.equal(groups["c3:2"], "c1:1");
});

test("adding a member to an existing set keeps the earlier group id stable", () => {
  const first = clusterEmbeddings([{ key: "c1:1", embedding: A }], 0.85);
  const second = clusterEmbeddings(
    [
      { key: "c1:1", embedding: A },
      { key: "c9:0", embedding: A2 },
    ],
    0.85
  );
  assert.equal(second["c1:1"], first["c1:1"]);
  assert.equal(second["c9:0"], first["c1:1"]);
});
