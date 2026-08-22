/**
 * @module hooks/queries/__tests__/useRecentDepartures.test
 *
 * The parent-only read behind the departure cards. The gate that matters is
 * `enabled`: a carer's Today screen must never put this request on the wire
 * (the route is parent-only server-side, so an enabled query there is a
 * guaranteed 403 on every launch), and neither must a screen that has not
 * resolved a household id yet.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { HouseholdMember } from '@steadily-nanny/shared-types/schemas/household.schema';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const HOUSEHOLD_ID = '11111111-1111-4111-8111-111111111111';

const listDepartedMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { listDeparted: listDepartedMock },
}));

const { useRecentDepartures } = await import('../useRecentDepartures');
const { useAuthStore } = await import('@/src/store/auth');

const DEPARTED = {
  id: 'member-1',
  user_id: 'nanny-1',
  role: 'nanny',
  status: 'removed',
  ended_reason: 'left',
} as HouseholdMember;

beforeEach(() => {
  listDepartedMock.mockReset();
  listDepartedMock.mockResolvedValue([DEPARTED]);
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useRecentDepartures', () => {
  it('returns the departed roster for a household', async () => {
    const { result } = renderHookWithProviders(() =>
      useRecentDepartures(HOUSEHOLD_ID)
    );

    await waitFor(() => expect(result.current.data).toEqual([DEPARTED]));
    expect(listDepartedMock).toHaveBeenCalledWith(HOUSEHOLD_ID);
  });

  it('never fires without a household id', async () => {
    const { result } = renderHookWithProviders(() =>
      useRecentDepartures(undefined)
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listDepartedMock).not.toHaveBeenCalled();
  });

  it('never fires without a session', async () => {
    useAuthStore.setState({ session: null, isInitialized: true } as never);

    const { result } = renderHookWithProviders(() =>
      useRecentDepartures(HOUSEHOLD_ID)
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(listDepartedMock).not.toHaveBeenCalled();
  });
});
