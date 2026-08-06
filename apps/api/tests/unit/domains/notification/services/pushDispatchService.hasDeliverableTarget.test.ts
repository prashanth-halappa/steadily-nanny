/**
 * `hasDeliverableTarget` is the pre-check the reminders job runs BEFORE
 * claiming an idempotency slot (see `jobs/reminderJob.ts`), so it must agree
 * with `sendToUser` on every prefs/quiet-hours/token gate — see
 * `pushDispatchService.test.ts` for the equivalent `sendToUser` gating
 * assertions this mirrors.
 *
 * @module tests/unit/domains/notification/services/pushDispatchService.hasDeliverableTarget.test
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

let hasDeliverableTarget: typeof import('../../../../../src/domains/notification/services/pushDispatchService').hasDeliverableTarget;

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

  ({ hasDeliverableTarget } = await import(
    '../../../../../src/domains/notification/services/pushDispatchService'
  ));
});

beforeEach(() => {
  getDeliverableTokensForUser.mockClear();
  removeTokens.mockClear();
  sendToTokens.mockClear();
  findByUserId.mockReset();
  findByUserId.mockImplementation(() => Promise.resolve(null));
  getDeliverableTokensForUser.mockImplementation(() =>
    Promise.resolve(['ExponentPushToken[test]'])
  );
});

describe('hasDeliverableTarget', () => {
  it('is true when prefs allow it and a device token exists', async () => {
    findByUserId.mockResolvedValueOnce(null);
    expect(
      await hasDeliverableTarget('user-1', {
        title: 't',
        body: 'b',
        data: { type: 'shift_reminder' },
      })
    ).toBe(true);
    // Only checks — never actually sends.
    expect(sendToTokens).not.toHaveBeenCalled();
  });

  it('is false when the event type is opted out — no token lookup needed', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: ['shift_reminder'],
      quiet_hours_enabled: false,
      quiet_hours_start: null,
      quiet_hours_end: null,
      timezone: 'UTC',
    });

    expect(
      await hasDeliverableTarget('user-1', {
        title: 't',
        body: 'b',
        data: { type: 'shift_reminder' },
      })
    ).toBe(false);
    expect(getDeliverableTokensForUser).not.toHaveBeenCalled();
  });

  it('is false during quiet hours for a non-exempt type', async () => {
    findByUserId.mockResolvedValueOnce({
      user_id: 'user-1',
      disabled_types: [],
      quiet_hours_enabled: true,
      quiet_hours_start: '00:00',
      quiet_hours_end: '23:59',
      timezone: 'UTC',
    });

    expect(
      await hasDeliverableTarget('user-1', {
        title: 't',
        body: 'b',
        data: { type: 'shift_reminder' },
      })
    ).toBe(false);
  });

  it('is false when prefs pass but the user has no deliverable device tokens', async () => {
    findByUserId.mockResolvedValueOnce(null);
    getDeliverableTokensForUser.mockImplementationOnce(() =>
      Promise.resolve([])
    );

    expect(
      await hasDeliverableTarget('user-1', {
        title: 't',
        body: 'b',
        data: { type: 'shift_reminder' },
      })
    ).toBe(false);
  });
});
