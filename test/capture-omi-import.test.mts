import { test } from "node:test";
import assert from "node:assert/strict";
import { omiToRow } from "../src/lib/capture/omi-import-map.ts";

test("an Omi conversation maps to a row with ids and Omi fields preserved", () => {
  const row = omiToRow({
    id: "abc",
    created_at: "2026-09-02T10:00:00Z",
    started_at: "2026-09-02T09:58:00Z",
    finished_at: "2026-09-02T10:20:00Z",
    structured: { title: "T", overview: "O" },
    transcript_segments: [{ text: "one two", speaker_id: 0 }, { text: "three", speaker_id: 1 }],
    geolocation: { latitude: 1, longitude: 2 },
  });
  assert.equal(row.id, "abc");
  assert.equal(row.source, "omi");
  assert.equal(row.word_count, 3);
  assert.deepEqual(row.structured, { title: "T", overview: "O" });
  assert.deepEqual(row.geolocation, { latitude: 1, longitude: 2 });
  assert.equal(row.session_id, null);
  assert.equal(row.audio_refs, null);
});

test("missing optional fields become nulls and empty arrays", () => {
  const row = omiToRow({ id: "x", created_at: "2026-09-02T10:00:00Z" });
  assert.equal(row.started_at, null);
  assert.deepEqual(row.transcript_segments, []);
  assert.equal(row.word_count, 0);
  assert.equal(row.structured, null);
});
