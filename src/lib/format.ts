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
