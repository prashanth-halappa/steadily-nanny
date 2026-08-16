/**
 * @module hooks/mutations/__tests__/useRedeemInvite.test
 * Covers: the variables shape forwards to `householdApi.redeemInvite`
 * positionally, including §8.2c's `archiveHouseholdId` for "join & close".
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const redeemInviteMock = mock(
  (
    _code: string,
    _targetHouseholdId?: string,
    _weekStartsOn?: number,
    _archiveHouseholdId?: string
  ) => Promise.resolve({ id: 'member-1', household_id: 'household-2' })
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { redeemInvite: redeemInviteMock },
}));
mock.module('@/src/lib/toast', () => ({ showErrorToast: mock(() => {}) }));

let useRedeemInvite: typeof import('../useRedeemInvite').useRedeemInvite;

beforeAll(async () => {
  ({ useRedeemInvite } = await import('../useRedeemInvite'));
});

beforeEach(() => {
  redeemInviteMock.mockClear();
});

describe('useRedeemInvite', () => {
  it('forwards code, targetHouseholdId and weekStartsOn positionally', async () => {
    const { result } = renderHookWithProviders(() => useRedeemInvite());

    await act(async () => {
      await result.current.mutateAsync({
        code: 'R4K-92T',
        targetHouseholdId: 'household-1',
        weekStartsOn: 0,
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(redeemInviteMock).toHaveBeenCalledWith(
      'R4K-92T',
      'household-1',
      0,
      undefined
    );
  });

  it('forwards archiveHouseholdId — §8.2c join-and-close', async () => {
    const { result } = renderHookWithProviders(() => useRedeemInvite());

    await act(async () => {
      await result.current.mutateAsync({
        code: 'R4K-92T',
        archiveHouseholdId: 'household-old',
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(redeemInviteMock).toHaveBeenCalledWith(
      'R4K-92T',
      undefined,
      undefined,
      'household-old'
    );
  });
});
