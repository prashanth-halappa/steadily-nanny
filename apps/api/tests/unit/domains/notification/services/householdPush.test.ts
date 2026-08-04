/**
 * @module tests/unit/domains/notification/services/householdPush.test
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const sendToUser = mock(() => Promise.resolve({ sent: 1, invalidTokens: [] }));
const listActiveByHousehold = mock(() =>
  Promise.resolve([
    { user_id: 'parent-1', role: 'parent', status: 'active' },
    { user_id: 'nanny-1', role: 'nanny', status: 'active' },
    { user_id: 'owner-1', role: 'owner', status: 'active' },
  ])
);
const loggerError = mock(() => undefined);

beforeAll(() => {
  mock.module(
    '../../../../../src/domains/notification/services/pushDispatchService',
    () => ({ sendToUser })
  );
  mock.module('../../../../../src/domains/household', () => ({
    HOUSEHOLD_ROLES: {
      OWNER: 'owner',
      PARENT: 'parent',
      NANNY: 'nanny',
      HELPER: 'helper',
    },
    HouseholdMemberRepository: class {
      listActiveByHousehold = listActiveByHousehold;
    },
  }));
  mock.module('../../../../../src/middlewares/logger', () => ({
    logger: { error: loggerError },
  }));
});

beforeEach(() => {
  sendToUser.mockClear();
  listActiveByHousehold.mockClear();
  loggerError.mockClear();
  sendToUser.mockImplementation(() =>
    Promise.resolve({ sent: 1, invalidTokens: [] })
  );
});

describe('householdPush', () => {
  it('notifies only owner and parent members', async () => {
    const { notifyHouseholdParents } = await import(
      '../../../../../src/domains/notification/services/householdPush'
    );
    notifyHouseholdParents('hh-1', { title: 't', body: 'b' });
    // Allow the fire-and-forget promise chain to settle.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(listActiveByHousehold).toHaveBeenCalledWith('hh-1');
    expect(sendToUser).toHaveBeenCalledTimes(2);
    expect(sendToUser).toHaveBeenCalledWith('parent-1', {
      title: 't',
      body: 'b',
    });
    expect(sendToUser).toHaveBeenCalledWith('owner-1', {
      title: 't',
      body: 'b',
    });
  });

  it('never throws to callers when sendToUser rejects', async () => {
    sendToUser.mockImplementation(() => Promise.reject(new Error('boom')));
    const { notifyUser } = await import(
      '../../../../../src/domains/notification/services/householdPush'
    );

    expect(() =>
      notifyUser('user-1', {
        title: 't',
        body: 'b',
        data: { type: 'timesheet_submitted' },
      })
    ).not.toThrow();

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loggerError).toHaveBeenCalled();
  });
});
