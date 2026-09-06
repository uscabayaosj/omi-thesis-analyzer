# TRACE — Personal & Research Assistant

Turns conversations captured by an Omi DK2 pendant — through TRACE's own iOS relay app, with no Omi app or cloud involved — into two things: thesis evidence for PhD research on Pioneer Sovereignty, and a daily executive-function plan. TRACE ingests the pendant's audio, transcribes it with Deepgram, and runs analysis through the configured AI provider (GPT-5.6-luna by default).

## Setup

1. Copy `.env.example` to `.env.local`
2. Add your AI provider's API key
3. On Vercel: `DEEPGRAM_API_KEY`, `CAPTURE_INGEST_TOKEN` (any long random string), a private Blob store, and the Neon integration
4. Build `ios/TraceCapture` onto your iPhone (see `docs/superpowers/specs/2026-09-05-trace-capture-design.md`), enter the same URL + token in its Settings, pair the pendant
5. `npm run dev` or deploy to Vercel. Local dev has no store, so the conversation screens are empty; `npm run dev:fixtures` serves a fixed set of sample conversations instead (see `src/lib/dev-fixtures.ts`)

## Thesis lens

Eight dimensions, grounded in the thesis's own framework (see `src/lib/analysis.ts`):

1. **RQ1 — Documentary Record** — the historical-legal constitution of authority: patents, water rights, allotments, grazing permits
2. **RQ2 — Everyday Practices** — kinship, inheritance, branding, boundary-maintenance, conflict
3. **RQ3 — CSKT Intersection** — how ranching authority intersects with, depends on, and is contested by CSKT sovereignty
4. **RQ4 — Wildness Imaginary** — frontier mythology as a double-erasure instrument
5. **Orienting Conditions** — which of the five conditions the conversation evidences
6. **Rival Hypothesis Test** — public/strategic register or intimate; felt subjectivity or instrumental rhetoric
7. **Refutation Signals** — what challenges or complicates the concept
8. **Forward Thinking** — research directions, hypotheses, next steps

Plus **Custom** — an ad-hoc question asked through the same framework, and **Group Analysis** — the same lens across several conversations at once.

## ADHD Aid

A second analysis lens, independent of the thesis lens, runnable on a single conversation or a multi-selection. Toggle **Thesis / ADHD Aid / Both** on any conversation.

**Per-conversation pass** — a cognitive prosthetic that processes one transcript into:

1. **Do today** — up to 3 highest-leverage actions, each with a time estimate
2. **Promises** — every commitment, either direction, with who/what/deadline/confidence. Each can be ticked done or *let go* (retired without being done); both states persist across re-analysis and across devices
3. **Worth remembering** — decisions (with reasoning), facts, answers, recommendations
4. **People** — relationship, personal details shared, tone, social debts owed
5. **Unfinished threads** — unresolved topics, phrased as actionable questions
6. **Coming up** — upcoming events with prep required and when to start it
7. **Reflection** — how the conversation went, a feelings check, over-commitment, the bigger picture

Run it on one conversation from the conversation page, or on a multi-selection from the home list ("Run ADHD (n)") to batch-process each independently. **Open promises** (`/commitments`) is the ledger of everything still owed across every conversation.

**Daily Rollup** — a calendar-day view (`Daily Rollup` in the header) that merges a day's per-conversation ADHD passes into one plan for tomorrow: deduplicated commitments, a re-prioritized tickable top-5, aging on anything carried from a prior day (with a renegotiation script after 3+ days), a social ledger, tomorrow's events, and a log of what was dropped so nothing vanishes silently. Generating a day's rollup automatically chains to the most recent earlier day's rollup for aging. **This Week** synthesises a week of daily rollups.

Both lenses, the rollups and the group analysis export to Obsidian or download as markdown.

## Data

The browser is the working copy: everything is written to `localStorage` first, so the app works offline. With `DATABASE_URL` set, a private Neon store mirrors every namespace so the same data is on phone and desktop; the merge is per record, last-write-wins, with ticks and let-gos on their own clocks, and the server only ever adds or updates — a device can never wipe the server's copy. **Backup** on the home page downloads everything as one JSON file; **Restore** merges such a file back in — newer records win, and nothing on the device is dropped unless the backup recorded that deletion later.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/uscabayaosj/omi-thesis-analyzer&env=OPENAI_API_KEY,DEEPGRAM_API_KEY,CAPTURE_INGEST_TOKEN)

## Tech Stack

- Next.js 16 (App Router), React 19
- Tailwind CSS 4
- OpenAI GPT-5.6-luna by default; Anthropic, Google and OpenRouter selectable via `AI_PROVIDER`
- Deepgram nova-3 (speech-to-text), Vercel Blob (audio archive), Neon (store), WavLM (speaker identification)
- TRACE Capture: a SwiftUI/CoreBluetooth relay app in `ios/`
- PWA (installable on mobile)
