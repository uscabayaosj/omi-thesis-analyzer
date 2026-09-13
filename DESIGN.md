---
name: TRACE
description: A survey-map instrument for turning Omi wearable recordings into thesis evidence and daily executive-function structure.
colors:
  forest-ground: "#0b110e"
  survey-panel: "#141e18"
  survey-panel-raised: "#1c2a22"
  contour-cream: "#ddd6c4"
  survey-blue: "#4a8dc8"
  survey-blue-light: "#5b9bd5"
  survey-blue-deep: "#3a78b4"
  section-gray: "#8a9f8e"
  contour-brown: "#8a7558"
  vegetation-green: "#7eb868"
  topo-red: "#c44536"
  amber-marker: "#e8b84e"
typography:
  display:
    fontFamily: "'Barlow', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.5rem, 4vw, 2.25rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "'Barlow', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.15rem, 3vw, 1.5rem)"
    fontWeight: 600
    lineHeight: 1.25
  title:
    fontFamily: "'Barlow', ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1rem, 2.5vw, 1.25rem)"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.7
  subtitle:
    fontFamily: "'Barlow', ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.95rem"
    fontWeight: 400
    fontStyle: "italic"
    lineHeight: 1.5
  label:
    fontFamily: "ui-monospace, SFMono-Regular, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.14em"
    textTransform: "uppercase"
  micro:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.survey-blue-light}"
    textColor: "{colors.forest-ground}"
    rounded: "{rounded.md}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "#7bb3e8"
  button-secondary:
    backgroundColor: "#1a2620"
    textColor: "{colors.contour-cream}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary-hover:
    backgroundColor: "#24332b"
  pill-switch-on:
    backgroundColor: "{colors.survey-blue-light}"
    textColor: "{colors.forest-ground}"
    rounded: "{rounded.full}"
  pill-refine-on:
    backgroundColor: "rgba(12, 26, 46, 0.4)"
    textColor: "#a3cdf0"
    rounded: "{rounded.full}"
  card:
    backgroundColor: "{colors.survey-panel}"
    rounded: "{rounded.lg}"
    padding: "20px"
---

# Design System: TRACE

## Overview

**Creative North Star: "The Survey Map"**

This is a researcher's field instrument, not a productivity app performing for engagement. Every screen reads as a page from a geological survey — precise, institutional, legible under dim field conditions. The palette draws from USGS topographic maps: a dark forest ground replaces the daylight paper of the original, but the color vocabulary is the same one Montana ranchers read daily: blue for primary features, green for vegetation and verified states, red for cultural features and alerts, brown for contour lines and elevation metadata. The section grid on the page ground is the one material signature: it places every screen on a surveyed field rather than in a generic dark container.

Barlow carries the heading voice — a geometric grotesk with the institutional precision of survey-plate lettering, loaded through `next/font/google` and self-hosted for offline PWA use. Body text stays system sans for native rendering of dense generated prose.

**Key Characteristics:**
- Single dark surface family (forest ground → survey panel → survey panel raised), dark-only
- One accent color carries all "primary/active/interactive" meaning: survey blue
- Flat by default — depth comes from tonal layering, not shadows
- Section grid on the page ground (160px repeating linear gradient)
- Every interactive target at least 44px; this is a phone-in-pocket tool
- Station numbers on conversation list entries, reading as a survey log
- No eyebrows or kickers above headings — the heading carries its own weight

## Colors

The palette is a narrow, cool-toned stack: one forest-dark ground, one panel color one step lighter, one institutional blue accent, and three single-purpose signal colors.

### Primary
- **Survey Blue** (`#4a8dc8`): The one color that means "primary, active, or interactive" — primary buttons, active filter pills, selected-item borders, links, focus rings, map pins. Used sparingly against the dark field so it reads as a survey marker, not a wash. The lighter step (`#5b9bd5`) fills active surfaces; the deeper step (`#3a78b4`) anchors the TraceMark icon gradient.

### Neutral
- **Forest Ground** (`#0b110e`): The page background. Very dark with a green tint — the topo map field seen under dim conditions, not warm brown and not pure black.
- **Survey Panel** (`#141e18`): The card/panel surface, one tonal step above the field.
- **Survey Panel, Raised** (`#1c2a22`): The hover/pressed state for panels, and the border hover color.
- **Contour Cream** (`#ddd6c4`): Primary text color. Named for the warm buff of topo-map contour lines and annotation.
- **Section Gray** (`#8a9f8e`): Muted/secondary text — timestamps, helper copy, placeholders. Clears 4.5:1 against both Forest Ground and Survey Panel.
- **Contour Brown** (`#8a7558`): Placeholder text and tertiary metadata — the color of contour elevation numbers on a topo map.

### Named Rules
**The One Accent Rule.** Survey Blue is the only color allowed to mean "primary." If a second element needs to look important, it gets weight, size, or position instead.

**The Grid Ground Rule.** The section grid on the page background is the world's signature material. It stays visible on the page field and disappears on panel surfaces.

### Signal Colors (single-purpose, not decorative)
- **Amber Marker** (`#e8b84e`): Reserved for the Custom Analysis lens — its icon, heading, and active border.
- **Vegetation Green** (`#7eb868`): Reserved for "done" and "verified" states. Always paired with a checkmark or status text.
- **Topo Red** (`#c44536`): Errors only. Always paired with a warning icon and explanatory text.

