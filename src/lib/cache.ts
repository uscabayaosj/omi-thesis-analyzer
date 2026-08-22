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

function keyFor(key: string): string {
  return PREFIX + key;
}

function allCacheKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

// Evict least-recently-accessed entries until we're back under the cap.
function enforceLimit(): void {
  const keys = allCacheKeys();
  if (keys.length <= MAX_ENTRIES) return;

  const entries = keys
    .map((k) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(k) || "{}") as CacheEntry<unknown>;
        return { k, lastAccess: parsed.lastAccess ?? 0 };
      } catch {
        return { k, lastAccess: 0 };
      }
    })
    .sort((a, b) => a.lastAccess - b.lastAccess);

  for (const { k } of entries.slice(0, keys.length - MAX_ENTRIES)) {
    localStorage.removeItem(k);
  }
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
    // Touch lastAccess so LRU reflects real usage.
    entry.lastAccess = Date.now();
    try {
      localStorage.setItem(keyFor(key), JSON.stringify(entry));
    } catch {
      /* touch is best-effort */
    }
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
      // Free space and retry once.
      const keys = allCacheKeys().sort();
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
  } catch {
    /* no-op */
  }
}
