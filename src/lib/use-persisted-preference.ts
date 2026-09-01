"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A small UI preference that survives reloads.
 *
 * Deliberately NOT for tracked data — this writes to its own localStorage key
 * and is never mirrored to the server, because a view toggle is a per-device
 * habit rather than something the two devices should fight over.
 *
 * The read happens in an effect, never in the initializer. Reading
 * localStorage during the first render makes the client's tree disagree with
 * the server's, which React reports as a hydration failure and recovers from
 * by discarding the server tree — a bug this codebase has already shipped
 * twice. Encoding the pattern once is the point of this hook: the first render
 * always matches the server's default, and the stored value arrives after
 * mount.
 *
 * `isValid` guards against a stale or hand-edited value silently putting the
 * UI into a state it no longer has a control for.
 */
export function usePersistedPreference<T extends string>(
  key: string,
  fallback: T,
  isValid: (v: string) => v is T
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate: the first client render must match the server's, so the stored value can only be applied after mount
      if (stored && isValid(stored)) setValue(stored);
    } catch {
      // Private mode, disabled storage, quota — the fallback is already correct.
    }
  }, [key, isValid]);

  const set = useCallback((next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next);
    } catch {
      // Losing the preference is acceptable; losing the interaction is not.
    }
  }, [key]);

  return [value, set];
}
