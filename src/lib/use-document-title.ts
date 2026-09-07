"use client";

import { useEffect } from "react";

/* Own the tab title from a client component, on a route whose <title> Next's
   metadata system also owns.

   Simpler versions lost before this one, and the reasons are worth keeping:
     1. `document.title = x` in an effect — Next reapplied the route's static
        title after mount and the tab flipped back.
     2. Rendering a <title> element (React 19 hoists it into <head>) — produced
        THREE <title> elements, Next's either side of ours; the browser honours
        the first, so nothing changed.
     3. The same assignment deferred to requestAnimationFrame — Next's write
        still landed after ours.
     4. Watching <head> and re-asserting, but writing through the
        `document.title` setter and restoring the old value on unmount. That
        won the race — and then blanked the tab on Back. On a client-side
        navigation the effect runs in the gap after Next has removed the old
        route's <title> and before it has inserted the new one, so
        `document.title` reads "" (no element), the setter *creates* a second
        <title>, and "restoring" on unmount wrote "" into it — first in <head>,
        so that is what the tab showed.

   So: write into the <title> element Next owns, never create one, and never
   restore. If the element isn't there yet, the observer calls us back when
   Next inserts it. When the route changes, Next removes its element and
   mounts a fresh one for the next route with the right text, which is exactly
   the "restore" we were trying to do by hand. The guard counter means a
   genuine fight (a future Next that re-writes on every change) degrades to
   "gives up after a handful of tries" rather than a hot loop; in practice
   Next writes once and we win on the second write. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    let rewrites = 0;
    const MAX_REWRITES = 8;

    const apply = () => {
      const el = document.head.querySelector("title");
      if (!el || el.textContent === title) return;
      if (rewrites++ >= MAX_REWRITES) {
        observer.disconnect();
        return;
      }
      el.textContent = title;
    };

    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    apply();

    return () => observer.disconnect();
  }, [title]);
}
