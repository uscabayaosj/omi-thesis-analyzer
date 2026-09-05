import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTranscribeUrl,
  optionsFromEnv,
  parseKeytermsEnv,
  DEFAULT_KEYTERMS,
} from "../src/lib/capture/transcribe-url.ts";

const params = (url: string) => new URL(url).searchParams;

test("default URL carries the quality settings", () => {
  const p = params(buildTranscribeUrl());
  assert.equal(p.get("model"), "nova-3");
  assert.equal(p.get("language"), "en");
  assert.equal(p.get("diarize_model"), "latest");
  assert.equal(p.get("diarize"), null);
  assert.equal(p.get("utterances"), "true");
  assert.equal(p.get("utt_split"), "1");
  assert.equal(p.get("smart_format"), "true");
  assert.equal(p.get("punctuate"), "true");
  assert.equal(p.get("numerals"), "true");
  assert.equal(p.get("measurements"), "true");
  assert.equal(p.get("filler_words"), "false");
  assert.equal(p.get("mip_opt_out"), "false");
  assert.equal(p.get("tag"), "trace-capture");
  assert.deepEqual(p.getAll("keyterm"), [...DEFAULT_KEYTERMS]);
});

test("keyterms are repeated params, not comma-joined or weighted", () => {
  const p = params(buildTranscribeUrl({ keyterms: ["Big Hole Valley", "sovereignty"] }));
  assert.deepEqual(p.getAll("keyterm"), ["Big Hole Valley", "sovereignty"]);
  assert.match(buildTranscribeUrl({ keyterms: ["Big Hole"] }), /keyterm=Big\+Hole/);
});

test("env knobs override defaults and extend the keyterm list without duplicates", () => {
  const o = optionsFromEnv({
    DEEPGRAM_KEYTERMS: " Ruby Valley , sovereignty,, cattle drive ",
    DEEPGRAM_FILLER_WORDS: "true",
    DEEPGRAM_UTT_SPLIT: "0.6",
    DEEPGRAM_MIP_OPT_OUT: "false",
    DEEPGRAM_LANGUAGE: "en-US",
  });
  const p = params(buildTranscribeUrl(o));
  assert.equal(p.get("filler_words"), "true");
  assert.equal(p.get("utt_split"), "0.6");
  assert.equal(p.get("mip_opt_out"), "false");
  assert.equal(p.get("language"), "en-US");
  const terms = p.getAll("keyterm");
  assert.equal(terms.filter((t) => t.toLowerCase() === "sovereignty").length, 1);
  assert.ok(terms.includes("Ruby Valley") && terms.includes("cattle drive"));
});

test("unset or junk env falls back to defaults", () => {
  const p = params(buildTranscribeUrl(optionsFromEnv({ DEEPGRAM_UTT_SPLIT: "abc", DEEPGRAM_LANGUAGE: "" })));
  assert.equal(p.get("utt_split"), "1");
  assert.equal(p.get("language"), "en");
  assert.equal(parseKeytermsEnv(undefined), undefined);
  assert.deepEqual(parseKeytermsEnv(" , "), []);
});
