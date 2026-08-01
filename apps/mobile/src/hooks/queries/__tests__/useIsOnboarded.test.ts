/**
 * @module hooks/queries/__tests__/useIsOnboarded.test
 * Covers: the server-derived onboarding predicate — tri-state status, and
 * role/householdId derived from `created_by` vs the current user id. See
 * useIsOnboarded's header comment for why this is server-derived rather than
 * reading `setupProgress` (the bug this replaced).
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const USER_ID = 'user-1';

const householdsListMock = mock(() => Promise.resolve([] as unknown[]));
const childrenListMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdsListMock },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: childrenListMock },
}));

let useIsOnboarded: typeof import('../useIsOnboarded').useIsOnboarded;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;

beforeAll(async () => {
  useIsOnboarded = (await import('../useIsOnboarded')).useIsOnboarded;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;
});

beforeEach(() => {
  householdsListMock.mockReset();
  childrenListMock.mockReset();
  householdsListMock.mockResolvedValue([]);
  childrenListMock.mockResolvedValue([]);
  useAuthStore.setState({
    session: { user: { id: USER_ID } } as any,
    isInitialized: true,
  });
});

describe('useIsOnboarded', () => {
  it('is loading while households are in flight — never a bare false', () => {
    householdsListMock.mockImplementation(() => new Promise(() => {}));

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    expect(result.current.status).toBe('loading');
    expect(result.current.role).toBeNull();
  });

  it('is not-onboarded with no role when the user has no households', async () => {
    householdsListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('not-onboarded'));
    expect(result.current.role).toBeNull();
    expect(result.current.householdId).toBeNull();
  });

  it('is onboarded as a parent once they own a household with >= 1 child', async () => {
    householdsListMock.mockResolvedValue([
      { id: 'household-1', created_by: USER_ID },
    ]);
    childrenListMock.mockResolvedValue([{ id: 'child-1', name: 'Ada' }]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('parent');
    expect(result.current.householdId).toBe('household-1');
  });

  it('is not-onboarded as a parent when the owned household has no children yet', async () => {
    householdsListMock.mockResolvedValue([
      { id: 'household-1', created_by: USER_ID },
    ]);
    childrenListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('not-onboarded'));
    expect(result.current.role).toBe('parent');
    expect(result.current.householdId).toBe('household-1');
  });

  it('is onboarded as a nanny once she is an active member of a household she did not create', async () => {
    householdsListMock.mockResolvedValue([
      { id: 'household-1', created_by: 'someone-else' },
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('nanny');
    expect(result.current.householdId).toBe('household-1');
    // A nanny's onboarded status never depends on a children fetch.
    expect(childrenListMock).not.toHaveBeenCalled();
  });
});
