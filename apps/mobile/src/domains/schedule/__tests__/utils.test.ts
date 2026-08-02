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
import { describe, expect, it, mock } from 'bun:test';
import type { SendDayInput } from '../utils';
import {
  buildWeeklyRrule,
  calculateDayHours,
  calculateWeekTotalHours,
  formatWallClockTime,
  isOutsideAvailability,
  sendScheduleWeek,
  todayIsoDate,
  toggleWeekday,
} from '../utils';

describe('formatWallClockTime', () => {
  it('strips seconds from ISO time strings', () => {
    expect(formatWallClockTime('09:00:00')).toBe('09:00');
    expect(formatWallClockTime('17:00:00')).toBe('17:00');
  });

  it('pads single-digit hours and minutes', () => {
    expect(formatWallClockTime('9:5')).toBe('09:05');
  });

  it('passes through already-formatted HH:MM', () => {
    expect(formatWallClockTime('09:00')).toBe('09:00');
  });
});

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

  // REGRESSION: Postgres `time` columns come back as "HH:MM:SS" while the
  // picker emits "HH:MM". The fixtures above use "09:00" — a format the
  // database never actually returns — which is why this suite stayed green
  // while the real screen misfired. Compared as strings, `'09:00' < '09:00:00'`
  // is TRUE, so a shift proposed at exactly the carer's stated start time read
  // as "before" it. "Your usual 9-5" is the most ordinary proposal there is.
  const wednesdayFromDatabase = {
    weekday: 3,
    is_available: true,
    earliest_start: '09:00:00',
    latest_finish: '17:00:00',
  };

  it('is false for an EXACT match against database-format times', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '09:00', end_time: '17:00' },
        [wednesdayFromDatabase]
      )
    ).toBe(false);
  });

  it('still flags a genuinely early start against database-format times', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '08:30', end_time: '17:00' },
        [wednesdayFromDatabase]
      )
    ).toBe(true);
  });

  it('still flags a genuinely late finish against database-format times', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '09:00', end_time: '17:30' },
        [wednesdayFromDatabase]
      )
    ).toBe(true);
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

  it('a null earliest_start means no lower bound — does not by itself count as a clash', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '06:00', end_time: '13:00' },
        [
          {
            weekday: 3,
            is_available: true,
            earliest_start: null,
            latest_finish: '17:00',
          },
        ]
      )
    ).toBe(false);
  });

  it('a null latest_finish means no upper bound — does not by itself count as a clash', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '09:00', end_time: '20:00' },
        [
          {
            weekday: 3,
            is_available: true,
            earliest_start: '09:00',
            latest_finish: null,
          },
        ]
      )
    ).toBe(false);
  });

  it('both bounds null (marked available, no hours set) never counts as a clash', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '00:00', end_time: '23:59' },
        [
          {
            weekday: 3,
            is_available: true,
            earliest_start: null,
            latest_finish: null,
          },
        ]
      )
    ).toBe(false);
  });

  it('a null earliest_start still respects a real latest_finish bound', () => {
    expect(
      isOutsideAvailability(
        { weekday: 3, start_time: '06:00', end_time: '18:00' },
        [
          {
            weekday: 3,
            is_available: true,
            earliest_start: null,
            latest_finish: '17:00',
          },
        ]
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

describe('sendScheduleWeek', () => {
  const days: SendDayInput[] = [
    { weekday: 3, start_time: '08:00', end_time: '13:00', children: [] },
  ];

  it('REGRESSION: creates a pattern, then calls replaceDays/sendPattern with the freshly created id — never undefined', async () => {
    const createPattern = mock(() => Promise.resolve({ id: 'new-pattern-id' }));
    const replaceDays = mock(
      (_args: { patternId: string; days: typeof days }) => Promise.resolve()
    );
    const sendPattern = mock((_args: { patternId: string }) =>
      Promise.resolve()
    );

    const result = await sendScheduleWeek({
      patternId: undefined,
      carerId: 'carer-1',
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      dtstart: '2026-08-05',
      days,
      createPattern,
      replaceDays,
      sendPattern,
    });

    expect(createPattern).toHaveBeenCalledTimes(1);
    expect(replaceDays).toHaveBeenCalledWith({
      patternId: 'new-pattern-id',
      days,
    });
    expect(sendPattern).toHaveBeenCalledWith({ patternId: 'new-pattern-id' });
    expect(result).toBe('new-pattern-id');

    // The specific bug this guards against: neither call ever receives
    // `undefined` in place of the id, which would 400 against
    // `/schedule-patterns/undefined/days`.
    expect(replaceDays.mock.calls[0]?.[0].patternId).not.toBeUndefined();
    expect(sendPattern.mock.calls[0]?.[0].patternId).not.toBeUndefined();
  });

  it('reuses an existing patternId and does not call createPattern again', async () => {
    const createPattern = mock(() => Promise.resolve({ id: 'ignored' }));
    const replaceDays = mock(
      (_args: { patternId: string; days: typeof days }) => Promise.resolve()
    );
    const sendPattern = mock((_args: { patternId: string }) =>
      Promise.resolve()
    );

    const result = await sendScheduleWeek({
      patternId: 'existing-pattern-id',
      carerId: 'carer-1',
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
      dtstart: '2026-08-05',
      days,
      createPattern,
      replaceDays,
      sendPattern,
    });

    expect(createPattern).not.toHaveBeenCalled();
    expect(replaceDays).toHaveBeenCalledWith({
      patternId: 'existing-pattern-id',
      days,
    });
    expect(sendPattern).toHaveBeenCalledWith({
      patternId: 'existing-pattern-id',
    });
    expect(result).toBe('existing-pattern-id');
  });

  // D11: if `createPattern` succeeds but a later step fails, the created id
  // must still reach the caller — otherwise a retry has no way to know a
  // draft already exists and creates a second, orphaned one. Verified as an
  // explicit three-way split: creation fails; creation succeeds then a
  // later step fails (retry must NOT create a second pattern); full success.
  describe('D11 — partial-failure id leakage (orphan draft on retry)', () => {
    it('creation fails: onPatternCreated is never called, and the failure propagates', async () => {
      const createPattern = mock(() =>
        Promise.reject(new Error('network down'))
      );
      const replaceDays = mock(
        (_args: { patternId: string; days: typeof days }) => Promise.resolve()
      );
      const sendPattern = mock((_args: { patternId: string }) =>
        Promise.resolve()
      );
      const onPatternCreated = mock((_id: string) => {});

      await expect(
        sendScheduleWeek({
          patternId: undefined,
          carerId: 'carer-1',
          rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
          dtstart: '2026-08-05',
          days,
          createPattern,
          replaceDays,
          sendPattern,
          onPatternCreated,
        })
      ).rejects.toThrow('network down');

      expect(onPatternCreated).not.toHaveBeenCalled();
      expect(replaceDays).not.toHaveBeenCalled();
      expect(sendPattern).not.toHaveBeenCalled();
    });

    it('creation succeeds, then replaceDays fails: onPatternCreated still fires with the real id BEFORE the rejection', async () => {
      const createPattern = mock(() =>
        Promise.resolve({ id: 'newly-created-id' })
      );
      const replaceDays = mock(() =>
        Promise.reject(new Error('400 validation error'))
      );
      const sendPattern = mock((_args: { patternId: string }) =>
        Promise.resolve()
      );
      const onPatternCreated = mock((_id: string) => {});

      await expect(
        sendScheduleWeek({
          patternId: undefined,
          carerId: 'carer-1',
          rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
          dtstart: '2026-08-05',
          days,
          createPattern,
          replaceDays,
          sendPattern,
          onPatternCreated,
        })
      ).rejects.toThrow('400 validation error');

      // The whole point: the id escapes even though the overall call failed.
      expect(onPatternCreated).toHaveBeenCalledWith('newly-created-id');
      expect(sendPattern).not.toHaveBeenCalled();
    });

    it('a retry after that partial failure reuses the persisted id and does NOT create a second pattern', async () => {
      const createPattern = mock(() =>
        Promise.resolve({ id: 'newly-created-id' })
      );
      const failingReplaceDays = mock(() =>
        Promise.reject(new Error('400 validation error'))
      );
      let persistedPatternId: string | undefined;

      // First attempt: fails after creation, but the caller (standing in
      // for ScheduleBuildScreen's onPatternCreated -> setPatternId) captures
      // the id the moment it's known.
      await expect(
        sendScheduleWeek({
          patternId: undefined,
          carerId: 'carer-1',
          rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
          dtstart: '2026-08-05',
          days,
          createPattern,
          replaceDays: failingReplaceDays,
          sendPattern: mock(() => Promise.resolve()),
          onPatternCreated: id => {
            persistedPatternId = id;
          },
        })
      ).rejects.toThrow();

      expect(persistedPatternId).toBe('newly-created-id');

      // Retry: the caller passes the PERSISTED id back in, exactly as
      // ScheduleBuildScreen's `patternId` state would after onPatternCreated
      // updated it. createPattern must NOT be called again.
      const retryReplaceDays = mock(
        (_args: { patternId: string; days: typeof days }) => Promise.resolve()
      );
      const retrySendPattern = mock((_args: { patternId: string }) =>
        Promise.resolve()
      );
      createPattern.mockClear();

      const result = await sendScheduleWeek({
        patternId: persistedPatternId,
        carerId: 'carer-1',
        rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
        dtstart: '2026-08-05',
        days,
        createPattern,
        replaceDays: retryReplaceDays,
        sendPattern: retrySendPattern,
      });

      expect(createPattern).not.toHaveBeenCalled();
      expect(retryReplaceDays).toHaveBeenCalledWith({
        patternId: 'newly-created-id',
        days,
      });
      expect(retrySendPattern).toHaveBeenCalledWith({
        patternId: 'newly-created-id',
      });
      expect(result).toBe('newly-created-id');
    });

    it('full success: onPatternCreated fires exactly once with the created id', async () => {
      const createPattern = mock(() => Promise.resolve({ id: 'full-ok-id' }));
      const replaceDays = mock(
        (_args: { patternId: string; days: typeof days }) => Promise.resolve()
      );
      const sendPattern = mock((_args: { patternId: string }) =>
        Promise.resolve()
      );
      const onPatternCreated = mock((_id: string) => {});

      const result = await sendScheduleWeek({
        patternId: undefined,
        carerId: 'carer-1',
        rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
        dtstart: '2026-08-05',
        days,
        createPattern,
        replaceDays,
        sendPattern,
        onPatternCreated,
      });

      expect(onPatternCreated).toHaveBeenCalledTimes(1);
      expect(onPatternCreated).toHaveBeenCalledWith('full-ok-id');
      expect(result).toBe('full-ok-id');
    });

    it('reusing an existing patternId never calls onPatternCreated (nothing was newly created)', async () => {
      const createPattern = mock(() => Promise.resolve({ id: 'ignored' }));
      const replaceDays = mock(
        (_args: { patternId: string; days: typeof days }) => Promise.resolve()
      );
      const sendPattern = mock((_args: { patternId: string }) =>
        Promise.resolve()
      );
      const onPatternCreated = mock((_id: string) => {});

      await sendScheduleWeek({
        patternId: 'already-exists',
        carerId: 'carer-1',
        rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=WE',
        dtstart: '2026-08-05',
        days,
        createPattern,
        replaceDays,
        sendPattern,
        onPatternCreated,
      });

      expect(onPatternCreated).not.toHaveBeenCalled();
    });
  });
});
