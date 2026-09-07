"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PILL_REFINE_ON, PILL_REFINE_OFF } from "@/lib/ui";

/**
 * A jump strip for long analysis pages.
 *
 * With both lenses run, a conversation renders eighteen same-sized cards over
 * roughly eight phone screens, and the only way to reach the last one was to
 * scroll past the other seventeen. This gives the stack a table of contents and
 * tracks where you are in it — the "Contents" device the hub already uses,
 * applied to the one page that most needed it.
 */
export interface NavSection {
  id: string;
  label: string;
}

/* Not a palette colour: a mask reads only the alpha channel, so `#000` here
   means "fully opaque" and never paints a pixel. Waived rather than moved into
   DESIGN.md, which would imply the app had gained a pure-black ink. */
const FADE_RIGHT = "linear-gradient(to right, #000 calc(100% - 2rem), transparent)"; // impeccable-disable-line design-system-color

export function sectionId(label: string): string {
  return `s-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export default function SectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState<string | null>(null);
  /* With both lenses run this strip holds nine chips, of which about five fit
     on a phone. Nothing said the other four existed: no fade, no shadow, no
     count — the row simply ended at the viewport edge and read as complete.
     `more` fades the trailing edge whenever there is still content past it,
     and clears once you reach the end so the last chip isn't permanently
     dimmed. */
  const listRef = useRef<HTMLUListElement | null>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (sections.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setActive(visible.target.id);
      },
      // Bias the band toward the top of the viewport so the highlighted entry
      // is the section you are reading, not the one just scrolling into view.
      { rootMargin: "-72px 0px -60% 0px", threshold: 0 }
    );
    for (const s of sections) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, [sections]);

  const syncMore = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    // 1px of slack: sub-pixel widths otherwise leave the fade on forever.
    setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    syncMore();
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(syncMore);
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncMore, sections]);

  if (sections.length < 3) return null;

  return (
    <nav
      aria-label="Jump to section"
      className="sticky top-0 z-20 -mx-4 px-4 py-2 mb-4 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)]"
    >
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">Contents</p>
      <ul
        ref={listRef}
        onScroll={syncMore}
        className="flex gap-1 overflow-x-auto pb-1 -mb-1"
        style={
          more
            ? {
                // WebKit prefix included for older iOS Safari, which is a real
                // target here — this app is installed as a PWA on a phone.
                maskImage: FADE_RIGHT,
                WebkitMaskImage: FADE_RIGHT,
              }
            : undefined
        }
      >
        {sections.map((s) => {
          const isActive = active === s.id;
          return (
            <li key={s.id} className="flex-shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={isActive ? "location" : undefined}
                // REFINE pill (see lib/ui.ts) — a jump within the page, not a
                // change of what the page is.
                className={`inline-flex items-center px-3 py-1.5 min-h-[44px] rounded-full text-xs whitespace-nowrap transition-colors ${
                  isActive ? PILL_REFINE_ON : PILL_REFINE_OFF
                }`}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
