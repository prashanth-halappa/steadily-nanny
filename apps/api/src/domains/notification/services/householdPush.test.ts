/**
 * @module domains/notification/services/householdPush.test
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';

const sendToUser = mock(() => Promise.resolve({ sent: 1, invalidTokens: [] }));
const listActiveByHousehold = mock(() =>
  Promise.resolve([
    { user_id: 'parent-1', role: 'parent', status: 'active' },
    { user_id: 'nanny-1', role: 'nanny', status: 'active' },
    { user_id: 'owner-1', role: 'owner', status: 'active' },
  ])
);

beforeAll(() => {
  mock.module('./pushDispatchService', () => ({ sendToUser }));
  mock.module('../../household', () => ({
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
  mock.module('../../../middlewares/logger', () => ({
    logger: { error: mock(() => undefined) },
  }));
});

describe('householdPush', () => {
  it('notifies only owner and parent members', async () => {
    const { notifyHouseholdParents } = await import('./householdPush');
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
});
