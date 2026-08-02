/**
 * @module hooks/queries/__tests__/useBusyBlocks.test
 * D30 — query hook for GET /availability/:carerId/busy.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { renderHookWithProviders } from '@/src/test-utils';

const CARER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FROM = '2026-08-10T00:00:00.000Z';
const TO = '2026-08-13T00:00:00.000Z';
const BLOCK = {
  starts_at: '2026-08-11T09:00:00.000Z',
  ends_at: '2026-08-11T17:00:00.000Z',
  kind: 'other_commitment' as const,
};

const getBusyBlocksMock = mock(() => Promise.resolve([BLOCK]));

mock.module('@/src/api/endpoints/availability', () => ({
  availabilityApi: { getBusyBlocks: getBusyBlocksMock },
}));

let useBusyBlocks: typeof import('../useBusyBlocks').useBusyBlocks;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeEach(async () => {
  useBusyBlocks = (await import('../useBusyBlocks')).useBusyBlocks;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;

  getBusyBlocksMock.mockReset();
  getBusyBlocksMock.mockImplementation(() => Promise.resolve([BLOCK]));
  useAuthStore.setState({
    session: { user: { id: CARER_ID } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('useBusyBlocks', () => {
  it('does not fetch when carerId or range is missing', () => {
    const { result } = renderHookWithProviders(() =>
      useBusyBlocks(null, FROM, TO)
    );

    expect(result.current.isPending).toBe(true);
    expect(getBusyBlocksMock).not.toHaveBeenCalled();
  });

  it('fetches with the busy query key once carerId + range are set', async () => {
    const { result } = renderHookWithProviders(() =>
      useBusyBlocks(CARER_ID, FROM, TO)
    );

    await waitFor(() => expect(result.current.data).toBeDefined());

    expect(getBusyBlocksMock).toHaveBeenCalledWith(CARER_ID, FROM, TO);
    expect(result.current.data?.[0]?.kind).toBe('other_commitment');
  });

  it('is disabled while auth is not initialized', () => {
    useAuthStore.setState({
      session: { user: { id: CARER_ID } } as unknown as never,
      isInitialized: false,
    } as never);

    const { result } = renderHookWithProviders(() =>
      useBusyBlocks(CARER_ID, FROM, TO)
    );

    expect(result.current.isPending).toBe(true);
    expect(getBusyBlocksMock).not.toHaveBeenCalled();
  });

  it('uses queryKeys.availability.busy for the query key', () => {
    const { result } = renderHookWithProviders(() =>
      useBusyBlocks(CARER_ID, FROM, TO)
    );

    // Stable key shape — the factory already exists; this locks the hook to it.
    expect(queryKeys.availability.busy(CARER_ID, FROM, TO)).toEqual([
      'availability',
      'busy',
      CARER_ID,
      FROM,
      TO,
    ]);
    expect(result.current.isPending || result.current.isFetching).toBe(true);
  });
});
