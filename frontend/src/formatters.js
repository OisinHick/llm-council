/**
 * Formatting utilities for tokens, currency, and numbers.
 */

/**
 * Format large token and count values into compact human-readable strings (e.g. 1.5k, 2.3M).
 *
 * @param {number|string} num - Value to format
 * @returns {string} Formatted compact count
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
 * Format dollar spend estimates with tiered precision depending on magnitude:
 * - <= 0: "$0.00"
 * - < 0.0001: "<$0.0001"
 * - < 0.01: 4 decimal places
 * - < 1: 3 decimal places
 * - >= 1: 2 decimal places
 *
 * @param {number|string|null|undefined} amount - Dollar amount
 * @returns {string} Formatted currency string
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
 * Useful for micro-cent tool spend and model rates.
 *
 * @param {number|string|null|undefined} amount - Dollar amount
 * @returns {string} High-precision formatted currency string
 */
export function formatExactSpend(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "$0.00";
  const num = Number(amount);
  if (num === 0) return "$0.00";
  if (num < 0.00001) return `$${num.toFixed(6)}`;
  return `$${num.toFixed(5)}`;
}
