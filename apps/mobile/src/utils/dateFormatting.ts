/**
 * Shared date-formatting utilities.
 *
 * All formatters use the en-US locale and the device's local timezone. Date-only
 * inputs ('yyyy-MM-dd') are read as the LOCAL calendar day (see
 * `parseDateOnlyLocal`) rather than UTC midnight, which would shift back a day in
 * negative-UTC-offset timezones.
 */

import { parseDateOnlyLocal } from './parseDateOnlyLocal';

// Matches a date-only value ('yyyy-MM-dd') with no time component.
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses an input date string, reading date-only values ('yyyy-MM-dd') as a
 * LOCAL calendar day rather than UTC midnight. Full ISO timestamps keep their
 * native parsing.
 */
function parseInputDate(dateStr: string): Date {
  return DATE_ONLY_PATTERN.test(dateStr)
    ? parseDateOnlyLocal(dateStr)
    : new Date(dateStr);
}

/**
 * Format an ISO date string as "MMM D" (e.g., "Jan 15").
 */
export function formatDateShort(isoDate: string): string {
  return parseInputDate(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format an ISO date string as "MMM D, YYYY" (e.g., "Jan 15, 2026").
 * Returns the input unchanged if formatting throws.
 */
export function formatDateLong(isoDate: string): string {
  try {
    const date = parseInputDate(isoDate);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

/**
 * Format an ISO date string as "MMM YYYY" (e.g., "Nov 2025").
 */
export function formatMonthYear(isoDate: string): string {
  const date = parseInputDate(isoDate);
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  return `${month} ${year}`;
}

/**
 * Format an ISO date string as relative time:
 * "Today", "Yesterday", "N days ago", "1 week ago", "2 weeks ago",
 * then falls back to "MMM D" for anything 3+ weeks old.
 *
 * Thresholds are based on elapsed 24-hour periods (not calendar days).
 */
export function formatRelativeTime(dateString: string): string {
  const date = parseInputDate(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else if (diffDays < 14) {
    return '1 week ago';
  } else if (diffDays < 21) {
    return '2 weeks ago';
  } else {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }
}
