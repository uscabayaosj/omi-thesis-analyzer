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
