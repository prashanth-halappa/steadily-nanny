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
  weekStartOfLocalDate,
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

// Phase 3/4 review, SERIOUS 6: an expense's `local_date` is ALREADY a
// household-local calendar date, so mapping it to its week needs pure date
// arithmetic and no timezone at all — passing it through `weekStartOf` would
// mean inventing an instant and a zone, the classic way a date slips a day.
describe('weekStartOfLocalDate', () => {
  it('returns a Monday unchanged', () => {
    expect(weekStartOfLocalDate('2026-08-03')).toBe('2026-08-03');
  });

  it('maps a mid-week date to its Monday', () => {
    expect(weekStartOfLocalDate('2026-08-06')).toBe('2026-08-03');
  });

  it('maps SUNDAY back to the Monday that started its week, never forward', () => {
    expect(weekStartOfLocalDate('2026-08-09')).toBe('2026-08-03');
  });

  it('crosses a month boundary', () => {
    expect(weekStartOfLocalDate('2026-09-01')).toBe('2026-08-31');
  });

  it('crosses a year boundary', () => {
    expect(weekStartOfLocalDate('2026-01-01')).toBe('2025-12-29');
  });

  it('agrees with weekStartOf for the same calendar date in UTC', () => {
    for (const date of [
      '2026-08-03',
      '2026-08-06',
      '2026-08-09',
      '2026-02-29'.replace('29', '28'),
    ]) {
      expect(weekStartOfLocalDate(date)).toBe(
        weekStartOf(new Date(`${date}T12:00:00.000Z`), 'UTC')
      );
    }
  });
});
