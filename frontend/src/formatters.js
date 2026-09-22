/**
 * Formatting utilities for tokens, currency, and numbers.
 */

export function formatShortNumber(num) {
  if (!num || isNaN(num)) return "0";
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  }
  return num.toString();
}

export function formatSpend(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "$0.00";
  const num = Number(amount);
  if (num <= 0) return "$0.00";
  if (num < 0.0001) return "<$0.0001";
  if (num < 0.01) return `$${num.toFixed(4)}`;
  if (num < 1) return `$${num.toFixed(3)}`;
  return `$${num.toFixed(2)}`;
}

export function formatExactSpend(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return "$0.00";
  const num = Number(amount);
  if (num === 0) return "$0.00";
  if (num < 0.00001) return `$${num.toFixed(6)}`;
  return `$${num.toFixed(5)}`;
}
