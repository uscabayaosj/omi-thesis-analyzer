"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WarningIcon } from "@/components/icons";

/** Accent for the warning icon and panel border. "danger" is for actions that
 *  destroy work with no way back (a rollup has no version history); "caution"
 *  is for replacements that keep a copy. */
type Tone = "caution" | "danger";

const TONE: Record<Tone, { border: string; icon: string; confirm: string }> = {
  caution: {
    border: "border-amber-500/30",
    icon: "text-amber-400",
    // slate-950 on amber-500 measures 9.7:1; white would be 2.4:1 and fail AA.
    confirm: "bg-amber-500 hover:bg-amber-400 text-slate-950", // impeccable-disable-line gray-on-color
  },
  danger: {
    border: "border-red-500/30",
    icon: "text-red-400",
    confirm: "bg-red-600 hover:bg-red-500 text-white",
  },
};

/**
 * The app's single confirmation dialog. Three near-identical copies of this
 * existed (thesis re-run, rollup regenerate, and the batch/group runs added
 * later); they drifted in focus handling and exit animation, which is exactly
 * the inconsistency a shared component prevents.
 *
 * Behaviour contract: focus lands on Cancel (never on the destructive action),
 * Escape and backdrop-click both cancel, and closing plays a fast exit before
 * unmount so the dialog leaves the way it arrived.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "caution",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: Tone;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [closing, setClosing] = useState(false);
  const styles = TONE[tone];

  // Defer the caller's handler until the exit transition has played. Guarded
  // so a second trigger mid-exit (double-tap, Escape after clicking) is a no-op
  // rather than firing the action twice.
  const requestClose = useCallback((action: () => void) => {
    setClosing((already) => {
      if (already) return already;
      setTimeout(action, 100);
      return true;
    });
  }, []);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") requestClose(onCancel);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, requestClose]);

  return (
    <div
      className={`overlay-backdrop fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 ${closing ? "overlay-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onCancel);
      }}
    >
      <div className={`overlay-panel card p-6 max-w-md w-full ${styles.border} ${closing ? "overlay-closing" : ""}`}>
        <h3 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <WarningIcon className={`w-5 h-5 flex-shrink-0 ${styles.icon}`} />
          {title}
        </h3>
        <div className="text-sm text-slate-400 mb-4">{body}</div>
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelRef}
            onClick={() => requestClose(onCancel)}
            className="px-4 py-2 min-h-[44px] text-sm text-slate-300 hover:text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => requestClose(onConfirm)}
            className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-lg transition-colors ${styles.confirm}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
