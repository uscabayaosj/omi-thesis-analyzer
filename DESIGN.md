---
name: TRACE
description: A lamplit field journal for turning Omi wearable recordings into thesis evidence and daily executive-function structure.
colors:
  night-pasture: "#161311"
  lamp-paper: "#f6f1e7"
  ink-panel: "#221c17"
  ink-panel-raised: "#2e261e"
  brand-leather: "#2a1c10"
  copper-brand: "#b96d33"
  copper-brand-light: "#d99a5e"
  copper-brand-deep: "#a25a26"
  graphite: "#a89a88"
  graphite-nontext: "#7a6b58"
  amber-marginalia: "#fbbf24"
  amber-marginalia-wash: "rgba(245, 158, 11, 0.06)"
  sage-green: "#a9bd8f"
  alert-clay: "#e98d72"
typography:
  display:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "clamp(1.5rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  headline:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "clamp(1.15rem, 3vw, 1.5rem)"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "clamp(1rem, 2.5vw, 1.25rem)"
    fontWeight: 600
    lineHeight: 1.3
  subtitle:
    fontFamily: "'Source Serif 4', Georgia, serif"
    fontSize: "0.95rem"
    fontWeight: 400
    fontStyle: "italic"
    lineHeight: 1.5
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  eyebrow:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.14em"
    textTransform: "uppercase"
  micro:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.copper-brand}"
    textColor: "#020617"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "#67e8f9"
  button-secondary:
    backgroundColor: "{colors.ink-panel}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "{colors.ink-panel-raised}"
  card:
    backgroundColor: "{colors.ink-panel}"
    rounded: "{rounded.lg}"
    padding: "20px"
  badge:
    backgroundColor: "{colors.ink-panel}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: TRACE

## Overview

**Creative North Star: "The Field Journal"**

This is a researcher's dark notebook, not a product marketing itself. Every screen reads as a page you turn to record, review, or close out — precise, patient, and unhurried, because the two people this journal serves are the same person: a PhD researcher extracting thesis evidence, and someone using the same tool at the end of the day to see what actually needs doing. The copper accent behaves like a branding iron’s mark on leather: it marks what matters (the primary lens, the active state, the thing to act on) and disappears everywhere else. Amber behaves like a marginal note — the custom-analysis lens and its "saved" chip are handwritten asides against the notebook's default page, not a competing brand color.

The palette stays muted and clinical on purpose: desaturated slate, low-glare, nothing performing for attention. Warmth exists, but only where it's earned — amber for a personal aside, emerald for a thing genuinely done and checked off — never as decoration. This system explicitly rejects three lanes it could easily fall into: a productivity app selling itself (no gamification, no cheerful microcopy, no streaks), a clinical intake form (despite the ADHD framing, nothing reads as diagnostic or sterile), and a busy analytics dashboard (no multi-panel data-viz energy — this is a small set of calm, sequential pages, not a control room).

**Key Characteristics:**
- Single dark surface family (night pasture → ink panel → ink panel raised), no light mode
- One accent color carries all "this is active / this is primary" meaning: branding-iron copper
- Flat by default — depth comes from tonal layering, not shadows
- Every interactive target is at least 44px tall; this is a phone-in-pocket tool as much as a desk tool
- Amber and emerald are single-purpose accents (custom lens; done/verified) — never used decoratively

## Colors

The palette is a narrow, deliberately dark stack: one background, one panel color one step lighter, one accent, and two single-purpose signal colors. Nothing else is introduced.

