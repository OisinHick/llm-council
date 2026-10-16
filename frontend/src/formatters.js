/**
 * Formatting utilities for tokens, currency, and numbers.
 *
 * This module centralizes human-readable formatting routines across the frontend:
 * - `formatShortNumber`: Compact SI-style abbreviation for large token counts (e.g., "1.2k", "3.4M").
 * - `formatSpend`: Standard currency formatting with tiered precision based on magnitude.
 * - `formatExactSpend`: High-precision micro-dollar formatting (up to 6 decimal places) for
 *   fine-grained per-token rates and tool execution costs.
 */

/**
 * Format large token and count values into compact human-readable strings (e.g. 1.5k, 2.3M).
 *
 * Rules:
 * - >= 1,000,000: Represented in millions with 'M' suffix (e.g. 1,500,000 -> "1.5M").
 * - >= 1,000: Represented in thousands with 'k' suffix (e.g. 2,400 -> "2.4k").
 * - Trailing '.0' decimals are stripped (e.g. 1,000,000 -> "1M" instead of "1.0M").
 * - < 1,000: Exact string representation without suffixes.
 * - Falsy or non-numeric values gracefully default to "0".
 *
 * @param {number|string|null|undefined} num - Value to format.
 * @returns {string} Formatted compact count string.
 */
export function formatShortNumber(num) {
  if (!num || isNaN(num)) return "0";
  const n = Number(num);
  if (n >= 1_000_000) {
    return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (n >= 1_000) {
    return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return n.toString();
}

/**
 * Format dollar spend estimates with tiered precision depending on magnitude.
 *
 * Tiering strategy:
 * - Null, undefined, or non-numeric: "$0.00"
 * - Values <= 0: "$0.00"
 * - Sub-cent micro spend (< $0.0001): "<$0.0001"
 * - Small micro spend (< $0.01): 4 decimal places (e.g., "$0.0042")
 * - Cents range (< $1.00): 3 decimal places (e.g., "$0.385")
 * - Standard dollar range (>= $1.00): 2 decimal places (e.g., "$12.45")
 *
 * @param {number|string|null|undefined} amount - Dollar amount to format.
 * @returns {string} Formatted currency string with appropriate tier precision.
 */
export function formatSpend(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "$0.00";
  const num = Number(amount);
  if (num <= 0) return "$0.00";
  if (num < 0.0001) return "<$0.0001";
  if (num < 0.01) return `$${num.toFixed(4)}`;
  if (num < 1) return `$${num.toFixed(3)}`;
  return `$${num.toFixed(2)}`;
}

/**
 * Format high-precision dollar spend values with up to 6 decimal digits.
 * Useful for micro-cent tool spend and model rates where sub-cent precision is critical.
 *
 * Rules:
 * - Falsy, non-numeric, or zero: "$0.00"
 * - Micro-cent (< $0.00001): 6 decimal digits (e.g., "$0.000008")
 * - Standard high-precision: 5 decimal digits (e.g., "$0.00125")
 *
 * @param {number|string|null|undefined} amount - Dollar amount.
 * @returns {string} High-precision formatted currency string.
 */
export function formatExactSpend(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "$0.00";
  const num = Number(amount);
  if (num === 0) return "$0.00";
  if (num < 0.00001) return `$${num.toFixed(6)}`;
  return `$${num.toFixed(5)}`;
}
