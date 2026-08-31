"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The focus contract every `aria-modal` dialog owes its user.
 *
 * `ConfirmDialog` implemented all of this correctly and the `?` shortcut
 * overlay implemented none of it, while declaring the same
 * `role="dialog" aria-modal="true"` — so Tab walked straight out of it into
 * the page behind. Two dialogs with the same ARIA promise and different
 * behaviour is the inconsistency; this is the shared implementation.
 *
 * - Focus moves into the panel on open (`initialFocusRef`, else the panel).
 * - Tab and Shift+Tab cycle within the panel rather than escaping it.
 * - Escape closes.
 * - On close, focus returns to whatever opened the dialog — but only if focus
 *   is still inside the panel or was lost to `<body>`, so an action that
 *   deliberately focused something else is never overridden.
 */
export function useModalFocus({
  panelRef,
  initialFocusRef,
  onEscape,
  enabled = true,
}: {
  panelRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
  enabled?: boolean;
}) {
  useEffect(() => {
    if (!enabled) return;
    const opener = document.activeElement as HTMLElement | null;
    // Captured now: reading the ref in cleanup would consult a node that has
    // almost certainly changed by the time the dialog unmounts.
    const panelAtMount = panelRef.current;

    (initialFocusRef?.current ?? panelRef.current)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute("disabled"));
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
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const active = document.activeElement;
      if (!active || active === document.body || panelAtMount?.contains(active)) {
        opener?.focus?.();
      }
    };
  }, [panelRef, initialFocusRef, onEscape, enabled]);
}
