/**
 * @module hooks/mutations/__tests__/useLeaveHousehold.test
 * Leaving must clear the household-scoped caches AND the persisted
 * active-household preference: without the reset, `useActiveHousehold`
 * re-resolves the id the user just left (it is now a PAST household, and
 * that lookup deliberately spans past households too) and drops them back
 * into the family they walked out of, read-only.
 */
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const leaveMock = mock(() => Promise.resolve(undefined));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { leave: leaveMock },
}));
const showErrorToastMock = mock(() => {});
mock.module('@/src/lib/toast', () => ({
  showErrorToast: showErrorToastMock,
}));

let useLeaveHousehold: typeof import('../useLeaveHousehold').useLeaveHousehold;
let useActiveHouseholdStore: typeof import('@/src/store/activeHousehold').useActiveHouseholdStore;

beforeAll(async () => {
  useLeaveHousehold = (await import('../useLeaveHousehold')).useLeaveHousehold;
  useActiveHouseholdStore = (await import('@/src/store/activeHousehold'))
    .useActiveHouseholdStore;
});

beforeEach(() => {
  leaveMock.mockReset();
  leaveMock.mockImplementation(() => Promise.resolve(undefined));
  showErrorToastMock.mockClear();
  useActiveHouseholdStore.setState({ preferredHouseholdId: HOUSEHOLD_ID });
});

describe('useLeaveHousehold', () => {
  it('leaves, invalidates household + membership caches, and clears the active-household preference', async () => {
    const { result, queryClient } = renderHookWithProviders(() =>
      useLeaveHousehold()
    );
    const invalidateSpy = spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(HOUSEHOLD_ID);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(leaveMock).toHaveBeenCalledWith(HOUSEHOLD_ID);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.household.all,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.user.memberships(),
    });
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBeNull();
  });

  it('surfaces the clocked-in refusal with its own copy, not the generic conflict toast', async () => {
    leaveMock.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error('conflict'), {
          response: {
            status: 409,
            data: {
              error: {
                code: 'CONFLICT',
                metadata: { reason: 'CANNOT_LEAVE_WHILE_CLOCKED_IN' },
              },
            },
          },
        })
      )
    );

    const { result } = renderHookWithProviders(() => useLeaveHousehold());

    await act(async () => {
      await expect(
        result.current.mutateAsync(HOUSEHOLD_ID)
      ).rejects.toBeDefined();
    });

    expect(showErrorToastMock).toHaveBeenCalledWith(
      'household:householdSettings.leaveClockedInError'
    );
    // A failed leave must NOT clear the preference — the user is still a
    // member of the household they are looking at.
    expect(useActiveHouseholdStore.getState().preferredHouseholdId).toBe(
      HOUSEHOLD_ID
    );
  });

  it('names the owner refusal specifically — "forbidden" tells an owner nothing actionable', async () => {
    leaveMock.mockImplementationOnce(() =>
      Promise.reject(
        Object.assign(new Error('forbidden'), {
          response: {
            status: 403,
            data: {
              error: {
                code: 'FORBIDDEN',
                metadata: { reason: 'CANNOT_LEAVE_AS_OWNER' },
              },
            },
          },
        })
      )
    );

    const { result } = renderHookWithProviders(() => useLeaveHousehold());

    await act(async () => {
      await expect(
        result.current.mutateAsync(HOUSEHOLD_ID)
      ).rejects.toBeDefined();
    });

    expect(showErrorToastMock).toHaveBeenCalledWith(
      'household:householdSettings.leaveOwnerError'
    );
  });
});
