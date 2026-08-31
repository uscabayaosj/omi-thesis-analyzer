"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import UndoBar from "@/components/UndoBar";

/**
 * App-level undo, so an offer survives navigation.
 *
 * The first version was component-scoped: navigating away inside the ten-second
 * window unmounted the bar and took the restore closure with it, silently. For
 * an app whose third principle is that nothing tracked ever vanishes without
 * being surfaced, an undo that disappears when you look away is the wrong
 * shape. Hoisting it to the layout keeps one offer alive across routes and
 * renders it in one fixed place.
 *
 * A second destructive action inside the window replaces the first offer — but
 * the replaced one is announced as it goes rather than dropped in silence.
 */
interface UndoContextValue {
  offerUndo: (label: string, restore: () => void) => void;
}

const UndoContext = createContext<UndoContextValue | null>(null);

const UNDO_WINDOW_MS = 10_000;

export function useUndoOffer(): UndoContextValue {
  const ctx = useContext(UndoContext);
  // A no-op rather than a throw: a component rendered outside the provider
  // should lose its undo affordance, never crash the route.
  return ctx ?? { offerUndo: () => {} };
}

export default function UndoProvider({ children }: { children: React.ReactNode }) {
  const [offer, setOffer] = useState<{ label: string; restore: () => void } | null>(null);
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

  return (
    <UndoContext.Provider value={{ offerUndo }}>
      {children}
      {offer && (
        <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
          <div className="mx-auto max-w-3xl pointer-events-auto">
            <UndoBar label={offer.label} onUndo={undo} onDismiss={clear} />
          </div>
        </div>
      )}
    </UndoContext.Provider>
  );
}
