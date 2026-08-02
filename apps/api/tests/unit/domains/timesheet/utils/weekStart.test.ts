/**
 * Written BEFORE the implementation exists (TDD red-first). Pure function,
 * no mocks needed. Weeks start MONDAY (en-GB), computed in the household's
 * timezone — get this wrong and every weekly total is misfiled, so this
 * exercises both a Sunday and a Monday, plus cases where the UTC calendar
 * date and the household's local calendar date actually disagree (the whole
 * reason this can't just truncate a UTC Date).
 *
 * @module tests/unit/domains/timesheet/utils/weekStart
 */
import { describe, expect, it } from 'bun:test';
import {
  weekEndExclusive,
  weekStartOf,
} from '../../../../../src/domains/timesheet/utils/weekStart';

describe('weekStartOf', () => {
  it('returns the same date for an instant that is already a Monday, in a timezone matching UTC', () => {
    // 2026-08-03T10:00:00Z is a Monday.
    expect(weekStartOf(new Date('2026-08-03T10:00:00.000Z'), 'UTC')).toBe(
      '2026-08-03'
    );
  });

  it('returns the preceding Monday for an instant that is a Sunday, in a timezone matching UTC', () => {
    // 2026-08-09T10:00:00Z is a Sunday; the household's week started 2026-08-03.
    expect(weekStartOf(new Date('2026-08-09T10:00:00.000Z'), 'UTC')).toBe(
      '2026-08-03'
    );
  });

  it('uses the LOCAL calendar date, not UTC: a UTC-Sunday instant that is already Monday in a timezone ahead of UTC', () => {
    // 2026-08-02T23:30:00Z is Sunday in UTC, but 2026-08-03T11:30 NZST
    // (Pacific/Auckland, UTC+12 in August) — already Monday locally, so the
    // week start IS that date, not the Monday before.
    expect(
      weekStartOf(new Date('2026-08-02T23:30:00.000Z'), 'Pacific/Auckland')
    ).toBe('2026-08-03');
  });

  it('uses the LOCAL calendar date, not UTC: a UTC-Monday instant that is still Sunday in a timezone behind UTC', () => {
    // 2026-08-03T01:30:00Z is Monday in UTC, but 2026-08-02T18:30 PDT
    // (America/Los_Angeles, UTC-7 in August) — still Sunday locally, so the
    // week start is the PRECEDING Monday, not the UTC date's Monday.
    expect(
      weekStartOf(new Date('2026-08-03T01:30:00.000Z'), 'America/Los_Angeles')
    ).toBe('2026-07-27');
  });
});

describe('weekEndExclusive', () => {
  it('returns the Monday exactly 7 days after weekStart', () => {
    expect(weekEndExclusive('2026-08-03')).toBe('2026-08-10');
  });

  it('crosses a month boundary correctly', () => {
    expect(weekEndExclusive('2026-08-31')).toBe('2026-09-07');
  });

  it('crosses a year boundary correctly', () => {
    expect(weekEndExclusive('2025-12-29')).toBe('2026-01-05');
  });
});
