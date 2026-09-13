// Shared control classes — the survey-blue topo palette. globals.css remaps
// Tailwind's cyan scale to USGS survey blue, so `bg-cyan-400` renders #5b9bd5.

export const BUTTON_PRIMARY =
  "bg-cyan-400 hover:bg-cyan-300 text-slate-950 disabled:bg-slate-700 disabled:text-slate-400 font-medium min-h-[44px] rounded-lg text-sm transition-colors"; // impeccable-disable-line gray-on-color

export const BUTTON_GHOST =
  "flex items-center gap-1.5 text-sm min-h-[44px] px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

export const BUTTON_SECONDARY =
  "text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 min-h-[44px] rounded-lg transition-colors inline-flex items-center gap-1.5";

export const BUTTON_SECONDARY_CARD =
  "bg-slate-700 hover:bg-slate-600 text-slate-200 font-medium py-2 px-5 min-h-[44px] rounded-lg text-sm transition-colors inline-flex items-center gap-1.5";

export const LINK_BACK =
  "text-slate-400 hover:text-white text-sm mb-6 inline-flex items-center gap-1.5 min-h-[44px] py-2";

// SWITCH pills — solid survey-blue fill for true navigation selections.
export const PILL_SWITCH_ON = "bg-cyan-400 text-slate-950"; // impeccable-disable-line gray-on-color
export const PILL_SWITCH_OFF = "bg-slate-800 text-slate-300 hover:text-white";
export const PILL_SWITCH_OFF_TRACK = "text-slate-300 hover:text-white";

// REFINE pills — blue tint wash for list-narrowing filters.
export const PILL_REFINE_ON = "border border-cyan-500/50 bg-cyan-950/40 text-cyan-200";
export const PILL_REFINE_OFF = "bg-slate-800 text-slate-300 hover:text-white";

export function optionLabel(name: string): string {
  return name.length > 48 ? `${name.slice(0, 47)}…` : name;
}
