/**
 * @module hooks/queries/__tests__/useAvailabilityForCarer.test
 * D25 — the query hook a parent's schedule-build flow uses to fetch a
 * carer's stated availability. Covers: disabled with no userId (never
 * fires `getForUser(undefined)`), fetches once a userId is present, and
 * disabled while unauthenticated (same gating convention as every other
 * query hook in this app).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const CARER_ID = 'carer-1';
const AVAILABILITY_ROW = {
  id: 'row-1',
  user_id: CARER_ID,
  weekday: 3,
  is_available: true,
  earliest_start: '09:00',
  latest_finish: '17:00',
  evening_mode: 'sometimes',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const getForUserMock = mock(() => Promise.resolve([AVAILABILITY_ROW]));

mock.module('@/src/api/endpoints/availability', () => ({
  availabilityApi: { getForUser: getForUserMock },
}));

let useAvailabilityForCarer: typeof import('../useAvailabilityForCarer').useAvailabilityForCarer;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useAvailabilityForCarer = (await import('../useAvailabilityForCarer'))
    .useAvailabilityForCarer;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  getForUserMock.mockReset();
  getForUserMock.mockImplementation(() => Promise.resolve([AVAILABILITY_ROW]));
  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useAvailabilityForCarer', () => {
  it('does not fetch when no carer is selected yet', () => {
    const { result } = renderHookWithProviders(() =>
      useAvailabilityForCarer(null)
    );

    expect(result.current.isPending).toBe(true);
    expect(getForUserMock).not.toHaveBeenCalled();
  });

  it('fetches the carer’s availability once a userId is provided', async () => {
    const { result } = renderHookWithProviders(() =>
      useAvailabilityForCarer(CARER_ID)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getForUserMock).toHaveBeenCalledWith(CARER_ID);
    expect(result.current.data?.[0]?.weekday).toBe(3);
  });

  it('is disabled while the auth store is not yet initialized', () => {
    useAuthStore.setState({
      session: { user: { id: 'parent-1' } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      useAvailabilityForCarer(CARER_ID)
    );

    expect(result.current.isPending).toBe(true);
    expect(getForUserMock).not.toHaveBeenCalled();
  });
});
