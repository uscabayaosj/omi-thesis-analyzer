/**
 * Server-side storage for Web Push subscriptions — one row per
 * browser/device that has opted in to the missed-rollup nudge.
 *
 * Same lazy-schema, degrade-gracefully posture as trace_store (kv.ts) and
 * trace_usage (usage.ts): every function no-ops when the store isn't
 * configured rather than throwing, and the schema is created on first use
 * with no separate migration step.
 */

import { getStore, withTimeout, type Sql } from "./kv";

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

let schemaReady: Promise<void> | null = null;

async function ensurePushSchema(sql: Sql): Promise<void> {
  await withTimeout(
    sql`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint    TEXT PRIMARY KEY,
        p256dh      TEXT NOT NULL,
        auth        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
  );
}

async function ensurePushSchemaOnce(sql: Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensurePushSchema(sql);
  }
  try {
    await schemaReady;
  } catch (e) {
    schemaReady = null; // allow retry on the next call if this attempt failed
    throw e;
  }
}

/** No-ops if the store isn't configured. */
export async function addSubscription(sub: PushSubscriptionRow): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  await ensurePushSchemaOnce(sql);
  await withTimeout(sql`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth)
    VALUES (${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
    ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
  `);
}

/** No-ops (including "no such row") if the store isn't configured or the row is already gone. */
export async function removeSubscription(endpoint: string): Promise<void> {
  const sql = getStore();
  if (!sql) return;
  await ensurePushSchemaOnce(sql);
  await withTimeout(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
}

/** Returns an empty array if the store isn't configured. */
export async function listSubscriptions(): Promise<PushSubscriptionRow[]> {
  const sql = getStore();
  if (!sql) return [];
  await ensurePushSchemaOnce(sql);
  const rows = (await withTimeout(
    sql`SELECT endpoint, p256dh, auth FROM push_subscriptions`
  )) as PushSubscriptionRow[];
  return rows;
}
