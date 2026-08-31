"use client";

import { useEffect, useState } from "react";

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

export function sectionId(label: string): string {
  return `s-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export default function SectionNav({ sections }: { sections: NavSection[] }) {
  const [active, setActive] = useState<string | null>(null);

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

  if (sections.length < 3) return null;

  return (
    <nav
      aria-label="Jump to section"
      className="sticky top-0 z-20 -mx-4 px-4 py-2 mb-4 bg-[var(--background)]/95 backdrop-blur-sm border-b border-[var(--border)]"
    >
      <p className="mb-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-slate-400">Contents</p>
      <ul className="flex gap-1 overflow-x-auto pb-1 -mb-1">
        {sections.map((s) => {
          const isActive = active === s.id;
          return (
            <li key={s.id} className="flex-shrink-0">
              <a
                href={`#${s.id}`}
                aria-current={isActive ? "location" : undefined}
                className={`inline-flex items-center px-3 py-1.5 min-h-[44px] rounded-full text-xs whitespace-nowrap transition-colors ${
                  isActive
                    ? "border border-cyan-500/50 bg-cyan-950/40 text-cyan-200"
                    : "bg-slate-800 text-slate-300 hover:text-white"
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
