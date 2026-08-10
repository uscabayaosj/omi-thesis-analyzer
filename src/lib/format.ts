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
