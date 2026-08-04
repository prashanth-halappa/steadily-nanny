/**
 * Prefs / quiet-hours gating lives in sendToUser — the single chokepoint
 * every householdPush call site inherits.
 *
 * @module tests/unit/domains/notification/services/pushDispatchService.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const getDeliverableTokensForUser = mock(() =>
  Promise.resolve(['ExponentPushToken[test]'])
);
const removeTokens = mock(() => Promise.resolve());
const sendToTokens = mock(() =>
  Promise.resolve({ sent: 1, invalidTokens: [] as string[] })
);
const findByUserId = mock(
  (): Promise<Record<string, unknown> | null> => Promise.resolve(null)
);

const SRC = '../../../../../src/domains/notification';

let sendToUser: typeof import('../../../../../src/domains/notification/services/pushDispatchService').sendToUser;

beforeAll(async () => {
  mock.module(`${SRC}/repositories/deviceRepository`, () => ({
    DeviceRepository: {
      getDeliverableTokensForUser,
      removeTokens,
    },
  }));
  mock.module(`${SRC}/services/notificationSender`, () => ({ sendToTokens }));
  mock.module(`${SRC}/repositories/notificationPrefsRepository`, () => ({
    NotificationPrefsRepository: class {
      findByUserId = findByUserId;
    },
  }));
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: {
      info: mock(() => undefined),
      error: mock(() => undefined),
      warn: mock(() => undefined),
      debug: mock(() => undefined),
    },
  }));

  ({ sendToUser } = await import(
    '../../../../../src/domains/notification/services/pushDispatchService'
  ));
});

beforeEach(() => {
  getDeliverableTokensForUser.mockClear();
  removeTokens.mockClear();
  sendToTokens.mockClear();
  findByUserId.mockReset();
  findByUserId.mockImplementation(() => Promise.resolve(null));
});

describe('sendToUser prefs gating', () => {
  it('sends when prefs are missing (all enabled, quiet hours off)', async () => {
    findByUserId.mockResolvedValueOnce(null);

    const result = await sendToUser('user-1', {
      title: 't',
      body: 'b',
      data: { type: 'timesheet_submitted' },
    });

    expect(result.sent).toBe(1);
    expect(sendToTokens).toHaveBeenCalledTimes(1);
  });

  it('does not send when the event type is opted out', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: ['timesheet_submitted'],
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: 'UTC',
    });

    const result = await sendToUser('user-1', {
      title: 't',
      body: 'b',
      data: { type: 'timesheet_submitted' },
    });

    expect(result).toEqual({ sent: 0, invalidTokens: [] });
    expect(sendToTokens).not.toHaveBeenCalled();
    expect(getDeliverableTokensForUser).not.toHaveBeenCalled();
  });

  it('suppresses a non-exempt type during quiet hours', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: [],
      quiet_hours_enabled: true,
      quiet_hours_start: '00:00',
      quiet_hours_end: '23:59',
      timezone: 'UTC',
    });

    const result = await sendToUser('user-1', {
      title: 't',
      body: 'b',
      data: { type: 'timesheet_submitted' },
    });

    expect(result).toEqual({ sent: 0, invalidTokens: [] });
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it('still sends a deadline-bearing exempt type during quiet hours', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: [],
      quiet_hours_enabled: true,
      quiet_hours_start: '00:00',
      quiet_hours_end: '23:59',
      timezone: 'UTC',
    });

    const result = await sendToUser('user-1', {
      title: 't',
      body: 'b',
      data: { type: 'shift_change_requested' },
    });

    expect(result.sent).toBe(1);
    expect(sendToTokens).toHaveBeenCalledTimes(1);
  });

  it('still sends a non-opted-out type when quiet hours are off', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: ['timesheet_submitted'],
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: 'UTC',
    });

    const result = await sendToUser('user-1', {
      title: 't',
      body: 'b',
      data: { type: 'shift_change_requested' },
    });

    expect(result.sent).toBe(1);
    expect(sendToTokens).toHaveBeenCalledTimes(1);
  });
});
