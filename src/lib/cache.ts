"use client";

// Lightweight stale-while-revalidate cache backed by localStorage.
//
// Two access patterns:
//   • Volatile data (conversation list): read cache for an instant paint,
//     then revalidate over the network and overwrite.
//   • Immutable data (a finished conversation's transcript): read cache and
//     skip the network entirely — a recorded conversation never changes.
//
// An LRU cap keeps transcripts (which can be large) from exhausting the
// ~5 MB localStorage budget. Eviction is transparent: a miss simply re-fetches.

interface CacheEntry<T> {
  data: T;
  storedAt: number;
  lastAccess: number;
}

const PREFIX = "omi-cache:";
const MAX_ENTRIES = 30;

// Last-access times live in one small index rather than inside each entry.
// They used to be stored on the entry itself, which meant every cache READ
// re-stringified and rewrote the whole blob just to bump a timestamp (a
// transcript read cost a transcript write), and eviction had to JSON.parse
// every cached transcript to find the oldest. Now a read touches one short
// map and eviction never opens a blob.
const INDEX_KEY = `${PREFIX}__index`;
type AccessIndex = Record<string, number>;

function keyFor(key: string): string {
  return PREFIX + key;
}

function readIndex(): AccessIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeIndex(index: AccessIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    /* bookkeeping is best-effort */
  }
}

function touch(storageKey: string): void {
  const index = readIndex();
  index[storageKey] = Date.now();
  writeIndex(index);
}

function allCacheKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX) && k !== INDEX_KEY) keys.push(k);
  }
  return keys;
}

/** Cache keys ordered least-recently-used first. Entries the index has never
 *  seen (written before the index existed) sort as oldest. */
function keysByAge(): string[] {
  const index = readIndex();
  return allCacheKeys().sort((a, b) => (index[a] ?? 0) - (index[b] ?? 0));
}

// Evict least-recently-accessed entries until we're back under the cap.
function enforceLimit(): void {
  const keys = allCacheKeys();
  if (keys.length <= MAX_ENTRIES) return;
  const index = readIndex();
  const ordered = keys.sort((a, b) => (index[a] ?? 0) - (index[b] ?? 0));
  for (const k of ordered.slice(0, keys.length - MAX_ENTRIES)) {
    localStorage.removeItem(k);
    delete index[k];
  }
  writeIndex(index);
}

export interface CacheHit<T> {
  data: T;
  ageMs: number;
}

export function cacheGet<T>(key: string): CacheHit<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(keyFor(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    touch(keyFor(key));
    return { data: entry.data, ageMs: Date.now() - entry.storedAt };
  } catch {
    return null;
  }
}

export function cacheSet<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  const entry: CacheEntry<T> = {
    data,
    storedAt: Date.now(),
    lastAccess: Date.now(),
  };
  const serialized = JSON.stringify(entry);
  try {
    localStorage.setItem(keyFor(key), serialized);
  } catch (e) {
    if (
      e instanceof DOMException &&
      (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED")
    ) {
      // Free space and retry once — dropping the least-recently-used half,
      // not an alphabetical half.
      const keys = keysByAge();
      for (const k of keys.slice(0, Math.ceil(keys.length / 2))) {
        localStorage.removeItem(k);
      }
      try {
        localStorage.setItem(keyFor(key), serialized);
      } catch {
        return;
      }
    } else {
      return;
    }
  }
  touch(keyFor(key));
  try {
    enforceLimit();
  } catch {
    /* eviction is best-effort; a failure here shouldn't fail the write above */
  }
}

export function cacheRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(keyFor(key));
    const index = readIndex();
    if (keyFor(key) in index) {
      delete index[keyFor(key)];
      writeIndex(index);
    }
  } catch {
    /* no-op */
  }
}
