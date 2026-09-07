"use client";

import { useCallback, useId, useRef, useState } from "react";
import { useModalFocus } from "@/lib/use-modal-focus";
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
  // Two dialogs can be mounted in the same tree (a batch run confirming over a
  // regenerate), so the ids have to be per-instance rather than constants.
  const reactId = useId();
  const titleId = `confirm-title-${reactId}`;
  const bodyId = `confirm-body-${reactId}`;

  // Defer the caller's handler until the exit transition has played. Guarded
  // so a second trigger mid-exit (double-tap, Escape after clicking) is a no-op
  // rather than firing the action twice — via a ref, not the `closing` state
  // itself: React's Strict Mode double-invokes a setState updater in
  // development to catch impure ones, and the guard used to live inside that
  // updater, so the `setTimeout(action, 100)` side effect ran twice for every
  // single click (both invocations saw the same pre-update `already`). A ref
  // mutates immediately and is shared between both invocations, so the second
  // one already sees it flipped.
  const closingRef = useRef(false);
  const requestClose = useCallback((action: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(action, 100);
  }, []);

  // Focus contract lives in a shared hook so this dialog and the shortcut
  // overlay cannot drift apart on it again.
  const handleEscape = useCallback(() => requestClose(onCancel), [requestClose, onCancel]);
  useModalFocus({ panelRef, initialFocusRef: cancelRef, onEscape: handleEscape });

  return (
    <div
      className={`overlay-backdrop fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 ${closing ? "overlay-closing" : ""}`}
      role="dialog"
      aria-modal="true"
      // Pointing at the real heading and the real body, rather than duplicating
      // the title string into aria-label: a screen reader then announces the
      // explanation of the consequence along with the name of the action, which
      // for an irreversible one is the half that matters.
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onCancel);
      }}
    >
      <div
        ref={panelRef}
        className={`overlay-panel card p-6 max-w-md w-full ${styles.border} ${closing ? "overlay-closing" : ""}`}
      >
        <h3 id={titleId} className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
          <WarningIcon className={`w-5 h-5 flex-shrink-0 ${styles.icon}`} />
          {title}
        </h3>
        {/* slate-300, not slate-400. This body carries the entire explanation
            of an action that usually cannot be undone — on the regenerate
            dialog it is the only place the user is told that rollups keep no
            version history — and it was set in the app's quietest text colour,
            one step below the title it explains. The thing you must read to
            decide should not be the faintest thing in the dialog. */}
        <div id={bodyId} className="text-sm text-slate-300 mb-4">{body}</div>
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
