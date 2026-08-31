"use client";

import { useCallback } from "react";

/**
 * Roving-tabindex + arrow-key behaviour for a `role="radiogroup"`.
 *
 * Three groups in the app declared the full radiogroup ARIA contract —
 * `role="radiogroup"` / `role="radio"` / `aria-checked` — but implemented none
 * of the keyboard behaviour that contract promises: every radio was
 * independently tabbable, and arrow keys did nothing. A screen reader would
 * announce "radio button, 1 of 3", the user would press →, and nothing
 * happened. Declaring the role is a promise about how the widget behaves.
 *
 * Returns the props each radio needs. `tabIndex` is 0 only on the checked
 * option (or the first, when nothing is checked), so the group is a single
 * tab stop; arrows move selection and focus together, which is what a native
 * radio group does.
 */
export function useRovingRadioGroup<T extends string>(
  values: readonly T[],
  current: T,
  onSelect: (v: T) => void
) {
  return useCallback(
    (value: T) => {
      const index = values.indexOf(value);
      const checked = current === value;
      const isFallbackStop = !values.includes(current) && index === 0;
      return {
        role: "radio" as const,
        "aria-checked": checked,
        tabIndex: checked || isFallbackStop ? 0 : -1,
        onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
          const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
          const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
          if (!forward && !back) return;
          e.preventDefault();
          const next = values[(index + (forward ? 1 : -1) + values.length) % values.length];
          onSelect(next);
          // Move focus to the option that just became checked, so the roving
          // tab stop and the focus ring stay on the same element.
          const group = (e.currentTarget as HTMLElement).closest('[role="radiogroup"]');
          const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]');
          radios?.[values.indexOf(next)]?.focus();
        },
      };
    },
    [values, current, onSelect]
  );
}
