---
target: the rollup page
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 2
timestamp: 2026-08-11T22-29-14Z
slug: src-app-rollup-page-tsx
---
Method: dual-agent (A: a9d0290674695b063 · B: a24873e89ff360afc)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good progress feedback during generate ("Analyzing 3/18…"); no indicator that a saved rollup is stale relative to the day's current conversations |
| 2 | Match System / Real World | 2 | Plain-language section names fit the field-journal metaphor, but colorful Unicode emoji headings (🌅⏳⚠️👥📅🧠🗑) clash with the notebook register the rest of the app maintains |
| 3 | User Control and Freedom | 1 | "Regenerate rollup" is one click, no confirmation, overwrites the day's stored rollup with no history, and (per the aging model) silently breaks the chain to the next day if not re-run |
| 4 | Consistency and Standards | 2 | Internally consistent with `.card`/`.analysis-section`/44px conventions, but the rollup output's emoji icon language breaks from `AdhdResults.tsx`'s monochrome-SVG pattern one file away |
| 5 | Error Prevention | 2 | Per-conversation failures degrade gracefully; the one destructive action (regenerate) has zero guardrail |
| 6 | Recognition Rather Than Recall | 3 | Day list surfaces counts + a "rollup saved" badge; an 18-conversation day offers no scannable sub-structure to recognize by |
| 7 | Flexibility and Efficiency | 1 | No date jump/filter/search on a list that grows daily forever; no sticky CTA on long days — efficiency drops exactly when volume is highest |
| 8 | Aesthetic and Minimalist Design | 2 | Mostly quiet and muted; the emoji headings are the one place the page visually shouts against its own palette |
| 9 | Error Recovery | 3 | Error banner has icon + text + dismiss; skipped-conversation count is explicit and actionable |
| 10 | Help and Documentation | 2 | Subtitle explains the aging mechanism, but nothing explains what "Regenerate" discards |
| **Total** | | **21/40** | **Acceptable** |

## Design Specificity Verdict

**LLM assessment (Assessment A):** About 70% authored for this product, 30% generic list→detail→generate admin panel wearing the app's tokens. The day-list/day-detail flow and its failure-handling copy ("3 of 18 could not be analyzed and were skipped") genuinely enact PRODUCT.md's "nothing vanishes silently" principle. But the moment the page has to originate new visual language — the seven-section rollup output — it defaults to off-the-shelf checklist-app vocabulary (colorful emoji section markers) instead of extending the app's own monochrome icon system, and to a raw string dump instead of the structured, empty-state-aware rendering its sibling `AdhdResults.tsx` already built one file away.

**Deterministic scan:** CLI static scan (`detect.mjs --json src/app/rollup/page.tsx`) returned a clean `[]`, exit 0 — no source-level anti-patterns. The live browser overlay (detect.js injected into the running production page) found exactly one anti-pattern: `line-length ~105 chars/line (aim for <80)` on the header subtitle ("Pick a day to merge its conversations into one plan for tomorrow..."). This is a real but low-stakes finding — a single descriptive sentence, not a block of reading copy — so it's folded into Minor Observations below rather than treated as a priority issue. No false positives; the CLI/live discrepancy is simply two different measurements (source line length vs. rendered text width), not a tool error.

**Visual overlays:** Injection succeeded and the detector genuinely ran in the live page (console output + an on-page "line length too long" badge were both captured), satisfying the bar for a real, non-fabricated overlay. That said, the overlay lived in a temporary background tab used for evidence-gathering and the local helper server has since been stopped, so it is not something you can still click open right now — treat the finding above as the record of it, not a standing visual.

## Overall Impression

