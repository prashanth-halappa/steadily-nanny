// Force a negative-UTC-offset timezone so the "yyyy-MM-dd" UTC-parse bug
// reproduces deterministically regardless of the machine/CI timezone — bun's
// test runner otherwise defaults to UTC, where the bug can't be observed. Must
// run before any Date usage in this file.
process.env.TZ = 'America/New_York';

import { describe, expect, it } from 'bun:test';
import {
  formatDateLong,
  formatDateShort,
  formatMonthYear,
  formatRelativeTime,
} from '../dateFormatting';
import { parseDateOnlyLocal } from '../parseDateOnlyLocal';

/** Build an ISO string for a local-timezone date at noon (DST/UTC safe). */
function localNoonIso(year: number, monthIndex: number, day: number): string {
  return new Date(year, monthIndex, day, 12).toISOString();
}

/** Build an ISO string for a moment N hours before now. */
function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

describe('formatDateShort', () => {
  it('formats as "MMM D"', () => {
    expect(formatDateShort(localNoonIso(2026, 0, 15))).toBe('Jan 15');
  });

  it('formats single-digit days without padding', () => {
    expect(formatDateShort(localNoonIso(2025, 10, 5))).toBe('Nov 5');
  });
});

describe('formatDateLong', () => {
  it('formats as "MMM D, YYYY"', () => {
    expect(formatDateLong(localNoonIso(2026, 0, 15))).toBe('Jan 15, 2026');
  });

  it('formats a date from a different year', () => {
    expect(formatDateLong(localNoonIso(2025, 11, 3))).toBe('Dec 3, 2025');
  });
});

describe('formatMonthYear', () => {
  it('formats as "MMM YYYY"', () => {
    expect(formatMonthYear(localNoonIso(2025, 10, 20))).toBe('Nov 2025');
  });

  it('formats January correctly', () => {
    expect(formatMonthYear(localNoonIso(2026, 0, 1))).toBe('Jan 2026');
  });
});

describe('date-only ("yyyy-MM-dd") input', () => {
  // `new Date('yyyy-MM-dd')` parses as UTC midnight, which is the previous
  // calendar day in any negative-UTC-offset timezone. These assertions are
  // built from parseDateOnlyLocal — the correct local-midnight reference — so
  // they fail under UTC-parsing regardless of the host's own timezone.
  const dateOnly = '2026-06-29';
  const localReference = parseDateOnlyLocal(dateOnly);
  const expectedDay = localReference.getDate();
  const expectedMonth = localReference.toLocaleDateString('en-US', {
    month: 'short',
  });
  const expectedYear = localReference.getFullYear();

  it('formatDateShort reads the date-only string as the local calendar day', () => {
    expect(formatDateShort(dateOnly)).toBe(`${expectedMonth} ${expectedDay}`);
  });

  it('formatDateLong reads the date-only string as the local calendar day', () => {
    expect(formatDateLong(dateOnly)).toBe(
      `${expectedMonth} ${expectedDay}, ${expectedYear}`
    );
  });

  it('formatMonthYear reads the date-only string as the local calendar month', () => {
    // Pick the 1st of a month so a UTC-parse day-shift also flips the month.
    const monthBoundary = '2026-07-01';
    const monthBoundaryReference = parseDateOnlyLocal(monthBoundary);
    const monthLabel = monthBoundaryReference.toLocaleDateString('en-US', {
      month: 'short',
    });
    expect(formatMonthYear(monthBoundary)).toBe(
      `${monthLabel} ${monthBoundaryReference.getFullYear()}`
    );
  });
});

describe('formatRelativeTime', () => {
  it('returns "Today" for the current moment', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('Today');
  });

  it('returns "Today" for less than 24 hours ago', () => {
    expect(formatRelativeTime(hoursAgoIso(23))).toBe('Today');
  });

  it('returns "Yesterday" just past the 24-hour boundary', () => {
    expect(formatRelativeTime(hoursAgoIso(24))).toBe('Yesterday');
  });

  it('returns "Yesterday" for up to 48 hours ago', () => {
    expect(formatRelativeTime(hoursAgoIso(47))).toBe('Yesterday');
  });

  it('returns "N days ago" for 2-6 days ago', () => {
    expect(formatRelativeTime(hoursAgoIso(3 * 24))).toBe('3 days ago');
    expect(formatRelativeTime(hoursAgoIso(6 * 24))).toBe('6 days ago');
  });

  it('returns "1 week ago" for 7-13 days ago', () => {
    expect(formatRelativeTime(hoursAgoIso(7 * 24))).toBe('1 week ago');
    expect(formatRelativeTime(hoursAgoIso(13 * 24))).toBe('1 week ago');
  });

  it('returns "2 weeks ago" for 14-20 days ago', () => {
    expect(formatRelativeTime(hoursAgoIso(14 * 24))).toBe('2 weeks ago');
    expect(formatRelativeTime(hoursAgoIso(20 * 24))).toBe('2 weeks ago');
  });

  it('falls back to "MMM D" for 21+ days ago', () => {
    const input = hoursAgoIso(30 * 24);
    expect(formatRelativeTime(input)).toBe(formatDateShort(input));
  });
});
