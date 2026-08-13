# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Single user: Ulysses S. Cabayao, SJ, a PhD researcher and the sole operator of this tool. He uses it personally to process his own field recordings for his dissertation and to run a daily executive-function aid for himself. No other accounts, users, or shared instances exist. A thesis committee/advisors may occasionally read exported markdown/Obsidian output, but never operate the app.

## Product Purpose

Turns Omi wearable conversation recordings into two independent, structured analyses:

1. A five-dimension thesis-research lens ("Thesis Relevance", "Derived Meanings", "Summary", "Forward Thinking", and an ad-hoc "Custom" prompt) for a PhD dissertation on Pioneer Sovereignty — sovereignty enacted through ranch sociality in Montana.
2. An "ADHD Aid" cognitive-prosthetic lens, run per-conversation or as a calendar-day Daily Rollup, that converts recorded conversations into actionable structure: today's highest-leverage actions, tracked commitments (with a done-toggle that persists and ages across days), decisions/facts to remember, people and social debts, open loops, and upcoming prep.

Success = real conversations captured throughout the day become both (a) usable qualitative evidence for the dissertation and (b) a trustworthy daily plan that nothing important silently drops from.

## Positioning

Not a general transcription or note-taking tool — a dual-lens instrument purpose-built around one person's actual workflow: an Omi wearable capturing raw conversation, GPT-5.6-luna structuring it two different ways for two different jobs (dissertation evidence vs. daily executive function), with Daily Rollup's day-to-day chaining (aging, renegotiation scripts, "what was dropped" logging) as the mechanism a generic to-do or journaling app doesn't have.

## Operating Context

- Conversations are recorded passively via an Omi wearable and pulled through the Omi Developer API.
- Analysis runs client-orchestrated: pages call Next.js API routes, which call OpenAI GPT-5.6-luna; all results persist to `localStorage` only (no server-side database).
- Used as an installed PWA on mobile (dark theme, safe-area insets, touch-target sizing) as well as desktop browser.
- Daily Rollup is used roughly once daily to close out a day and generate tomorrow's plan; per-conversation passes happen throughout the day as recordings come in.
- Exports go to Obsidian or plain markdown download, for both the thesis lens and the ADHD Aid lens.

## Capabilities and Constraints

- Two independent analysis lenses (Thesis, ADHD Aid) selectable per conversation or per multi-selection; "Both" runs them independently, not merged.
- ADHD Aid per-conversation output feeds Daily Rollup; Rollup auto-chains to the previous day's stored rollup for commitment aging.
- No auth and no multi-tenancy — single-user by construction, not just by convention. Analyses are mirrored to a private server-side store (Neon Postgres via the Vercel Marketplace) so the same data is available on phone and desktop; that store is unauthenticated, which is only defensible because the writable surface is a fixed set of four analysis namespaces and the app has exactly one user. A second user would require auth before anything else.
- ADHD Aid's generated output text stays neutral in tone — no "you forgot," no mention of ADHD inside generated content; the cognitive-aid framing is a UI/product-level concern, not a voice injected into the analysis text.
- Depends on two external APIs (Omi Developer API, OpenAI) — both keys are the user's own.

## Brand Commitments

The app keeps its "Omi Thesis Analyzer" / "Thesis Analyzer" identity. ADHD Aid is an added lens under that identity, not a rebrand or a second product name.

## Evidence on Hand

This is a live personal tool already processing real Omi recordings and real thesis/ADHD data daily. No fabricated testimonials, benchmarks, or third-party case studies apply — the only "evidence" is the user's own ongoing usage.

## Product Principles

1. One person's real daily workflow is the spec — no multi-user, no accounts, no generalized audience to design for.
2. The two lenses stay independent: thesis-analysis correctness must never be perturbed by ADHD Aid work, and vice versa.
3. Nothing tracked (a commitment, an open loop) vanishes silently — it's surfaced explicitly or logged as dropped, always.
4. ADHD Aid surfaces favor low cognitive load: minimal clutter, calm/quiet visual treatment, and scannable structure over dense information display.
5. The browser is the working copy; the server is durability. localStorage stays the synchronous source every screen reads, so the app runs fully offline and unchanged if the store is absent — the server-side mirror only adds cross-device continuity on top. Analyses are the most expensive artifact in the system and were previously the least durable, trapped per-device; that was the reason for adding the mirror.

## Accessibility & Inclusion

ADHD Aid is designed for low cognitive load specifically: minimal clutter, calm and quiet visual treatment, large scannable structure, and low friction — beyond baseline WCAG AA (contrast, focus states, keyboard nav), which the codebase already implements (e.g. `:focus-visible` outlines, a fluid type scale, and larger touch targets for coarse pointers).
