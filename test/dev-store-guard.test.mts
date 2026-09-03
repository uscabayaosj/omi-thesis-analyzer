import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Regression for the dev→prod store leak (2026-09-03): local dev pulled
 * production's DATABASE_URL via `vercel env pull`, so records seeded during
 * local testing synced into the production trace_store. The store client must
 * refuse a configured URL outside a production build unless the override is
 * explicitly set — deleting the env var locally is not enough, because the
 * next `vercel env pull` silently restores it.
 *
 * Each case busts the module cache with a query string so getStore()'s
 * memoized client can't bleed between cases. node --test runs with
 * NODE_ENV unset, which must count as "not production".
 */

test("a DATABASE_URL outside production is refused", async () => {
  process.env.DATABASE_URL = "postgres://user:pw@example.neon.tech/db";
  delete process.env.TRACE_DEV_STORE_OK;
  const { getStore } = await import("../src/lib/kv.ts?guard=refuse");
  assert.equal(getStore(), null);
});

test("the explicit override lets a dev database through", async () => {
  process.env.DATABASE_URL = "postgres://user:pw@example.neon.tech/db";
  process.env.TRACE_DEV_STORE_OK = "1";
  const { getStore } = await import("../src/lib/kv.ts?guard=override");
  assert.notEqual(getStore(), null);
  delete process.env.TRACE_DEV_STORE_OK;
});

test("no DATABASE_URL stays a plain unconfigured store", async () => {
  delete process.env.DATABASE_URL;
  delete process.env.TRACE_DEV_STORE_OK;
  const { getStore, isStoreConfigured } = await import("../src/lib/kv.ts?guard=unset");
  assert.equal(getStore(), null);
  assert.equal(isStoreConfigured(), false);
});
