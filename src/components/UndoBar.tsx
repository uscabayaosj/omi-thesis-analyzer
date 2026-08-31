"use client";

import { UndoIcon } from "@/components/icons";

/**
 * The visible half of `useUndo`. Announced politely rather than assertively:
 * an undo offer is worth mentioning, never worth interrupting a screen reader
 * mid-sentence — the destructive action itself already succeeded.
 */
export default function UndoBar({
  label, onUndo, onDismiss,
}: {
  label: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="enter-rise card p-3 mb-4 flex flex-wrap items-center justify-between gap-3 border-cyan-500/30"
    >
      <p className="text-sm text-slate-200 min-w-0 basis-48 flex-1">{label}</p>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onUndo}
          className="bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5"
        >
          <UndoIcon className="w-4 h-4" />
          Undo
        </button>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-slate-400 hover:text-white text-sm px-3 py-2 min-h-[44px] rounded-lg transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
