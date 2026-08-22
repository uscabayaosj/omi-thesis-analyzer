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
  try {
    client = url ? neon(url) : null;
  } catch (e) {
    // A malformed connection string throws from `neon()` itself. Degrade to
    // "not configured" — same as no DATABASE_URL — rather than letting a bad
    // env var crash every route that touches the store.
    console.error("Failed to construct Neon client; treating store as unconfigured", e);
    client = null;
  }
  return client;
}

/**
 * Runs a Neon query with a hard deadline. `fetchOptions.signal` is fixed at
 * client-construction time (so it can't just be set once on the client — a
 * one-shot `AbortSignal.timeout()` there would abort every query after the
 * first `timeoutMs` on a warm serverless instance), so we race the promise
 * instead: a slow/unreachable endpoint fails fast rather than hanging the
 * calling route for the platform's full function timeout.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Neon query timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export function isStoreConfigured(): boolean {
  return getStore() !== null;
}

/** Created on first use so there's no migration step to run or forget. */
export async function ensureSchema(sql: Sql): Promise<void> {
  await withTimeout(
    sql`
      CREATE TABLE IF NOT EXISTS trace_store (
        namespace   TEXT PRIMARY KEY,
        data        JSONB NOT NULL,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `
  );
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
