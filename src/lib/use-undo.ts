"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A short-lived undo offer for destructive actions.
 *
 * The app's confirmation budget was inverted: re-running an analysis
 * (recoverable, merely expensive) got a full modal, while deleting a piece of
 * fieldwork evidence committed instantly. Confirm-then-gone is also the wrong
 * shape for a frequent action — it adds friction every time to protect against
 * the rare mistake. Making the action reversible costs nothing on the happy
 * path and still catches the mistake.
 *
 * The restore closure captures whatever snapshot the caller needs; this hook
 * only owns the window and the offer. Ten seconds is long enough to notice a
 * wrong tap and short enough that a stale offer never restores over newer work.
 */
export interface UndoOffer {
  label: string;
  restore: () => void;
}

const UNDO_WINDOW_MS = 10_000;

export function useUndo() {
  const [offer, setOffer] = useState<UndoOffer | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setOffer(null);
  }, []);

  const offerUndo = useCallback((label: string, restore: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setOffer({ label, restore });
    timerRef.current = setTimeout(() => setOffer(null), UNDO_WINDOW_MS);
  }, []);

  const undo = useCallback(() => {
    if (!offer) return;
    offer.restore();
    clear();
  }, [offer, clear]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { offer, offerUndo, undo, clear };
}
