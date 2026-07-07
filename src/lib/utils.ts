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
