// Shared control classes. Colour decisions live here rather than being
// retyped per route, so a brand change is one edit instead of eight.

// Primary action: copper fill with a near-black label. (The class names still
// read `cyan-*`; globals.css remaps that whole scale to branding-iron copper,
// so `bg-cyan-400` renders #d99a5e.) This inverts the usual "white on a
// colored fill" pattern on purpose — the copper is a light hue, so warm-white
// on it tops out around 3.7:1 and fails AA, while slate-950 on cyan-400 clears
// 7.87:1 (and 10.51:1 on the cyan-300 hover). It mirrors the logo's own
// bright-mark-on-dark-leather contrast.
// The detector reads any `text-slate-*` on a colored fill as washed-out gray;
// slate-950 is near-black (#14100d), so that finding is waived at each usage
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

/* ── Single-select pills ──
 *
 * One interaction — "pick exactly one of these" — had grown three visual
 * dialects: solid copper fill (home filter pills, the conversation lens
 * toggle), a copper tint wash (the commitments filters, SectionNav), and on
 * /people's view switcher a plain grey step with no copper at all. The last of
 * those was the real defect: `bg-slate-800 → bg-slate-700` is roughly a 1.1:1
 * change, which made the weakest selected-state in the app land on its most
 * modal screen.
 *
 * The two surviving treatments are kept, because they are doing different
 * jobs — but the difference is now named rather than incidental:
 *
 *   SWITCH  (solid copper fill) — changes *what you are looking at*. The
 *           choices are mutually exclusive and one is always active: the home
 *           filter pills, the Thesis/ADHD/Both lens toggle, /people's view
 *           modes, the calendar's selected day. Solid fill is what DESIGN.md
 *           reserves for true single-select navigation, and this is it.
 *
 *   REFINE  (copper tint wash) — narrows a list that is already on screen, or
 *           jumps within it. The page does not change identity: the commitments
 *           age/direction filters, SectionNav's section chips. A tint reads as
 *           an adjustment; a fill would over-claim.
 *
 * Both keep the One Ink Rule — copper is still the only colour meaning
 * "active" — and neither introduces a second hue.
 */

// SWITCH, selected. slate-950 on cyan-400 is 7.87:1; the branch this pairs
// against carries its own colour, so the detector's cross-branch reading of the
// ternary is a false positive.
export const PILL_SWITCH_ON = "bg-cyan-400 text-slate-950"; // impeccable-disable-line gray-on-color

// SWITCH, unselected, sitting directly on the page field.
export const PILL_SWITCH_OFF = "bg-slate-800 text-slate-300 hover:text-white";

// SWITCH, unselected, sitting inside a segmented track that is itself
// slate-800 — the track supplies the fill, so the pill must not repeat it.
export const PILL_SWITCH_OFF_TRACK = "text-slate-300 hover:text-white";

// REFINE, selected / unselected.
export const PILL_REFINE_ON = "border border-cyan-500/50 bg-cyan-950/40 text-cyan-200";
export const PILL_REFINE_OFF = "bg-slate-800 text-slate-300 hover:text-white";
