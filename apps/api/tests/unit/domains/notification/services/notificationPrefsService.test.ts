/**
 * @module tests/unit/domains/notification/services/notificationPrefsService.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types';
import { ValidationError } from '../../../../../src/errors';

const findByUserId = mock(
  (): Promise<Record<string, unknown> | null> => Promise.resolve(null)
);
const upsert = mock((userId: string, row: Record<string, unknown>) =>
  Promise.resolve({
    user_id: userId,
    disabled_types: (row.disabled_types as string[] | undefined) ?? [],
    quiet_hours_enabled:
      (row.quiet_hours_enabled as boolean | undefined) ?? false,
    quiet_hours_start:
      (row.quiet_hours_start as string | null | undefined) ?? null,
    quiet_hours_end: (row.quiet_hours_end as string | null | undefined) ?? null,
    timezone: (row.timezone as string | undefined) ?? 'UTC',
    created_at: '2026-08-03T00:00:00.000Z',
    updated_at: '2026-08-03T00:00:00.000Z',
  })
);

const loggerInfo = mock((..._args: unknown[]) => undefined);
const loggerDebug = mock((..._args: unknown[]) => undefined);
const loggerWarn = mock((..._args: unknown[]) => undefined);
const loggerError = mock((..._args: unknown[]) => undefined);

let getPrefs: typeof import('../../../../../src/domains/notification/services/notificationPrefsService').getPrefs;
let updatePrefs: typeof import('../../../../../src/domains/notification/services/notificationPrefsService').updatePrefs;
let shouldDeliverPush: typeof import('../../../../../src/domains/notification/services/notificationPrefsService').shouldDeliverPush;

beforeAll(async () => {
  mock.module(
    '../../../../../src/domains/notification/repositories/notificationPrefsRepository',
    () => ({
      NotificationPrefsRepository: class {
        findByUserId = findByUserId;
        upsert = upsert;
      },
    })
  );
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      info: loggerInfo,
      debug: loggerDebug,
      warn: loggerWarn,
      error: loggerError,
    },
  }));

  ({ getPrefs, updatePrefs, shouldDeliverPush } = await import(
    '../../../../../src/domains/notification/services/notificationPrefsService'
  ));
});

beforeEach(() => {
  findByUserId.mockReset();
  upsert.mockClear();
  loggerInfo.mockClear();
  loggerDebug.mockClear();
  loggerWarn.mockClear();
  loggerError.mockClear();
  findByUserId.mockImplementation(() => Promise.resolve(null));
});

function quietHoursAllDayRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: 'user-1',
    disabled_types: [] as string[],
    quiet_hours_enabled: true,
    quiet_hours_start: '00:00',
    quiet_hours_end: '23:59',
    timezone: 'UTC',
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

describe('notificationPrefsService', () => {
  it('getPrefs returns defaults when no row exists', async () => {
    findByUserId.mockResolvedValueOnce(null);
    const prefs = await getPrefs('user-1');
    expect(prefs.disabledTypes).toEqual([]);
    expect(prefs.quietHoursEnabled).toBe(false);
    expect(prefs.timezone).toBe('UTC');
  });

  it('getPrefs maps a stored row', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: ['timesheet_submitted'],
      quiet_hours_enabled: true,
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
      timezone: 'America/Los_Angeles',
      created_at: 't',
      updated_at: 't',
    });
    const prefs = await getPrefs('user-1');
    expect(prefs.disabledTypes).toEqual(['timesheet_submitted']);
    expect(prefs.quietHoursEnabled).toBe(true);
    expect(prefs.quietHoursStart).toBe('22:00');
    expect(prefs.quietHoursEnd).toBe('07:00');
    expect(prefs.timezone).toBe('America/Los_Angeles');
  });

  it('updatePrefs upserts a partial patch', async () => {
    const prefs = await updatePrefs('user-1', {
      disabledTypes: ['shift_change_requested'],
    });
    expect(upsert).toHaveBeenCalled();
    expect(prefs.disabledTypes).toEqual(['shift_change_requested']);
  });

  it('updatePrefs rejects an invalid IANA timezone with 400', async () => {
    let caught: unknown;
    try {
      await updatePrefs('user-1', { timezone: 'Not/A_Zone' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).statusCode).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('updatePrefs accepts a real IANA timezone', async () => {
    const prefs = await updatePrefs('user-1', {
      timezone: 'America/Los_Angeles',
    });
    expect(prefs.timezone).toBe('America/Los_Angeles');
    expect(upsert).toHaveBeenCalled();
  });
});

describe('shouldDeliverPush quiet hours', () => {
  const midday = new Date('2026-08-03T12:00:00.000Z');

  it('suppresses a non-exempt type during quiet hours and logs', async () => {
    findByUserId.mockResolvedValueOnce(quietHoursAllDayRow());

    const deliver = await shouldDeliverPush(
      'user-1',
      {
        title: 't',
        body: 'b',
        data: { type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED },
      },
      midday
    );

    expect(deliver).toBe(false);
    expect(loggerInfo).toHaveBeenCalled();
    const logArg = loggerInfo.mock.calls[0]?.[0];
    expect(String(logArg)).toMatch(/quiet hours/i);
  });

  it('delivers shift_needs_reconfirm during quiet hours (exempt) and logs', async () => {
    findByUserId.mockResolvedValueOnce(quietHoursAllDayRow());

    const deliver = await shouldDeliverPush(
      'user-1',
      {
        title: 't',
        body: 'b',
        data: { type: PUSH_NOTIFICATION_TYPES.SHIFT_NEEDS_RECONFIRM },
      },
      midday
    );

    expect(deliver).toBe(true);
    expect(loggerInfo).toHaveBeenCalled();
    const logArg = loggerInfo.mock.calls[0]?.[0];
    expect(String(logArg)).toMatch(/exempt|quiet hours/i);
  });

  it('delivers shift_change_requested during quiet hours (exempt)', async () => {
    findByUserId.mockResolvedValueOnce(quietHoursAllDayRow());

    const deliver = await shouldDeliverPush(
      'user-1',
      {
        title: 't',
        body: 'b',
        data: { type: PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED },
      },
      midday
    );

    expect(deliver).toBe(true);
  });

  it('HOLDS extra_shift_proposed until quiet hours end — an ask is not a deadline', async () => {
    // The exemption list is for pushes that AUTO-APPROVE on timeout, where
    // silence costs the recipient something. An extra-shift proposal expires
    // into nothing, so nothing is lost by delivering it in the morning — while
    // a cover request at 23:40 for tomorrow is, in the carer's words, "exactly
    // the thing that gets an app deleted". It failed the list's own criterion.
    findByUserId.mockResolvedValueOnce(quietHoursAllDayRow());

    const deliver = await shouldDeliverPush(
      'user-1',
      {
        title: 't',
        body: 'b',
        data: { type: PUSH_NOTIFICATION_TYPES.EXTRA_SHIFT_PROPOSED },
      },
      midday
    );

    expect(deliver).toBe(false);
  });

  it('still respects opt-out for an exempt type', async () => {
    findByUserId.mockResolvedValueOnce(
      quietHoursAllDayRow({
        disabled_types: [PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED],
      })
    );

    const deliver = await shouldDeliverPush(
      'user-1',
      {
        title: 't',
        body: 'b',
        data: { type: PUSH_NOTIFICATION_TYPES.SHIFT_CHANGE_REQUESTED },
      },
      midday
    );

    expect(deliver).toBe(false);
  });

  it('fail-opens (delivers) when timezone is invalid and would throw', async () => {
    findByUserId.mockResolvedValueOnce(
      quietHoursAllDayRow({ timezone: 'Definitely/Not_A_Zone' })
    );

    const deliver = await shouldDeliverPush(
      'user-1',
      {
        title: 't',
        body: 'b',
        data: { type: PUSH_NOTIFICATION_TYPES.TIMESHEET_SUBMITTED },
      },
      midday
    );

    expect(deliver).toBe(true);
    expect(loggerWarn).toHaveBeenCalled();
  });
});
