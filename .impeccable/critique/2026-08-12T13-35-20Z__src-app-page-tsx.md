---
target: the calendar/search feature
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 1
timestamp: 2026-08-12T13-35-20Z
slug: src-app-page-tsx
---
Method: dual-agent (A: a2a236564d1450d78 · B: ae1bf1746dce47e6a)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Sync status, search-result count, and calendar dots communicate state well; nothing distinguishes client-side-instant search from a network call, though none is needed here |
| 2 | Match System / Real World | 3 | Warm, plain-language empty states match the journal voice; Monday-first week is a small first-glance mismatch for a US-trained eye, consistent with the app's existing en-GB convention elsewhere |
| 3 | User Control and Freedom | 4 | Clear-search, Cancel selection, Deselect All, and Today-jump are all present and easy to find |
| 4 | Consistency and Standards | 3 | Calendar correctly reuses the filter-pills' fill-select pattern; the "(across all days)" selection copy is internally inconsistent with its own literal meaning (see P1) |
| 5 | Error Prevention | 4 | Group Thesis disabled under 2 selections, Run ADHD under 1; no destructive actions on this surface |
| 6 | Recognition Rather Than Recall | 4 | Entry dots and lens badges let the user recognize state at a glance instead of recalling or hunting |
| 7 | Flexibility and Efficiency | 2 | No way to jump to a distant month except repeated chevron clicks — reintroduces the exact tedium (scrolling through a growing archive) the feature was built to remove, just in a different shape |
| 8 | Aesthetic and Minimalist Design | 2 | The calendar card carries identical visual weight to content cards below it; nothing marks it as secondary navigation chrome vs. primary content |
| 9 | Error Recovery | 4 | Empty-day and no-search-results states both explain plainly and offer a next step |
| 10 | Help and Documentation | 2 | No on-screen legend for what the small dot means; the app already has a convention for this (the "What is Pioneer Sovereignty?" disclosure) and didn't reuse it here |
| **Total** | | **31/40** | **Good** |

## Design Specificity Verdict

**LLM assessment (Assessment A):** The calendar's color and state vocabulary is genuinely authored for this product — it reuses the filter-pills' exact fill-selection pattern rather than inventing a new one, keeps today's ring and the entry-dot inside the existing indigo/graphite pair, and made a documented, deliberate call to leave future dates clickable-but-dimmed rather than disabled. That discipline matches DESIGN.md's own description of the component almost verbatim. But the interaction *shape* is generic-date-picker default: a full 6-row month grid, always fully expanded, even though the feature's own stated default ("defaults to today") means the grid is mostly unnecessary on the majority of visits. A more product-specific solution would have shaped the widget around that fact rather than rendering the entire grid unconditionally — the same thing a dropped-in date-picker component would also do. Verdict: authored skin, off-the-shelf skeleton.

