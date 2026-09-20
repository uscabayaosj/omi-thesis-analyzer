# Ask the Corpus, Codebook, Patterns — design

Date: 2026-09-20

Three features that push each of TRACE's two lenses to the next layer of
synthesis. Two serve the thesis lens (question-answering across the whole
archive, and qualitative coding); one serves the ADHD lens (a no-LLM pattern
dashboard over rollups and commitments). Each is a page plus a lib module;
two add an API route. All three obey the product principles: localStorage is
the working copy, the server mirror is durability, the lenses stay
independent, and no LLM call runs implicitly.

Assumptions made without asking (single-user tool, autonomous session):
codes are user-owned and the model only *suggests*; Ask answers cite stored
analyses, not raw transcripts (transcripts are not durably stored); Patterns
is computed locally and costs no tokens.

## 1. Ask the Corpus — `/ask`

**Job.** Answer a research question across every stored thesis analysis and
group analysis with citations back to the conversations. Search finds
strings; Ask synthesizes.

**Flow.**
1. User types a question and presses Ask (explicit, never on keystroke).
2. `POST /api/ask { question }` reads `omi-thesis-analyses` and
   `omi-thesis-group-analyses` from Neon (same source Search uses).
3. `src/lib/ask.ts` splits the corpus into passages (one per conversation
   per dimension, and one per group per dimension), scores each passage by
   keyword overlap with the question (stemmed-ish lowercase tokens, stop
   words removed), and takes the top passages under a 40,000-character
   budget. Each passage gets a citation tag `[C1]`, `[G2]`.
4. One `chatCompletion` call (label `thesis-ask`) with the thesis system
   framing, the tagged passages, and the question. The model answers in
   2–5 paragraphs and cites tags inline.
5. Response: `{ answer, sources: [{ tag, kind, conversationId|conversationIds,
   title, date, field, label }] }`. Client renders the answer with tags
   turned into links to the source conversation or group page.
6. Client stores the inquiry in `omi-thesis-inquiries` (keyed map by id,
   synced). The page lists past inquiries newest first; re-opening one shows
   the stored answer without a new call.

**Token efficiency.** Input clamped to the passage budget; passages that
score zero are never sent; if a question repeats verbatim (normalized) the
client offers the stored answer instead of re-running. Empty corpus returns
a friendly message with no model call.

**Errors.** Store unconfigured → "Ask needs the server-side store". Model
errors go through `friendlyError`.

## 2. Codebook — `/codebook`

**Job.** Qualitative coding of the thesis corpus: a codebook of named codes,
each with evidence excerpts tied to a conversation and dimension, plus a
saturation read (how many new excerpts each code gained per week).

**Data.** Two synced keyed-map namespaces, both merged by the generic
timestamp rule with tombstones for deletion:
- `omi-thesis-codes`: `{ id, name, description, timestamp, deleted? }`
- `omi-thesis-code-evidence`: `{ id, codeId, conversationId, conversationTitle,
  date, field, excerpt, source: "suggested"|"manual", timestamp, deleted? }`

**Suggestion route.** `POST /api/codebook/suggest { conversationId, title,
date, analysis: {8 fields}, codes: [{id,name,description}] }`. The client
sends the analysis text from localStorage, so the route does not depend on
the store. `src/lib/codebook-suggest.ts` builds one `chatCompletion` call
(JSON mode, label `thesis-codebook`) that returns
`{ applications: [{ codeId, field, excerpt }], proposed: [{ name,
description, field, excerpt }] }`. Excerpts must be verbatim substrings of the
analysis text; the server drops any that are not.

**Page.**
- Header stat row: codes, excerpts, conversations coded.
- Code list: each code shows name, description, excerpt count, a weekly
  saturation strip (last 8 weeks, one bar per week, count of new excerpts),
  and an expandable list of excerpts with links to the conversation.
- Add code (name + description), edit, delete (tombstone, undo-able via the
  existing undo bar).
- Manual excerpt: paste text and pick the conversation from the analyzed
  list.
- "Suggest codes for a conversation": pick an analyzed conversation, run,
  review a checklist of suggested applications and proposed new codes,
  accept the ticked ones.
- Export codebook as markdown download (codes, then excerpts grouped by
  code with conversation and date).

**Conversation page hook.** A "Code this conversation" link on the
conversation page opens `/codebook?suggest=<id>` with that conversation
preselected.

## 3. Patterns — `/patterns`

**Job.** Show the ADHD lens's own record back to the user as patterns, with
zero model calls: what gets done, what ages, who is owed, what keeps
reappearing.

**Computation (`src/lib/patterns.ts`, pure, tested).** From
`omi-adhd-analyses` and `omi-adhd-rollups`:
- Rollup coverage: for the last 8 weeks, days with at least one ADHD
  analysis vs days with a rollup; current streak of consecutive rollup days
  ending today or yesterday.
- Commitments by week (conversation date): created, done, let go, still
  open. Completion rate = done / (done + let go + open) for weeks that have
  any.
- Median age of currently open commitments, and count over 14 days.
- Social ledger: per counterparty, open count, oldest open age, done count.
  Top 8 by open count then age.
- Recurring open loops: normalized open-loop text (lowercase, punctuation
  stripped, first 60 chars) that appears in 2 or more analyses; list with
  count and the conversations.
- Plan-step follow-through: per rollup day, ticked / total; overall rate.

**Page.** Calm, scannable, section-per-question: "Are days getting closed?",
"Are promises getting kept?", "Who is owed?", "What keeps coming back?",
"Does the plan get done?". Bars are simple horizontal divs in survey blue
with the value labelled beside, one hue for magnitude, a dark-mode surface
already the app's. No legend needed (single series per chart). Each
recurring loop links to its conversations; each person links to their
People page when a match exists.

## Cross-cutting

- Shortcuts: `g a` Ask, `g k` Codebook, `g t` Patterns.
- Home footer nav and Help page gain links.
- `SYNCED_NAMESPACES` gains the three new keyed-map namespaces; backup,
  restore, and export handle them generically.
- Tests: `ask` passage scoring and budget, codebook excerpt verification,
  patterns computations.