The day-list → day-detail → generate skeleton is solid and correctly obeys the app's own design system (single column, 44px targets, muted palette, honest failure copy). But the page's one truly custom piece of UI — the seven-section rollup output, the actual payoff of "Daily Rollup" — is the least-developed part of the whole ADHD Aid layer, both visually (emoji instead of the app's icon system) and structurally (a raw string dump with no empty-state handling, next to a sibling component that already solved both problems). The single biggest opportunity: bring the rollup output view up to the standard `AdhdResults.tsx` already set, and put a real guardrail on "Regenerate," which is currently the one silently destructive action in an app whose entire ADHD-Aid premise is that nothing goes silently missing.

## What's Working

- **Failure-handling copy** ("3 of 18 could not be analyzed and were skipped") directly enacts Product Principle 3 in neutral, non-scolding language — the page's best moment.
- **Day-detail conversation rows** correctly combine `truncate min-w-0` with `flex-shrink-0` badges for safe text handling on narrow screens, live-verified at 390px with no overflow.
- **Generate-flow progress feedback** ("Analyzing 3/18…" + spinner) turns a multi-second, multi-step, paid operation into something legible instead of a blank spinner.

## Priority Issues

**[P0] "Regenerate rollup" is a destructive, chain-breaking action styled as a routine one.**
Why it matters: Per `src/lib/rollup.ts`'s aging model and `saveRollup`'s overwrite-in-place storage, regenerating replaces the day's saved rollup outright with no version history, and silently breaks the aging chain to the next day unless that day is also re-run — on the one app in this person's life explicitly built around "nothing important vanishes silently."
Fix: Add an inline warning or lightweight confirm near the button ("Regenerating replaces today's saved rollup — you'll need to regenerate tomorrow's rollup too to pick up the change"), or persist rollup history so a regenerate is recoverable.
Suggested command: `$impeccable harden`

**[P1] The seven-section rollup output is under-built relative to its own sibling component.**
Why it matters: `ROLLUP_SECTIONS` (page.tsx ~288-297) renders emoji headings — breaking the One Ink Rule and the app's monochrome-icon convention — and dumps each section as a raw `whitespace-pre-wrap` string with no empty-state treatment. A model-returned `"None."` renders identically to substantive content, unlike `AdhdResults.tsx`'s dedicated `Empty()` component one file away.
Fix: Reuse the `Block`/`Empty` pattern already built for per-conversation ADHD results — monochrome icon + `--accent-light` heading + explicit empty state — for rollup sections too.
Suggested command: `$impeccable polish`

**[P1] No chunking or grouping for high-volume days, contradicting the product's explicit low-cognitive-load requirement.**
Why it matters: Live-verified on an actual 18-conversation day: one flat list, identical "not yet" pills throughout, no time-of-day grouping, no collapse/expand, and no sticky CTA — the page gets harder to use exactly on the day it's needed most, which directly violates PRODUCT.md's Accessibility & Inclusion section for this exact surface.
Fix: Group by time-of-day with quiet sub-headers, or cap the initial view ("first 6 of 18 — show all") with progressive disclosure.
Suggested command: `$impeccable distill`

**[P2] The day-list row strips its own interactive semantics for assistive tech.**
Why it matters: `<button role="listitem" ...>` (page.tsx ~204-209) overrides the native button role. Live-verified via the accessibility tree: the element reports as `listitem`, not `button`, so a screen-reader user gets no cue the row is actionable.
Fix: Drop `role="listitem"` from the button; if list semantics are wanted, wrap the button in an actual `<li>` instead.
Suggested command: `$impeccable audit`

**[P3] `bg-purple-900/40` (Send to Obsidian) and `bg-amber-900/40` (Download .md) both violate the color system.**
Why it matters: Purple appears nowhere in DESIGN.md; amber is explicitly reserved for the custom-analysis lens only (see The One Ink Rule and the amber usage rule). This is inherited, app-wide debt — also present on `conversation/[id]/page.tsx` and `analyze-group/page.tsx` — rather than a rollup-specific regression, but it's fully visible on this page's highest-stakes view.
Fix: Move both export buttons to the established secondary-button pattern (Ink Panel background) with an icon distinguishing the two actions, rather than a bespoke hue each.
Suggested command: `$impeccable typeset`

## Persona Red Flags

**Riley (stress tester / heavy-day power user):** On the live 18-conversation day, "Generate rollup" is only reachable after scrolling past all 18 rows — no sticky CTA. The page gets *harder* to operate exactly on the day it's needed most.

**Casey (mobile, one-handed):** Same problem, felt more acutely — each row consumes more relative vertical space on a 375px screen, so the scroll-to-CTA distance is worse one-handed than on desktop.

**Sam (accessibility):** The `role="listitem"` issue strips the day-row's button semantics from screen readers. Separately, emoji-prefixed `h3` headings on the rollup output will have a screen reader announce the emoji's Unicode name before the heading text ("sunrise, tomorrow's plan") — added auditory noise on exactly the surface meant to minimize cognitive load.

**Project-specific — the ADHD-affected sole user, closing out their day under PRODUCT.md's explicit low-cognitive-load requirement:** The live day inspected mixed routine conversations with a small cluster of emotionally weighted, pastoral/grief-related ones, all rendered as visually identical rows. There is no way to mentally triage or chunk before generating, and the one genuinely irreversible action on the page (regenerate discarding the chain) offers zero reassurance — exactly the two things this specific persona most needs (chunking, and trust that nothing is silently lost) are this page's two weakest points.

## Minor Observations

- `formatDateTime`'s spelled-out format ("Tuesday, 11 August 2026") is used consistently and reads well.
- The "rollup saved" badge correctly uses Verified Green paired with explicit text, per DESIGN.md's rule against color-alone meaning.
- Live detector flagged the header subtitle at ~105 chars/line (aim <80) at desktop width — real but low-stakes; a shorter line-wrap or a `max-w` constraint on that one paragraph would resolve it.
- The day-list row's heading/badge pair (page.tsx ~211-217) lacks the `min-w-0`/`flex-shrink-0` guard that the day-detail rows just below it use correctly — no live overflow was observed (no long-weekday-name day with a saved-rollup badge was available to test), but given this exact app's recent history fixing an overflow bug on a sibling page's header, it's worth a defensive pass.
- No back-to-top affordance after a seven-section rollup renders below the fold.
- Empty state ("No conversations to roll up yet.") correctly reuses the card pattern.

## Questions to Consider

- The rollup is meant to be a compact "front page" for tomorrow — why does its UI currently treat all seven sections with the same scroll-and-read weight as a full per-conversation deep analysis?
- Regenerating silently breaks the aging chain to the next day — should the one genuinely destructive action on this page really look identical to every safe, idempotent one?
- The live day list already spans 1–18 conversations after a few months of daily use — at what point does this "quiet field journal" start to look like the "busy analytics dashboard" DESIGN.md explicitly says it must never become?
