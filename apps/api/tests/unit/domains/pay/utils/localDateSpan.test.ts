/**
 * @module tests/unit/domains/pay/utils/localDateSpan
 *
 * Written BEFORE the implementation (TDD red-first). Pure function, no mocks.
 *
 * The household-local calendar dates an instant span covers. Extracted from
 * `weekEarningsService.closureDatesInWeek`, which already had to answer this
 * question for household closures, because `ptoCommandService` now needs the
 * SAME answer for a time off — and two copies of a subtle date rule drift.
 *
 * The rule under test is the app's all-day convention (`toAllDayRange` in
 * `apps/mobile/src/domains/timeOff/utils/timeOffDate.ts`): `ends_at` is
 * EXCLUSIVE — local midnight of the day AFTER the last selected day — so the
 * covered span is `[localDate(starts_at), localDate(ends_at))`, with a
 * sub-day span still counting as one date.
 */
import { describe, expect, it } from 'bun:test';
import { localDatesCovered } from '../../../../../src/domains/pay/utils/localDateSpan';

const LONDON = 'Europe/London';

describe('localDatesCovered', () => {
  it('returns one date for a single all-day span (exclusive end, next midnight)', () => {
    expect(
      localDatesCovered(
        '2026-08-24T00:00:00.000+01:00',
        '2026-08-25T00:00:00.000+01:00',
        LONDON
      )
    ).toEqual(['2026-08-24']);
  });

  it('returns every covered date for a three-day span', () => {
    expect(
      localDatesCovered(
        '2026-08-24T00:00:00.000+01:00',
        '2026-08-27T00:00:00.000+01:00',
        LONDON
      )
    ).toEqual(['2026-08-24', '2026-08-25', '2026-08-26']);
  });

  it('covers a fortnight, weekends included, in order', () => {
    const dates = localDatesCovered(
      '2026-08-03T00:00:00.000+01:00',
      '2026-08-17T00:00:00.000+01:00',
      LONDON
    );
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe('2026-08-03');
    expect(dates[13]).toBe('2026-08-16');
  });

  it('counts a SUB-DAY span as one date rather than none', () => {
    expect(
      localDatesCovered(
        '2026-08-24T09:00:00.000+01:00',
        '2026-08-24T17:00:00.000+01:00',
        LONDON
      )
    ).toEqual(['2026-08-24']);
  });

  it('counts an inverted or zero-length span as one date, never zero', () => {
    // Defensive: the DB forbids it, but returning [] here would silently
    // lose the whole marking rather than mis-date it.
    expect(
      localDatesCovered(
        '2026-08-24T09:00:00.000+01:00',
        '2026-08-24T09:00:00.000+01:00',
        LONDON
      )
    ).toEqual(['2026-08-24']);
  });

  it('resolves in the HOUSEHOLD timezone, not UTC', () => {
    // 23:30Z on the 23rd is already 11:30 on the 24th in Auckland.
    expect(
      localDatesCovered(
        '2026-08-23T23:30:00.000Z',
        '2026-08-24T23:30:00.000Z',
        'Pacific/Auckland'
      )
    ).toEqual(['2026-08-24']);
  });

  it('crosses a month boundary', () => {
    expect(
      localDatesCovered(
        '2026-08-30T00:00:00.000+01:00',
        '2026-09-02T00:00:00.000+01:00',
        LONDON
      )
    ).toEqual(['2026-08-30', '2026-08-31', '2026-09-01']);
  });
});
