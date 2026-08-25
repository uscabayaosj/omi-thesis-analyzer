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
export type Sql = ReturnType<typeof neon>;

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

/** Read one namespace's raw JSONB document, or null if the row doesn't exist. */
export async function getNamespaceData(sql: Sql, namespace: string): Promise<unknown | null> {
  const rows = (await withTimeout(sql`
    SELECT data FROM trace_store WHERE namespace = ${namespace}
  `)) as { data: unknown }[];
  return rows[0]?.data ?? null;
}

/** Replace one namespace's document wholesale. */
export async function putNamespaceData(sql: Sql, namespace: string, data: unknown): Promise<void> {
  await withTimeout(sql`
    INSERT INTO trace_store (namespace, data, updated_at)
    VALUES (${namespace}, ${JSON.stringify(data)}::jsonb, now())
    ON CONFLICT (namespace)
    DO UPDATE SET data = EXCLUDED.data, updated_at = now()
  `);
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
  "omi-adhd-weekly-rollups",
  "omi-thesis-group-analyses",
  "omi-people",
  "omi-people-pending",
] as const;

export type SyncedNamespace = (typeof SYNCED_NAMESPACES)[number];

export function isSyncedNamespace(v: string): v is SyncedNamespace {
  return (SYNCED_NAMESPACES as readonly string[]).includes(v);
}

/**
 * Namespaces whose localStorage value is a bare array rather than a keyed
 * map. These cannot be stored as-is: PUT /api/store rejects a top-level
 * array (it expects an object map), so sync.ts wraps them as
 * `{ list: [...] }` on push and unwraps on pull. That wrapper is a
 * transport artifact of the store's object-map contract, NOT part of the
 * data model — anything reading these namespaces server-side must unwrap
 * to get the canonical client shape.
 */
const ARRAY_NAMESPACES = new Set<string>(["omi-thesis-group-analyses", "omi-thesis-analyses"]);

export function isArrayNamespace(ns: string): boolean {
  return ARRAY_NAMESPACES.has(ns);
}

/**
 * Returns a namespace's value in the canonical client shape — unwrapping
 * the `{ list: [...] }` transport wrapper for array namespaces so a
 * server-read value is structurally identical to the localStorage value.
 *
 * Anything that doesn't match a known shape is passed through untouched
 * rather than coerced. This function feeds the backup export, where losing
 * data is the worst possible failure: a corrupted or unexpectedly-shaped
 * value is still evidence worth preserving verbatim, and nulling it would
 * discard it silently — the one way a backup could quietly lose something.
 */
export function toCanonicalShape(ns: string, raw: unknown): unknown {
  if (!isArrayNamespace(ns)) return raw;
  if (Array.isArray(raw)) return raw; // defensive: already unwrapped
  if (raw && typeof raw === "object" && Array.isArray((raw as { list?: unknown }).list)) {
    return (raw as { list: unknown[] }).list;
  }
  return raw;
}
