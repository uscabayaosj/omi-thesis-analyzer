"use client";

/**
 * Global keyboard shortcuts.
 *
 * The sole user opens this app many times a day and knows it cold, but there
 * was no way to do anything without a pointer — no jump to a section, no focus
 * of the search box, no route switch. These are the accelerators for that:
 * invisible to a first-time reader, and the difference between a two-second and
 * a six-tap trip for everyone else.
 *
 * `g`-prefixed pairs follow the convention set by Gmail and GitHub, so the
 * muscle memory transfers rather than having to be learned from scratch.
 */
export interface Shortcut {
  keys: string;
  label: string;
  /** Route to navigate to, for the plain navigation shortcuts. */
  href?: string;
}

export const SHORTCUTS: Shortcut[] = [
  { keys: "g h", label: "Go to conversations", href: "/" },
  { keys: "g r", label: "Go to daily rollup", href: "/rollup" },
  { keys: "g w", label: "Go to weekly rollup", href: "/rollup/week" },
  { keys: "g c", label: "Go to open promises", href: "/commitments" },
  { keys: "g p", label: "Go to people", href: "/people" },
  { keys: "g s", label: "Go to search analyses", href: "/search" },
  { keys: "g u", label: "Go to usage", href: "/usage" },
  { keys: "/", label: "Focus the search box on this page" },
  { keys: "?", label: "Show this shortcut list" },
  { keys: "Esc", label: "Close a dialog, or clear the search box" },
];

/** True when the event target is somewhere typing should win over shortcuts. */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable
  );
}
