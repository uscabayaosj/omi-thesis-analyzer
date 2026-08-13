import { Redis } from "@upstash/redis";

/**
 * Server-side durable store. Optional by construction: the app is fully
 * functional on localStorage alone, and this layer only adds cross-device
 * durability on top. Every caller must handle `null` — that is the normal
 * state before the Upstash integration is provisioned, not an error.
 */
let client: Redis | null | undefined;

export function getStore(): Redis | null {
  if (client !== undefined) return client;
  // Upstash's Vercel integration injects the KV_ prefixed pair; the bare
  // UPSTASH_ names are what a manual/self-hosted setup uses. Accept either.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

export function isStoreConfigured(): boolean {
  return getStore() !== null;
}

/** The localStorage keys mirrored to the server. Anything outside this list
 *  stays device-local (the conversation cache, for instance, is disposable and
 *  re-fetchable from Omi — mirroring it would just burn storage). */
export const SYNCED_NAMESPACES = [
  "omi-thesis-analyses",
  "omi-adhd-analyses",
  "omi-adhd-rollups",
  "omi-thesis-group-analyses",
] as const;

export type SyncedNamespace = (typeof SYNCED_NAMESPACES)[number];

export function isSyncedNamespace(v: string): v is SyncedNamespace {
  return (SYNCED_NAMESPACES as readonly string[]).includes(v);
}