**Deterministic scan:** Static CLI scan of `src/app/page.tsx`, `src/components/icons.tsx`, and `src/lib/format.ts` returned clean (`[]`, exit 0). The live-DOM scan found 18 findings on first load, narrowing to 6-8 depending on state — but I verified the two most concerning categories directly before trusting them, and both are false positives / non-issues, not real feature bugs:
- **`text-occlusion` (4 findings, the alarming-looking ones):** every one references text belonging to the closed-by-default "What is Pioneer Sovereignty?" disclosure. I confirmed directly via `checkVisibility()` (returns `false`) and `document.elementFromPoint()` at the reported coordinates (returns unrelated real content — e.g. the calendar's own "August 2026" label) that this text is not actually visible or competing for screen space. The detector measures raw `getBoundingClientRect()` + basic `display`/`visibility` properties, which don't fully capture how this browser environment collapses closed `<details>` content — a detector limitation, not an app bug.
- **`overused-font: roboto 100%`:** confirmed via `getComputedStyle` that the computed stack is Tailwind's own default `font-sans` fallback chain (`-apple-system, system-ui, "Segoe UI", Roboto, ...`), with no custom override anywhere in this session's changes. The test browser (an Electron-based renderer) is falling through to the "Roboto" entry in that chain instead of resolving `-apple-system`/`system-ui` to the real OS font — a test-environment artifact. A real user's browser resolves this correctly.
- **`line-length` findings:** all on real AI-generated conversation-overview text (`line-clamp-2` card descriptions) using the exact same class this session never touched — pre-existing, unrelated to the calendar/search feature.

Net: the calendar/search feature itself has no real detector findings once the false positives and pre-existing/environmental noise are excluded.

**Visual overlay:** Injection required a fallback (the sandboxed browser pane blocks cross-origin traffic to the detector's helper port; the payload was served same-origin instead, verified byte-identical, and the temp file was removed afterward with a clean `git status`). The overlay itself is not currently visible anywhere for you to click open — it lived in the evidence-gathering tab only.

## Overall Impression

The execution is careful within the app's own visual vocabulary — no new colors, no new interaction pattern for "selected," genuinely correct cross-day selection-state engineering (verified live, including the set-membership check that avoids a false "all selected" when items are hidden elsewhere). But the calendar was built as a full always-expanded month grid rather than shaped around its own stated default ("today, already selected"), and on mobile that costs the page's most common single interaction — opening it to see today's list — a mandatory scroll past a 6-row grid that, most days, answers a question the user didn't ask. The single biggest opportunity: make the calendar collapse to a compact summary by default and expand to the full grid only when actually browsing.

## What's Working

- **One Ink Rule discipline**: the calendar introduces zero new color meaning — selected/today/dot all reuse existing indigo and graphite roles exactly as DESIGN.md prescribes.
- **Cross-day selection is well-engineered**: `allFilteredSelected` checks set membership, not count, so a selection partly hidden on another day never falsely shows as "all selected." Verified live across a real day switch.
- **Empty-day and no-results copy** is warm and actionable, in voice with the rest of the app, and always offers a next step.

## Priority Issues

**[P0] Mobile first paint shows zero conversations.** Measured live at 375×812: header, search, and the full calendar grid exactly fill the viewport — the day heading, scan row, and first conversation card are all below the fold on every visit, including the default "today" case that's supposed to be the fast path. This is a one-handed, phone-first, daily-use tool per DESIGN.md itself, and the primary task now costs a mandatory scroll on every single open.
Fix: default the calendar to a collapsed state (e.g. a one-line "Today ▸" summary or a slim day-strip) that expands to the full grid on tap, instead of always rendering all 6 rows.
Suggested command: `$impeccable distill`

**[P1] The "(across all days)" qualifier fires on a single-day selection too.** Verified live: selecting exactly one conversation on today immediately shows "1 selected (across all days)." The code only checks `selected.size > 0`, never distinct-day span. This label exists specifically to reassure a user mid-batch-selection that cross-day picks are being tracked; showing it for a trivial single-day pick makes it noise and erodes trust in it for the actual multi-day case.
Fix: track distinct source days (or day-vs-search origin) and only append the qualifier when that count is greater than one.
Suggested command: `$impeccable clarify`

**[P2] No way to jump to a distant month.** The month label is static text; reaching six months back means six chevron clicks — reintroducing a version of the exact tedium (retrieval getting harder as the archive grows) the feature was built to solve.
Fix: make the month label tappable to open a compact year/month jump, or add a "jump to date" control near "Today."
Suggested command: `$impeccable optimize`

**[P2] Calendar card carries the same visual weight as content cards.** Identical `.card` background, padding, and radius as every conversation card and the scan-row toolbar — nothing signals "this is navigation chrome," undercutting the intended hierarchy where the calendar should read as secondary to the day's actual content.
Fix: differentiate its visual weight (tighter padding, no full border, or resolve this naturally via the P0 collapsed-by-default fix).
Suggested command: `$impeccable layout`

**[P3] Search results have no date grouping.** A broad query returning results across many days shows a flat list with no day headers, while the calendar's browsing path groups by day naturally — the two entry points have inconsistent information structure.
Fix: add lightweight date-group headers to search results when they span more than one day.
Suggested command: `$impeccable typeset`

## Persona Red Flags

**Casey (mobile, one-handed):** Lands on the page and sees zero conversations without scrolling (P0, measured). Calendar day cells measured at 44×44px with only ~0.7px gap between adjacent cells — functionally edge-to-edge, raising mis-tap risk browsing the grid one-handed.

**Alex (power user, growing archive):** Relies on "N selected (across all days)" while assembling a cross-day Group Thesis batch, but the label fires even on a single-day pick (P1), so it can't be trusted as the diagnostic it's meant to be. Also hits the no-jump-to-month wall (P2) reaching into older material for evidence.

**Riley (stress tester):** The busy day (7 August, 18 conversations) rendered correctly at desktop width, but this was not verified at mobile width, where the five-element scan row (count + 3 pills + button) is more likely to wrap awkwardly — flagged as untested, worth a follow-up check.

**Project-specific — "the once-daily closer"** (per PRODUCT.md: Daily Rollup is used roughly once daily to close out a day): this same person's most frequent interaction with this page is opening it, confirming today's list, and moving on. The full-viewport mobile calendar (P0) inserts a scroll into that daily ritual every time — small, but compounding, and exactly the kind of low-value friction PRODUCT.md's accessibility section asks the ADHD-facing side of this app to avoid, even though this specific page isn't formally an ADHD Aid surface.

## Minor Observations

- Future-date cells use `text-slate-600` against the night-field background — quite dim; worth a contrast check, since DESIGN.md doesn't call out this specific pairing.
- The entry-dot doesn't scale with volume — a 1-conversation day and an 18-conversation day get an identical single dot, a real (likely intentional, per DESIGN.md's flat/no-elevation stance) limit on the dot's information value.
- Search placeholder copy is accurate and doesn't overclaim — correctly signals it searches title/overview, not full transcripts.
- Calendar day buttons' `aria-label`/`aria-pressed` coverage is thorough — a screen-reader user gets more information (weekday, day, month, "today," "has conversations") than a sighted user gets from the dot alone.
- The detector's `<details>`-related false positives (see Design Specificity Verdict) are worth knowing about if you ever see similar "text-occlusion" findings elsewhere in this app — they're not necessarily real.

## Questions to Consider

- If the calendar's own default is "today," and today is already selected on load, why does the full 6-row grid render expanded on every visit instead of only when actually browsing?
- Search bypasses day-scoping by design — should it stay unconditionally global once the archive spans years instead of months, or would a "recent vs. everything" toggle matter eventually?
- Is a 7×6 always-visible grid actually solving "retrieval shouldn't require scrolling," or does it just move the scroll from the list to the calendar itself once the target month isn't the current one?
