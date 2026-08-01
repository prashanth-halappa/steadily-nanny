/**
 * @module domains/schedule/__tests__/utils.test
 *
 * TDD tests for the schedule domain's pure logic: RRULE construction, hours
 * totals, and the availability-clash check. `weekday` is the Postgres
 * `extract(dow)` convention (0=Sunday..6=Saturday) throughout — same
 * convention WeekStrip reports via `onToggle`, so these tests deliberately
 * use non-sequential weekdays (e.g. Wednesday=3, Sunday=0) to catch an
 * off-by-one against display order.
 */
import { describe, expect, it } from 'bun:test';
import {
  buildWeeklyRrule,
  calculateDayHours,
  calculateWeekTotalHours,
  isOutsideAvailability,
  todayIsoDate,
  toggleWeekday,
} from '../utils';

describe('toggleWeekday', () => {
  it('adds a day that is not yet selected, keeping the result sorted', () => {
    expect(toggleWeekday([1, 3], 2)).toEqual([1, 2, 3]);
  });

  it('removes a day that is already selected', () => {
    expect(toggleWeekday([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it('adds Sunday (0) correctly even though it renders LAST in WeekStrip', () => {
    // The exact off-by-one risk: 0 is a valid, distinct dow value, not "no
    // selection" or a falsy sentinel, and must sort to the front numerically
    // (display order is presentation-only, handled entirely inside WeekStrip).
    expect(toggleWeekday([1], 0)).toEqual([0, 1]);
  });

  it('removes Sunday (0) correctly', () => {
    expect(toggleWeekday([0, 1], 0)).toEqual([1]);
  });
});

describe('buildWeeklyRrule', () => {
  it('maps Postgres dow indices to RRULE BYDAY codes in week order (not selection order)', () => {
    // Selected out of order: Wednesday(3), Monday(1), Sunday(0).
    const rrule = buildWeeklyRrule([3, 1, 0], 1);
    expect(rrule).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,MO,WE');
  });

  it('maps every weekday correctly, 0=Sunday..6=Saturday', () => {
    const rrule = buildWeeklyRrule([0, 1, 2, 3, 4, 5, 6], 1);
    expect(rrule).toBe('FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,MO,TU,WE,TH,FR,SA');
  });

  it('encodes a fortnightly repeat as INTERVAL=2', () => {
    const rrule = buildWeeklyRrule([1], 2);
    expect(rrule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
  });
});

describe('calculateDayHours', () => {
  it('computes a whole-hour range', () => {
    expect(calculateDayHours('08:00', '13:00')).toBe(5);
  });

  it('computes a fractional-hour range', () => {
    expect(calculateDayHours('08:30', '13:00')).toBe(4.5);
  });
});

describe('calculateWeekTotalHours', () => {
  it('sums hours across multiple days', () => {
    const total = calculateWeekTotalHours([
      { start_time: '08:00', end_time: '13:00' }, // 5
      { start_time: '09:00', end_time: '17:30' }, // 8.5
    ]);
    expect(total).toBe(13.5);
  });

  it('returns 0 for no days', () => {
    expect(calculateWeekTotalHours([])).toBe(0);
  });
});

describe('isOutsideAvailability', () => {
  const wednesdayAvailable = {
    weekday: 3,
    is_available: true,
    earliest_start: '09:00',
    latest_finish: '17:00',
  };

  it('is false when the day sits fully inside the carer availability window', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '09:00', end_time: '13:00' },
        [wednesdayAvailable]
      )
    ).toBe(false);
  });

  it('is true when the day starts before the available window', () => {
    // Wed 8:00-13:00 sits outside 09:00-17:00 availability — the exact
    // example from the product spec.
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '08:00', end_time: '13:00' },
        [wednesdayAvailable]
      )
    ).toBe(true);
  });

  it('is true when the day ends after the available window', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '09:00', end_time: '18:00' },
        [wednesdayAvailable]
      )
    ).toBe(true);
  });

  it('is true when the carer marked that weekday fully unavailable', () => {
    expect(
      isOutsideAvailability(
        { weekday: 0, start_time: '09:00', end_time: '13:00' },
        [
          {
            weekday: 0,
            is_available: false,
            earliest_start: '09:00',
            latest_finish: '17:00',
          },
        ]
      )
    ).toBe(true);
  });

  it('is true when there is no availability row at all for that weekday', () => {
    expect(
      isOutsideAvailability(
        { weekday: 6, start_time: '09:00', end_time: '13:00' },
        [wednesdayAvailable]
      )
    ).toBe(true);
  });
});

describe('todayIsoDate', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(todayIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('zero-pads single-digit months and days', () => {
    expect(todayIsoDate(new Date(2026, 8, 3))).toBe('2026-09-03');
  });
});
