# TRACE — Personal & Research Assistant

Turns Omi wearable conversations into two things: thesis evidence for PhD research on Pioneer Sovereignty, and a daily executive-function plan. Pulls conversations from the Omi Developer API and runs analysis through GPT-5.6-luna.

## Setup

1. Copy `.env.example` to `.env.local`
2. Add your Omi Developer API key (from Omi app → Developer → API Keys)
3. Add your OpenAI API key
4. `npm run dev` or deploy to Vercel

## Analysis Dimensions

1. **Thesis Relevance** — How the conversation connects to "Pioneer Sovereignty" (sovereignty through ranch sociality in Montana)
2. **Derived Meanings** — Deeper patterns, social dynamics, power relations
3. **Summary** — Comprehensive overview of the conversation
4. **Forward Thinking** — Research directions, hypotheses, next steps
5. **Custom** (toggle) — User-defined analysis prompt for ad-hoc needs

## ADHD Aid

A second analysis lens, independent of the thesis lens, runnable on a single conversation or a multi-selection. Toggle **Thesis / ADHD Aid / Both** on any conversation.

**Per-conversation pass** — a cognitive prosthetic that processes one transcript into:

1. **Do today** — up to 3 highest-leverage actions, each with a time estimate
2. **Commitments** — every promise or obligation, either direction, with who/what/deadline/confidence and a done-toggle that persists across re-analysis
3. **Remember** — decisions (with reasoning), facts, answers, recommendations
4. **People** — relationship, personal details shared, tone, social debts owed
5. **Open loops** — unresolved topics, phrased as actionable questions
6. **Ahead** — upcoming events with prep required and when to start it

Run it on one conversation from the conversation page, or on a multi-selection from the home list ("Run ADHD (n)") to batch-process each independently.

**Daily Rollup** — a calendar-day view (`Daily Rollup` in the header) that merges a day's per-conversation ADHD passes into one plan for tomorrow: deduplicated commitments, a re-prioritized top-5, aging on anything carried from a prior day (with a renegotiation script after 3+ days), a social ledger, tomorrow's events, and a log of what was dropped so nothing vanishes silently. Generating a day's rollup automatically chains to the most recent earlier day's rollup for aging.

Both ADHD Aid and Daily Rollup export to Obsidian or download as markdown, same as the thesis analysis.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/uscabayaosj/omi-thesis-analyzer&env=OMI_API_KEY,OPENAI_API_KEY)

## Tech Stack

- Next.js 15 (App Router)
- Tailwind CSS
- OpenAI GPT-5.6-luna
- Omi Developer API
- PWA (installable on mobile)
