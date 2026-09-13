# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Single user: Ulysses S. Cabayao, SJ, a PhD researcher and the sole operator of this tool. He uses it personally to process his own field recordings for his dissertation and to run a daily executive-function aid for himself. No other accounts, users, or shared instances exist. A thesis committee/advisors may occasionally read exported markdown/Obsidian output, but never operate the app.

## Product Purpose

Turns conversations captured by a wearable pendant into two independent, structured analyses:

1. An eight-dimension thesis-research lens ("Pioneer Sovereignty") — RQ1 (Documentary Record), RQ2 (Spatial Practice), RQ3 (Sociality of Labor), RQ4 (Sovereignty Negotiation), Conditions Check, Rival Hypothesis, Refutation Signals, and Forward Thinking — plus an ad-hoc Custom prompt, for a PhD dissertation on Pioneer Sovereignty enacted through ranch sociality in Montana.
2. An "ADHD Aid" cognitive-prosthetic lens, run per-conversation or as a calendar-day Daily Rollup (with a Weekly Rollup layer above it), that converts recorded conversations into actionable structure: today's highest-leverage actions, tracked commitments (with done/let-go toggles that persist and age across days), decisions/facts to remember, people and social debts, open loops, and upcoming prep.

Success = real conversations captured throughout the day become both (a) usable qualitative evidence for the dissertation and (b) a trustworthy daily plan that nothing important silently drops from.

## Positioning

Not a general transcription or note-taking tool — a dual-lens instrument purpose-built around one person's actual workflow: an Omi wearable capturing raw conversation, TRACE's own iOS app relaying and transcribing the audio (Deepgram), GPT-5.6-luna structuring it two different ways for two different jobs (dissertation evidence vs. daily executive function), with Daily Rollup's day-to-day chaining (aging, renegotiation scripts, "what was dropped" logging) as the mechanism a generic to-do or journaling app doesn't have. A People directory with voice recognition and a relationship graph turns passing mentions into a persistent social map of the fieldwork.

## Operating Context

- Conversations are recorded passively via an Omi DK2 pendant; TRACE's own iOS app relays the audio and TRACE transcribes it (Deepgram, with Opus decoding and VAD on the server). Omi's app and cloud are no longer involved (retired 2026-09-05; history imported).
- Analysis runs client-orchestrated: pages call Next.js API routes, which call OpenAI GPT-5.6-luna. Results persist to `localStorage` as the synchronous working copy and are mirrored to a private server-side store (Neon Postgres via the Vercel Marketplace) for cross-device continuity. The app runs fully offline from localStorage alone; the server mirror adds durability and phone↔desktop sync.
- Used as an installed PWA on mobile (dark theme, safe-area insets, touch-target sizing, app badge synced to open-promise count) as well as desktop browser. Global keyboard shortcuts (`?` help, `g` prefix chords for navigation, `/` search) complement the touch interface.
- Daily Rollup is used roughly once daily to close out a day and generate tomorrow's plan; Weekly Rollup synthesizes a week's dailies. Per-conversation passes happen throughout the day as recordings come in. Push notifications remind when the daily rollup hasn't been done.
- Exports go to Obsidian or plain markdown download, for both the thesis lens and the ADHD Aid lens.

## Capabilities and Constraints

- Two independent analysis lenses (Thesis, ADHD Aid) selectable per conversation or per multi-selection; "Both" runs them independently, not merged.
- Group Analysis: cross-conversation thesis analysis across 2+ selected conversations, with its own Custom prompt.
- ADHD Aid per-conversation output feeds Daily Rollup; Rollup auto-chains to the previous day's stored rollup for commitment aging. Weekly Rollup chains above dailies. Server-side durable rollup jobs survive tab close.
- Open Promises ledger: cross-conversation commitment tracker with age bands, direction filters, done/let-go disposition, grouped by person.
- People directory: full CRM with profiles, photos, aliases, facts with provenance, relationship graph (force-directed, Obsidian-style), ego-web per person, named places with maps, meeting history with locations, voice recognition pipeline (speaker enrollment, voice clustering, voice grouping with review queue and audio evidence playback).
- Full-text search across all stored thesis and group analyses (server-side).
- Capture monitoring dashboard: pipeline status, failed transcription retries, VAD tuning readout, deployment checks (Opus decoder, ONNX speaker model).
- App-wide undo system (10-second window, survives navigation) for destructive actions.
- No auth and no multi-tenancy — single-user by construction, not just by convention. The server-side store is unauthenticated, which is only defensible because the writable surface is a fixed set of analysis namespaces and the app has exactly one user. A second user would require auth before anything else.
- ADHD Aid's generated output text stays neutral in tone — no "you forgot," no mention of ADHD inside generated content; the cognitive-aid framing is a UI/product-level concern, not a voice injected into the analysis text.
- Depends on two external APIs (Deepgram for speech-to-text, OpenAI for analysis) — both keys are the user's own. Speaker embeddings run on-device via @huggingface/transformers.

## Brand Commitments

The app is TRACE — rebranded from "Omi Thesis Analyzer" when the Omi dependency was retired (2026-09-05). ADHD Aid is an added lens under that identity, not a separate product name.

## Evidence on Hand

This is a live personal tool already processing real recordings and real thesis/ADHD data daily. No fabricated testimonials, benchmarks, or third-party case studies apply — the only "evidence" is the user's own ongoing usage.

## Product Principles

1. One person's real daily workflow is the spec — no multi-user, no accounts, no generalized audience to design for.
2. The two lenses stay independent: thesis-analysis correctness must never be perturbed by ADHD Aid work, and vice versa.
3. Nothing tracked (a commitment, an open loop) vanishes silently — it's surfaced explicitly or logged as dropped, always.
4. ADHD Aid surfaces favor low cognitive load: minimal clutter, calm/quiet visual treatment, and scannable structure over dense information display.
5. The browser is the working copy; the server is durability. localStorage stays the synchronous source every screen reads, so the app runs fully offline and unchanged if the store is absent — the server-side mirror only adds cross-device continuity on top.
6. People are first-class entities, not ephemeral mentions — voice recognition, relationship mapping, and place history build a persistent social map of the fieldwork.

## Accessibility & Inclusion

ADHD Aid is designed for low cognitive load specifically: minimal clutter, calm and quiet visual treatment, large scannable structure, and low friction — beyond baseline WCAG AA (contrast, focus states, keyboard nav), which the codebase already implements (e.g. `:focus-visible` outlines, a fluid type scale, and larger touch targets for coarse pointers).
