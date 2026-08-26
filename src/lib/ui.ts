// Shared control classes. Colour decisions live here rather than being
// retyped per route, so a brand change is one edit instead of eight.

// Primary action: bright cyan fill with a near-black label. This inverts the
// usual "white on a colored fill" pattern on purpose — TRACE's cyan is a light
// hue, so white on it tops out around 3.7:1 and fails AA, while slate-950 on
// cyan-400 clears 11.16:1 (and 13.92:1 on the cyan-300 hover). It also mirrors
// the logo's own bright-cyan-on-deep-navy contrast.
// The detector reads any `text-slate-*` on a colored fill as washed-out gray;
// slate-950 is near-black (#020617), so that finding is waived at each usage
// site with the measured ratio rather than rule-disabled globally.
export const BUTTON_PRIMARY =
  "bg-cyan-400 hover:bg-cyan-300 text-slate-950 disabled:bg-slate-700 disabled:text-slate-400 font-medium min-h-[44px] rounded-lg text-sm transition-colors"; // impeccable-disable-line gray-on-color

// Ghost action: the quiet icon+label (or text-only) control used for header
// navigation and low-emphasis actions — muted text on no fill, lifting to a
// panel wash on hover. The disabled styles are inert on elements that never
// disable, so links and buttons share the one string. Call sites append
// layout-only extras (flex-shrink-0, margins), never colors.
export const BUTTON_GHOST =
  "flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

// Secondary action on the page field: one tonal step above the background
// (Ink Panel), lightening one further step on hover — see DESIGN.md's
// Secondary Button rule. Call sites append layout-only extras
// (whitespace-nowrap, flex-shrink-0).
export const BUTTON_SECONDARY =
  "text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5";

// Secondary action inside a .card: the same rule shifted one step down
// (slate-700 → 600), since a card's own surface already is slate-800.
// Sized to pair beside `${BUTTON_PRIMARY} py-2 px-5` on error/empty cards.
export const BUTTON_SECONDARY_CARD =
  "bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center gap-1.5";

// The "← Back" link at the top of every sub-page.
export const LINK_BACK =
  "text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2";
