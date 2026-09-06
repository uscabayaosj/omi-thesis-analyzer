"use client";

// Date formatting that survives missing/garbage timestamps from the API —
// never renders "Invalid Date" and never throws.

const DEFAULT_DATE_TIME: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

// `toLocaleDateString` builds a fresh Intl.DateTimeFormat on every call, and
// constructing one is the expensive part (locale data lookup, ~0.1 ms). A
// day's list formats a timestamp per row and the calendar formats one per
// cell per render, so the same handful of option sets were being rebuilt a
// few hundred times per paint. Formatters are immutable, so keep one per
// option set and reuse it.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = JSON.stringify(options);
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", options);
    formatters.set(key, f);
  }
  return f;
}

export function formatDateTime(
  value: string | undefined | null,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME
): string {
  if (!value) return "Unknown date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown date";
  return formatterFor(options).format(date);
}

/**
 * The calendar day (YYYY-MM-DD) a timestamp belongs to, in the device's own
 * timezone.
 *
 * This used to take the ISO string's date portion — the UTC day. For a user
 * in Montana that filed every conversation after 6 pm under tomorrow, and in
 * Manila it filed every morning conversation under yesterday, so the daily
 * rollup, the calendar, and the "· Today" dateline all disagreed with the
 * clock on the wall. Every screen that groups by day goes through here, so
 * they move together; rollups made under the old rule keep their keys, and a
 * day whose membership shifted simply reports the newcomer as a late arrival.
 *
 * A bare date (no time) is returned as-is: parsing it would read as UTC
 * midnight and could land a day early west of Greenwich.
 */
export function dayOf(iso: string): string {
  if (typeof iso !== "string" || iso.length < 10) return "unknown-date";
  if (iso.length === 10) return iso;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown-date";
  return toDayString(d);
}

/** Today's calendar day (YYYY-MM-DD), local time. */
export function todayString(): string {
  return toDayString(new Date());
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
  return formatterFor(TIME_ONLY).format(date);
}

const TIME_ONLY: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