### Primary
- **Copper Brand** (`#b96d33`): The one color that means "this is primary, active, or mine to act on" — primary buttons, active filter pill, selected-item border, links, the app's own icon accent. Taken straight from the TRACE mark's nodes (now copper). Used sparingly against the dark field so it reads as a mark, not a wash. Because the active fill (Tailwind's `cyan-400` token, remapped to `#d99a5e`, a light copper) is a *light* copper, anything filled with it carries a near-black label, never white: warm-white on it fails AA, while the near-black label clears contrast comfortably — the bright-on-dark pairing is the logo's own contrast relationship.
- **Copper Brand — Light** (`#d99a5e`): A lighter step of the same ink, used only for icon/heading accents inside content blocks (e.g. the icon beside an analysis section heading) where full-strength copper would be too loud against panel text.
- **Brand Leather** (`#2a1c10`): The logo lockup's ground. It is *not* a UI surface — the app field stays Night Pasture. Brand Leather appears only where the brand mark needs its own ground: the PWA icon, the manifest `theme_color`, and the browser chrome.

### Neutral
- **Night Pasture** (`#161311`): The base page background, and — reused deliberately — the recessed color for form inputs (textarea, "try again" button), so inputs read as sunken *below* the panel surface rather than floating on it.
- **Ink Panel** (`#221c17`): The card/panel surface, one step lighter than the field. Every card, block, and toolbar sits at this level.
- **Ink Panel, Raised** (`#2e261e`): The hover/pressed state for panels, and the default border color for panels at rest. One hex, two roles — border when idle, fill on interaction.
- **Lamp Paper** (`#f6f1e7`): Primary text color, at full opacity for headings and ~90% for analysis body copy.
- **Graphite** (`#a89a88`): Muted/secondary text — timestamps, helper copy, placeholders, badge text. This is the single muted-text value; the app previously mixed it with a darker non-text tone (`#7a6b58`), which failed WCAG AA for body text. Graphite clears the 4.5:1 text threshold against both Night Pasture and Ink Panel. **Muted never means illegible** — if something needs to recede further, reduce its size or weight, don't darken it past this value. `#7a6b58` (Graphite, Non-Text) survives only as a non-text tone (the calendar's "has entries" dot, list markers), where the 3:1 non-text threshold applies.

### Named Rules
**The One Ink Rule.** Copper Brand is the only color allowed to mean "primary." If a second element on screen needs to look important, it does not get its own color — it gets weight, size, or position instead.

**The Two Greys Rule.** There are exactly two muted greys, and only one of them is ever allowed to carry text: Graphite (`#a89a88`) for any text, and Graphite, Non-Text (`#7a6b58`) for non-text marks only (dots, markers, decorative icons). A third, darker grey is never introduced for "extra quiet" text — quieter is expressed through size and weight. Audit test: every text colour in the app must clear 4.5:1 against both Night Pasture and Ink Panel; `#7a6b58` fails both, which is exactly why it is barred from text.

