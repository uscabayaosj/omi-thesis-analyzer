import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConversationCached, resetConversationCache } from "../src/lib/voice-evidence.ts";

const originalFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => { status: number; body: unknown }) {
  let calls = 0;
  globalThis.fetch = (async (input: string) => {
    calls++;
    const { status, body } = handler(String(input));
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return () => calls;
}

test("many cards on one conversation make a single request", async () => {
  resetConversationCache();
  const calls = stubFetch(() => ({ status: 200, body: { id: "c1", created_at: "2026-09-07T00:00:00.000Z" } }));
  try {
    const [a, b, c] = await Promise.all([
      loadConversationCached("c1"),
      loadConversationCached("c1"),
      loadConversationCached("c1"),
    ]);
    assert.equal(a.id, "c1");
    assert.equal(b.id, "c1");
    assert.equal(c.id, "c1");
    assert.equal(calls(), 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("distinct conversations each get their own request", async () => {
  resetConversationCache();
  const calls = stubFetch((url) => ({
    status: 200,
    body: { id: url.split("/").pop(), created_at: "2026-09-07T00:00:00.000Z" },
  }));
  try {
    await Promise.all([loadConversationCached("c1"), loadConversationCached("c2")]);
    assert.equal(calls(), 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a failure is evicted so a later card can retry", async () => {
  resetConversationCache();
  let fail = true;
  const calls = stubFetch(() =>
    fail
      ? { status: 500, body: { error: "boom" } }
      : { status: 200, body: { id: "c1", created_at: "2026-09-07T00:00:00.000Z" } }
  );
  try {
    await assert.rejects(loadConversationCached("c1"), /boom/);
    fail = false;
    const ok = await loadConversationCached("c1");
    assert.equal(ok.id, "c1");
    assert.equal(calls(), 2, "the rejected promise must not be cached");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
