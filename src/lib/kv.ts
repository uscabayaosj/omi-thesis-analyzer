import { neon } from "@neondatabase/serverless";

/**
 * Server-side durable store, backed by Neon Postgres.
 *
 * Optional by construction: the app is fully functional on localStorage alone,
 * and this layer only adds cross-device durability on top. Every caller must
 * handle `null` — that is the normal state when DATABASE_URL isn't set (local
 * dev without a pull, a fork, a preview without the integration), not an error.
 *
 * The shape is deliberately key-value rather than a modelled schema: the client
 * owns the merge and ships whole namespace maps, so Postgres is storing four
 * JSONB documents. That keeps this swappable — it was Redis before Upstash's
 * free tier turned out to be unavailable on this account.
 */
type Sql = ReturnType<typeof neon>;

let client: Sql | null | undefined;

export function getStore(): Sql | null {
  if (client !== undefined) return client;
  // Lazily built, never at module scope: `neon()` throws on a missing URL, and
  // Next evaluates top-level module code at build time, which would break
  // `next build` on any deploy that hasn't been given the env var yet.
  const url = process.env.DATABASE_URL;
  client = url ? neon(url) : null;
  return client;
}

export function isStoreConfigured(): boolean {
  return getStore() !== null;
}

/** Created on first use so there's no migration step to run or forget. */
export async function ensureSchema(sql: Sql): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS trace_store (
      namespace   TEXT PRIMARY KEY,
      data        JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
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
