"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WarningIcon } from "@/components/icons";

/** Accent for the warning icon and panel border. "danger" is for actions that
 *  destroy work with no way back (a rollup has no version history); "caution"
 *  is for replacements that keep a copy. */
type Tone = "caution" | "danger";

const TONE: Record<Tone, { border: string; icon: string; confirm: string }> = {
  caution: {
    // Amber is reserved for the custom-analysis lens under the design system's
    // own rule, and an amber-filled confirm made this the app's second-most
    // prominent primary-looking button in a colour that is not the primary.
    // The caution tone keeps an amber *icon* (a marginal warning mark) but its
    // confirm button is the copper primary like every other primary action.
    border: "border-amber-500/30",
    icon: "text-amber-400",
    // slate-950 on cyan-400 (copper #d99a5e) measures 7.87:1.
    confirm: "bg-cyan-400 hover:bg-cyan-300 text-slate-950", // impeccable-disable-line gray-on-color
  },
  danger: {
    border: "border-red-500/30",
    icon: "text-red-400",
    // red-600 (#b04a2e) with lamp-paper text is 4.83:1. The old hover stepped
    // up to red-500, which dropped the pair to 3.55:1 — a destructive button
    // that failed AA precisely while the pointer was on it. Hover now darkens
    // instead of lightening, so the contrast improves under the cursor.
    confirm: "bg-red-600 hover:bg-red-700 text-white",
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
  const panelRef = useRef<HTMLDivElement>(null);
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
    // Remember what had focus so it can be handed back on close: cancelling
    // from deep in a list otherwise dumped the user at document start.
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose(onCancel);
        return;
      }
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      // Only if focus is still inside the dialog (or lost to <body>) — never
      // steal it back from something the confirmed action itself focused.
      const active = document.activeElement;
      if (!active || active === document.body || panelRef.current?.contains(active)) {
        opener?.focus?.();
      }
    };
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
      <div
        ref={panelRef}
        className={`overlay-panel card p-6 max-w-md w-full ${styles.border} ${closing ? "overlay-closing" : ""}`}
      >
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
