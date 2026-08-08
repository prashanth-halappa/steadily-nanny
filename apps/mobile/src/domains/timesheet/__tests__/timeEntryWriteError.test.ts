/**
 * @module domains/timesheet/__tests__/timeEntryWriteError
 *
 * The three surfaces that write a time entry (Hours corrections, clock-out,
 * Add-missed-hours) all hit the same server guards, and used to describe the
 * refusal in three different amounts of detail — two of them said nothing at
 * all. This is the one description they now share.
 *
 * Key-echo `t`: the real copy lives in `errors.json`; asserting the KEY plus
 * the interpolated day/range is what proves the right branch ran without
 * pinning the wording.
 */
import { describe, expect, it } from 'bun:test';
import { describeTimeEntryWriteError } from '../utils/timeEntryWriteError';

const TIME_ZONE = 'Europe/London';
const OVERLAP_ID = '0db743e4-235e-4ca6-b72b-4e6de37e8f58';

/** Echoes the key and appends the options, like the app's test i18n mock. */
const t = (key: string, options?: { day: string; range?: string }): string =>
  options ? `${key}|${options.day}|${options.range ?? ''}` : key;

function overlap409(clockOutAt: string | null) {
  return {
    isAxiosError: true,
    response: {
      status: 409,
      data: {
        error: {
          metadata: {
            reason: 'TIME_ENTRY_OVERLAPS',
            overlappingEntryId: OVERLAP_ID,
            overlappingClockInAt: '2026-08-04T08:00:00.000Z',
            ...(clockOutAt === null
              ? {}
              : { overlappingClockOutAt: clockOutAt }),
          },
        },
      },
    },
  };
}

function validation400(reason: string) {
  return {
    isAxiosError: true,
    response: {
      status: 400,
      data: { error: { code: 'VALIDATION_ERROR', metadata: { reason } } },
    },
  };
}

describe('describeTimeEntryWriteError', () => {
  it('names the clashing entry by day and range, and hands back its id', () => {
    const result = describeTimeEntryWriteError(
      overlap409('2026-08-04T16:30:00.000Z'),
      t,
      TIME_ZONE
    );

    expect(result.overlappingEntryId).toBe(OVERLAP_ID);
    expect(result.message).toContain('timeEntryOverlaps');
    expect(result.message).toContain('Tue 4 Aug');
    // A range, not one bare time — both ends or it identifies nothing.
    expect(result.message).toMatch(/\d.*–.*\d/);
  });

  it('resolves the day in the HOUSEHOLD zone, not UTC (GOLDEN-FIXES #21)', () => {
    // 23:30Z on 4 Aug is 00:30 on the 5th in London. Reading this in UTC
    // would send her looking at the wrong day on Hours.
    const late = overlap409('2026-08-05T02:00:00.000Z');
    late.response.data.error.metadata.overlappingClockInAt =
      '2026-08-04T23:30:00.000Z';

    const { message } = describeTimeEntryWriteError(late, t, TIME_ZONE);

    expect(message).toContain('Wed 5 Aug');
    expect(message).not.toContain('Tue 4 Aug');
  });

  it('never leaks the raw entry id into the message', () => {
    const { message } = describeTimeEntryWriteError(
      overlap409('2026-08-04T16:30:00.000Z'),
      t,
      TIME_ZONE
    );

    expect(message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('switches copy for a clash with a STILL-RUNNING entry rather than half a range', () => {
    const result = describeTimeEntryWriteError(overlap409(null), t, TIME_ZONE);

    expect(result.overlappingEntryId).toBe(OVERLAP_ID);
    expect(result.message).toContain('timeEntryOverlapsRunning');
    expect(result.message).not.toContain('–');
  });

  it('gives the 16h ceiling its own copy — the reported silent failure', () => {
    const result = describeTimeEntryWriteError(
      validation400('CLOCK_SPAN_TOO_LONG'),
      t,
      TIME_ZONE
    );

    expect(result.message).toBe('errors:clockSpanTooLong');
    expect(result.overlappingEntryId).toBeNull();
  });

  it('gives a week-crossing finish its own copy too', () => {
    const { message } = describeTimeEntryWriteError(
      validation400('CLOCK_OUT_CHANGES_WEEK'),
      t,
      TIME_ZONE
    );

    expect(message).toBe('errors:clockOutChangesWeek');
  });

  it('gives a voided-entry refusal its own copy for inline sheet rendering', () => {
    const { message } = describeTimeEntryWriteError(
      {
        isAxiosError: true,
        response: {
          status: 409,
          data: { error: { metadata: { reason: 'voided' } } },
        },
      },
      t,
      TIME_ZONE
    );

    expect(message).toBe('errors:entryVoided');
    expect(message).not.toBe('errors:conflict');
  });

  it('falls back to the generic validation copy for an unmapped reason', () => {
    const { message } = describeTimeEntryWriteError(
      validation400('SOMETHING_NEW'),
      t,
      TIME_ZONE
    );

    expect(message).toBe('errors:validation');
  });

  it('prefers offline copy when the device is offline', () => {
    const { message } = describeTimeEntryWriteError(
      { isAxiosError: true, message: 'Network Error' },
      t,
      TIME_ZONE,
      false
    );

    expect(message).toBe('errors:offline');
  });

  it('always returns something renderable, even for a thrown non-error', () => {
    const { message } = describeTimeEntryWriteError(undefined, t, TIME_ZONE);

    expect(message.length).toBeGreaterThan(0);
    expect(message).toBe('errors:unknown');
  });
});
