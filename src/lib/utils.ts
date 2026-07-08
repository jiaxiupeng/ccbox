import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a token count compactly, e.g. 12300 -> "12.3k". */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format a cost value with a currency symbol. */
export function formatCost(n: number, currency = "¥"): string {
  if (n === 0) return "0";
  if (n < 0.01) return `${currency}${n.toFixed(4)}`;
  return `${currency}${n.toFixed(2)}`;
}

/** Format a CNY cost. Pricing is now stored natively in CNY/M tokens, so no
 *  currency conversion is applied. */
export function formatCNY(cny: number): string {
  return formatCost(cny, "¥");
}

/**
 * The timezone the backend buckets usage in (UTC+8, Beijing). Mirrors
 * `TZ_OFFSET_HOURS` in usage_service.rs — keep them in sync. Claude Code logs
 * store UTC timestamps; the backend shifts +8 before bucketing, so every date
 * key in `byDay` / `byModelDay` / `hourDate` is a Beijing calendar date. The
 * frontend MUST compute today / this-week / this-month boundaries in the same
 * timezone, otherwise (e.g. at 02:00 Beijing = 18:00 UTC the previous day) the
 * filters silently drop today's rows and the numbers under-count.
 */
const TZ_OFFSET_MS = 8 * 3600_000;

/** "YYYY-MM-DD" for `epochMs` in UTC+8. Defaults to now. Pass an epoch-ms to
 *  offset day-by-day (`utc8DaysAgo`) without drifting — the +8 offset has no
 *  DST, so pure-ms arithmetic stays exact. */
export function utc8Ymd(epochMs: number = Date.now()): string {
  // toISOString reads UTC; we've pre-shifted by +8 so the UTC fields ARE the
  // Beijing fields.
  return new Date(epochMs + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM" (current Beijing month). Used for the month-view prefix so the
 *  1st of the month is correctly included even at 00:30 Beijing (= 16:30 UTC
 *  the previous day). */
export function utc8YearMonth(): string {
  return utc8Ymd().slice(0, 7);
}

/** `n` days before today (Beijing) as "YYYY-MM-DD". n=0 is today. */
export function utc8DaysAgo(n: number): string {
  return utc8Ymd(Date.now() - n * 86400_000);
}

/** Whether a date string "YYYY-MM-DD" is within the last `n` days inclusive of
 *  today, measured in Beijing time. */
export function isWithinLastDaysUtc8(date: string, n: number): boolean {
  return date >= utc8DaysAgo(n - 1);
}

/** Beijing day-of-week (0=Sun..6=Sat) for a "YYYY-MM-DD" string, for heatmap
 *  column alignment. Parses the string as a wall-clock calendar date (not as a
 *  UTC-midnight instant) so the weekday is the calendar weekday regardless of
 *  the viewer's own timezone. */
export function utc8Weekday(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
