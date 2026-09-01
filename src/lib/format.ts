"use client";

// Date formatting that survives missing/garbage timestamps from the API —
// never renders "Invalid Date" and never throws.

export function formatDateTime(
  value: string | undefined | null,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }
): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return date.toLocaleDateString("en-GB", options);
}

/** The calendar day (YYYY-MM-DD) a timestamp belongs to — the ISO date
 *  portion taken directly, matching how conversations are already grouped
 *  by day everywhere in this app (Daily Rollup, and the calendar view). */
export function dayOf(iso: string): string {
  return iso.length >= 10 ? iso.split("T")[0] : "unknown-date";
}

// Both helpers anchor at noon, not midnight — the same convention already
// used across this codebase (e.g. rollup/page.tsx's
// `formatDateTime(\`${day}T12:00:00\`, ...)`) so a date-only string never
// shifts to the adjacent day from a DST transition or timezone parsing edge.
// Output is built from local getFullYear/getMonth/getDate, never
// toISOString(), so the result stays in local time throughout — going
// through toISOString would reintroduce the exact UTC-conversion edge this
// is avoiding.
function toDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** The Monday (YYYY-MM-DD) of the calendar week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00`);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toDayString(d);
}

/** `day` shifted by `n` days (negative moves backward). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + n);
  return toDayString(d);
}

/**
 * Clock time only.
 *
 * `formatDateTime` goes through `toLocaleDateString`, which still emits the
 * date portion even when the options ask for nothing but hour and minute — so
 * a per-row timestamp on a page already scoped to one day repeated that day's
 * date on every row. This is for lists where the date is established by the
 * surrounding context and only the time distinguishes the items.
 */
export function formatTime(value: string | undefined | null): string {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}