### Signal Colors (single-purpose, not decorative)
- **Amber Marginalia** (`#fbbf24`, on a `rgba(245, 158, 11, 0.06)` wash): Reserved entirely for the Custom Analysis lens — its icon, heading, "saved" chip, and active border. Never appears anywhere the custom lens isn't involved.
- **Sage Green** (`#a9bd8f`, Tailwind's `emerald` scale): Reserved for "done" and "verified" states only — a completed commitment, an analyzed badge, a saved rollup. Always paired with a checkmark or explicit status text, never color alone.
- **Alert Clay** (`#e98d72`, Tailwind's `red` scale): Errors only — failed fetch, failed analysis. Always paired with a warning icon and explanatory text.

## Typography

**Display/Body Font:** System sans (`ui-sans-serif, system-ui, -apple-system`) — no custom webfont is loaded; the system stack keeps the app feeling native and instant on a phone-installed PWA.
**Label/Mono Font:** System mono (`ui-monospace, SFMono-Regular`) — used narrowly for small structured metadata (a commitment's "who → who" direction, a transcript timestamp), never for prose.

**Character:** Plain and legible over expressive. The type system does one job — make dense structured output (five thesis dimensions, six ADHD categories) scannable at a glance — and gets out of the way otherwise.

### Hierarchy
- **Display** (700, `clamp(1.5rem, 4vw, 2.25rem)`, 1.2): Page-level `h1` only — "Thesis Analyzer," a conversation's title.
- **Headline** (600, `clamp(1.15rem, 3vw, 1.5rem)`, 1.25): `h2`, section-level headings.
- **Title** (600, `clamp(1rem, 2.5vw, 1.25rem)`, 1.3): `h3`, individual analysis-block headings (e.g. "Do today," "RQ1 — Documentary Record").
- **Subtitle** (400 italic serif, 0.95rem, 1.5): The one-line gloss directly under a page or section heading — what this screen is, or what a list is showing ("Every meeting, most recent first"). Italic serif because it is the journal's own aside about its content, not content itself; it never carries a control or a fact the reader must act on. Sits fractionally above Body so it reads as part of the heading block rather than as the first line of the copy beneath it.
- **Body** (400, 0.875rem/14px, 1.7): Analysis prose and card copy. The unusually tall 1.7 line-height is deliberate — this is dense generated text read at arm's length, not marketing copy.
- **Label** (500, 0.75rem/12px mono, 1.4): Timestamps, confidence tags, directional metadata ("them → me").
- **Eyebrow** (500, 0.6875rem/11px mono, uppercase, 0.14em tracking): The running head above a page or section title — "Directory," "Planning," "Profile," "Location," a conversation's own category. One step below Label because it sits *above* a heading and must not compete with it; the wide tracking and uppercase are what make it read as a running head rather than as small body text. Never used for anything the reader needs to act on.
- **Micro** (600, 0.625rem/10px sans, 1): A single glyph inside a compact circular badge (the T/A lens dots, the accordion's numbered dimension markers) — the smallest step, reserved for exactly that role. It exists because 12px (Label) doesn't fit comfortably as a centered single character inside a 20px circle; two components converged on 10px independently before either used a token for it.

### Named Rules
**The Fluid-Only Rule.** Headings never get a fixed pixel size; every heading level is a `clamp()` that scales between phone and desktop. There is no separate "mobile type scale" to maintain.

## Layout

Single-column, sequential, mobile-first. There is no sidebar, no multi-column grid, no split view anywhere in the app — every screen is a vertically stacked list of cards inside a `max-w-3xl` (768px) centered container with `px-4 py-8`. Cards and sections stack with consistent rhythm (`space-y-3` for list items, `space-y-4`–`space-y-6` for larger sections). This holds even on desktop: the container simply centers with margin, it does not gain columns.

Mobile specifics: safe-area insets on all four edges (notches, PWA standalone bottom bar), scroll-snap on the conversation list, and every tappable element enforced at a 44px minimum height/width under `(pointer: coarse)`.

### Named Rules
**The Single Column Rule.** No screen in this app ever splits into side-by-side panels. A researcher reading one thing at a time, in order, is the entire interaction model — resist the urge to add a sidebar or a two-pane layout even on wide viewports.

## Elevation & Depth

Flat by default, no shadows anywhere in the codebase. Depth is conveyed entirely through tonal layering — night field → ink panel → ink panel raised — plus a 1px border at the panel's resting state. The only "elevation" gesture the system uses is a subtle background lightening (or a `scale(0.98)` press on touch) on interaction, never a shadow.

### Named Rules
**The Flat Field Rule.** Nothing casts a shadow. If a surface needs to read as "above" another, lighten it one tonal step instead.

## Shapes

- **xs (4px):** The smallest radius — checkbox squares, focus-ring outline.
- **sm (6px):** Compact chip-style buttons (quick-prompt presets).
- **md (8px):** The default control radius — buttons, textareas, the `.analysis-section` block, skeleton loaders.
- **lg (12px):** Cards — the system's signature radius, applied via the shared `.card` class to every panel in the app.
- **full:** Pills and badges — filter toggles, status chips ("analyzed," "saved," lens badges), the circular selection checkmark.

No decorative borders beyond the 1px panel border at rest; borders exist to delineate a container, never as ornament.

## Components

Every interactive component shares one behavior contract: `background` and `transform` transition at 0.1–0.15s, hover lightens the surface one tonal step (desktop), `:active` does the same plus a `scale(0.98)` press (touch), and `prefers-reduced-motion` strips the transition and the shimmer/spin animations entirely while keeping the state change itself.

### Buttons
- **Shape:** 8px radius (`rounded-lg`), 44px minimum height always.
- **Primary:** Copper Brand background, `slate-950` label (never white — see Colors), `font-medium`, used for the one primary action per screen (Run Custom Analysis, Generate Rollup). Lives as `BUTTON_PRIMARY` in `src/lib/ui.ts` so the brand colour has exactly one definition; call sites append only padding and layout.
- **Secondary:** one tonal step lighter than whatever surface it sits on, lightening one further step on hover — used for every non-primary action (Cancel, Refresh, Deselect All). On the page field this is Ink Panel background (`bg-slate-800`) → Ink Panel Raised on hover; **inside a `.card`, that step must shift down to `bg-slate-700` → `bg-slate-600`**, since a card's own background already *is* Ink Panel — a secondary button using `bg-slate-800` there is invisible at rest (confirmed bug, fixed across the toolbar, both confirm dialogs, and both quick-prompt-preset blocks: same-color-as-container, no shape until hovered). The rule is relative to the immediate surface, never a fixed class.
- **Parity Action:** for two or more independent, co-equal actions sharing one control (e.g. the selection toolbar's Group Thesis / Run ADHD — different actions, not a preference order), no button claims solid-fill copper at rest, since only one action per screen is allowed that mark under the One Ink Rule. All of them share one class and three tiers instead: flat slate with nothing selected; a copper-tinted **ready** wash (`border-cyan-500/50 bg-cyan-950/40 text-cyan-200`, `hover:` one step up) — the same wash `ConversationRow` uses for a selected item, not a new pattern — as soon as *anything* is selected, even if a given button's own minimum (Group Thesis needs 2, not 1) isn't met yet; and a solid-fill **full copper** flash on `:active`, so an actual tap still reads as a distinct, heavier moment than just having a selection ready. A button whose own minimum isn't met yet stays visually "ready" and tappable rather than disabled — its click handler no-ops instead (`if (selected.size < 2) return;`) — since the resting color's job is "there's a selection to act on," not "this specific action's exact threshold is satisfied"; the live count in the label (`Group Thesis (1)`) carries that nuance instead. Disabled state (nothing selected, or a batch already running) is `bg-slate-700` here, not `bg-slate-800` — this toolbar is itself a `.card` (Ink Panel), so the Secondary Button "shift one step inside a card" rule applies just as much to this variant.
- **Ghost/ text-link:** No background, `text-cyan-400` (remapped to light copper), underline on hover — used for low-emphasis actions inline in text ("Show all").
- **Disabled:** Background drops to a flat slate; Primary/Parity Action buttons swap to a flat color directly, Secondary/Ghost buttons reduce opacity instead — either way, no hover/press feedback. Which flat slate depends on the immediate surface (page field vs. inside a `.card`) — see the Secondary Button rule.

### Badges / Chips
- **Style:** Fully rounded (`rounded-full`), 10–12px text, a tinted background at ~15% opacity with a matching-hue 40%-opacity border (e.g. emerald wash + emerald border for "analyzed").
- **Use:** Status only — lens badges (T/A dots), "analyzed," "saved," "not yet," folder tags. Never used as a primary navigation or filter control (filter pills use a solid-fill pattern instead, see Navigation).

### Cards / Containers
- **Corner Style:** 12px (`.card`).
- **Background:** Ink Panel at rest, Ink Panel Raised on hover/active.
- **Shadow Strategy:** None — see Elevation & Depth.
- **Border:** 1px, Ink Panel Raised color at rest; shifts to a tinted accent border (copper/amber/sage/clay at ~30–50% opacity) to signal the card's semantic state (selected, custom-lens, error).
- **Internal Padding:** 16–24px (`p-4` to `p-6`), 32px for empty states.

### Inputs / Fields
- **Style:** Night Pasture background (recessed below the panel it sits in), 1px Ink Panel Raised border, 8px radius, placeholder in a dim graphite tone.
- **Focus:** Border shifts to the relevant accent color (amber for the custom-analysis textarea), plus the global 2px accent focus ring — no glow/shadow effect.

### Navigation
- Filter pills (All / Analyzed / Unanalyzed) use solid-fill selection: the active pill gets a full Copper Brand background and a slate-950 label, inactive pills stay Ink Panel with graphite text. This is the one place the system uses fill (not tint) for state, reserved for true single-select navigation.
- Primary in-page navigation (Daily Rollup, Refresh) sits as icon + label ghost buttons in the header, never a persistent nav bar or tab strip — the app has no chrome beyond what a given screen needs.

### Lens Badge (signature component)
A stacked pair of small rounded-full pills ("Thesis" / "ADHD") shown beside every conversation list item, each independently lit (emerald fill + border) or dim (flat slate) depending on whether that lens has run. Reads as plain words, not a coded glyph — a first-time reader doesn't need a tooltip to know what's been processed. This is the system's one custom-invented primitive — a status readout that lets the researcher scan a whole list at a glance.

### Calendar (month grid)
The primary day-browsing entry point on the conversations list. A 7-column Monday-first grid inside a `.card`. The selected day reuses the filter pills' solid-fill pattern (Copper Brand background, slate-950 label) — the same "true single-select navigation" rule, not a new one. Today gets a copper ring (`border-cyan-500/60`) independent of selection, so it stays identifiable even when browsing a different day. Days with conversations get a small graphite dot; days without get none — no shadow, no elevation, just the dot and the two copper treatments. Future dates render dimmed (Graphite, one step below the `text-slate-300` of past days) but stay clickable rather than disabled — simplicity over guarding an edge case that just resolves to an empty state. They are dimmed, not faded out: because they remain real controls, they hold the same AA-legible Graphite as any other muted text.

Collapsed to a one-line summary row by default (icon + selected day's label, chevron affordance) — the full grid would otherwise be the first thing painted on mobile, pushing that day's actual conversations below the fold. Tapping the row expands the grid; picking a day (or "Today") collapses it back automatically, so the grid never lingers once its job is done. The one exception: while group-select mode is active, picking a day does *not* collapse the grid, since batch-selecting across several days means jumping between them repeatedly — closing on every pick would fight that workflow. The month label doubles as a native `<input type="month">` (invisibly overlaid) for jumping distant months without a hand-built year picker.

## Do's and Don'ts

### Do:
- **Do** keep Copper Brand as the only color that means "primary" — see the One Ink Rule.
- **Do** convey elevation with tonal steps only, never a shadow — see the Flat Field Rule.
- **Do** keep every screen single-column inside the 768px container — see the Single Column Rule.
- **Do** enforce 44px minimum touch targets on every interactive element; this is used one-handed on a phone as often as on a desk.
- **Do** pair Verified Green and Alert Red with an icon or explicit text, never color alone.
- **Do** respect `prefers-reduced-motion` on every new animation, matching the existing shimmer/spin/scale-press pattern.

### Don't:
- **Don't** introduce a second accent color for "importance." A new primary action reuses Copper Brand; it does not get its own hue.
- **Don't** add gamified feedback — no streaks, confetti, progress badges, or celebratory copy. This is a research and executive-function tool, not an engagement product.
- **Don't** let the ADHD Aid surfaces drift toward a clinical/medical register (form-like labels, diagnostic tone, sterile whitespace). It should feel like the same field journal as the thesis lens, just a different page.
- **Don't** add a sidebar, tab bar, or multi-column layout, even on desktop. If a screen feels cramped, that's a signal to add a wizard step or collapse content — not to add a column.
- **Don't** use Amber Marginalia or Verified Green decoratively. They are reserved exactly for the custom-analysis lens and done/verified states, respectively.