## Typography

**Display Font:** Barlow, loaded through `next/font/google` and exposed as `--font-barlow` / `--font-survey`. A geometric grotesk with the institutional precision of survey-plate lettering.

**Body Font:** System sans (`ui-sans-serif, system-ui, -apple-system`) — native rendering for dense generated prose.

**Label Font:** System mono (`ui-monospace, SFMono-Regular`) — timestamps, datelines, station metadata, traverse designations.

**Character:** Institutional and precise. The type system makes dense structured output scannable at a glance.

### Hierarchy
- **Display** (700, `clamp(1.5rem, 4vw, 2.25rem)`, 1.2): Page-level `h1` only.
- **Headline** (600, `clamp(1.15rem, 3vw, 1.5rem)`, 1.25): `h2`, section headings.
- **Title** (600, `clamp(1rem, 2.5vw, 1.25rem)`, 1.3): `h3`, analysis-block headings.
- **Subtitle** (400 italic, 0.95rem/15.2px, 1.5): The one-line gloss under a page heading — what this screen is or what a list shows. Italic Barlow because it's the system's aside about its content.
- **Body** (400, 0.875rem/14px, 1.7): Analysis prose and card copy.
- **Label** (500, 0.6875rem/11px mono, uppercase, 0.14em tracking): Datelines, traverse designations, timestamps.
- **Micro** (600, 0.625rem/10px sans, 1): Single glyph inside compact circular badges (lens dots, dimension markers).

### Named Rules
**The Fluid-Only Rule.** Headings never get a fixed pixel size; every heading level is a `clamp()` that scales between phone and desktop.

## Layout

Single-column, sequential, mobile-first. No sidebar, no multi-column grid — every screen is a vertically stacked list inside `max-w-3xl` (768px) centered with `px-4 py-8`. Cards stack with `space-y-3` for list items, `space-y-4` to `space-y-6` for larger sections.

Mobile: safe-area insets on all four edges, every tappable element at 44px minimum height/width under `(pointer: coarse)`.

## Elevation & Depth

Flat by default, no shadows. Depth is conveyed through tonal layering — forest ground → survey panel → survey panel raised — plus a 1px border at rest.

### Named Rules
**The Flat Field Rule.** Nothing casts a shadow. If a surface needs to read as "above" another, lighten it one tonal step.

## Shapes

- **sm (6px):** Compact chip-style buttons.
- **md (8px):** Default control radius — buttons, textareas, skeleton loaders.
- **lg (10px):** Cards — the system's signature radius, applied via `.card`.
- **full:** Pills and badges — filter toggles, status chips, lens badges.

No decorative borders beyond the 1px panel border at rest.

## Components

Every interactive component shares one behavior contract: `background` and `transform` transition at 100–150ms, hover lightens one tonal step, `:active` adds `scale(0.97)`, and `prefers-reduced-motion` strips transforms.

### Buttons
- **Shape:** 8px radius, 44px minimum height.
- **Primary:** Survey Blue Light fill, Forest Ground text. Lives as `BUTTON_PRIMARY` in `src/lib/ui.ts`.
- **Secondary:** One tonal step above the immediate surface.
- **Ghost:** No background, muted text, panel wash on hover.
- **Disabled:** Flat slate, no hover/press feedback.

### Badges / Chips
- **Style:** Fully rounded, 10–12px text, tinted background with matching-hue border.
- **Use:** Status only — lens badges, "analyzed," "saved," folder tags.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Survey Panel at rest, Survey Panel Raised on hover.
- **Shadow Strategy:** None.
- **Border:** 1px, `#24332b` at rest.

### Inputs / Fields
- **Style:** Forest Ground background (recessed below panel), 1px border, 8px radius.
- **Focus:** Border shifts to accent, plus 2px outline at 2px offset.
- **Caret:** Survey Blue Light.

### Navigation
- **Switch** (solid Survey Blue fill): Changes what you look at — filter pills, lens toggles, view modes.
- **Refine** (blue tint wash): Narrows within a list — age/direction filters, section chips.

### Station Numbers (signature component)
Small monospace numerals (11px, `tabular-nums`) in the left margin of each conversation entry. Muted (`text-slate-500`) so they orient without competing with the entry title.

### Map (Leaflet)
Dark basemap via CSS filter on `.leaflet-tile-pane`. Pins differentiated by shape (round = meeting, diamond = named place), both in survey blue. Popups re-grounded on Survey Panel.

## Do's and Don'ts

### Do:
- **Do** keep Survey Blue as the only color meaning "primary."
- **Do** convey elevation with tonal steps only, never shadows.
- **Do** keep every screen single-column inside the 768px container.
- **Do** enforce 44px minimum touch targets on every interactive element.
- **Do** pair Vegetation Green and Topo Red with an icon or text, never color alone.

### Don't:
- **Don't** introduce a second accent color for "importance."
- **Don't** add eyebrows or kickers above headings — they are banned.
- **Don't** add a sidebar, tab bar, or multi-column layout.
- **Don't** use Amber Marker or Vegetation Green decoratively.
- **Don't** add gamified feedback — no streaks, confetti, or celebratory copy.
- **Don't** add shadows or box-shadow effects.
