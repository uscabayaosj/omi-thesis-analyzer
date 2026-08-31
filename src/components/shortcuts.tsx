"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SHORTCUTS, isTypingTarget } from "@/lib/shortcuts";

/**
 * Mounted once in the root layout.
 *
 * Two rules keep this from fighting the app: it never fires while the user is
 * typing (except Escape, which is how you get out of a field), and it never
 * swallows a browser or OS combination — anything with Meta/Ctrl/Alt is left
 * alone. The `g` prefix is a 1.2s window rather than a mode, so an abandoned
 * `g` costs nothing and never leaves the keyboard in a strange state.
 */
export default function GlobalShortcuts() {
  const router = useRouter();
  const [pendingG, setPendingG] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const focusSearch = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>(
      'input[type="search"], input[data-shortcut-search], input[type="text"][placeholder*="earch"]'
    );
    if (el) {
      el.focus();
      el.select?.();
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    if (!pendingG) return;
    const t = setTimeout(() => setPendingG(false), 1200);
    return () => clearTimeout(t);
  }, [pendingG]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === "Escape") {
        if (showHelp) {
          e.preventDefault();
          setShowHelp(false);
          return;
        }
        // Blur a field so the next keystroke reaches the shortcuts again.
        if (isTypingTarget(e.target)) (e.target as HTMLElement).blur();
        return;
      }

      if (isTypingTarget(e.target)) return;

      if (pendingG) {
        const match = SHORTCUTS.find((s) => s.keys === `g ${e.key.toLowerCase()}`);
        setPendingG(false);
        if (match?.href) {
          e.preventDefault();
          router.push(match.href);
        }
        return;
      }

      if (e.key === "g") {
        setPendingG(true);
        return;
      }
      if (e.key === "/") {
        if (focusSearch()) e.preventDefault();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pendingG, showHelp, router, focusSearch]);

  if (!showHelp) {
    return pendingG ? (
      <div
        className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 card px-3 py-2 font-mono text-xs text-slate-300"
        role="status"
      >
        g … <span className="text-slate-400">(h r w c p s u)</span>
      </div>
    ) : null;
  }

  return (
    <div
      className="overlay-backdrop fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) setShowHelp(false);
      }}
    >
      <div
        className="overlay-panel card max-w-md w-full p-6"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
      >
        <h2 className="mb-3">Keyboard shortcuts</h2>
        <ul className="space-y-1.5">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-baseline gap-3 text-sm">
              <kbd className="font-mono text-xs bg-slate-800 border border-slate-700 rounded px-1.5 py-0.5 flex-shrink-0 min-w-[3.5rem] text-center">
                {s.keys}
              </kbd>
              <span className="text-slate-300">{s.label}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={() => setShowHelp(false)}
          autoFocus
          className="mt-5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm px-4 py-2 min-h-[44px] rounded-lg transition-colors w-full"
        >
          Close
        </button>
      </div>
    </div>
  );
}
