/**
 * @module hooks/queries/__tests__/useIsOnboarded.test
 * Covers: the server-derived onboarding predicate — tri-state status, and
 * role/householdId derived from membership rows (not `created_by`). See
 * useIsOnboarded's header comment for why this is server-derived rather than
 * reading `setupProgress`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { renderHookWithProviders } from '@/src/test-utils';

const USER_ID = 'user-1';
const HOUSEHOLD_ID = 'household-1';

const membershipsListMock = mock(() => Promise.resolve([] as unknown[]));
const householdsListMock = mock(() => Promise.resolve([] as unknown[]));
const childrenListMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
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

function ownerMembership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'member-owner',
    household_id: HOUSEHOLD_ID,
    user_id: USER_ID,
    role: 'owner',
    can_edit: true,
    status: 'active',
    display_name_override: null,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function householdRow(overrides: Record<string, unknown> = {}) {
  return {
    id: HOUSEHOLD_ID,
    created_by: USER_ID,
    name: 'Test household',
    timezone: 'UTC',
    ...overrides,
  };
}

beforeEach(() => {
  membershipsListMock.mockReset();
  householdsListMock.mockReset();
  childrenListMock.mockReset();
  membershipsListMock.mockResolvedValue([]);
  householdsListMock.mockResolvedValue([]);
  childrenListMock.mockResolvedValue([]);
  useAuthStore.setState({
    session: { user: { id: USER_ID } } as any,
    isInitialized: true,
  });
});

describe('useIsOnboarded', () => {
  it('is loading while memberships are in flight — never a bare false', () => {
    membershipsListMock.mockImplementation(() => new Promise(() => {}));
    householdsListMock.mockResolvedValue([householdRow()]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    expect(result.current.status).toBe('loading');
    expect(result.current.role).toBeNull();
  });

  it('is not-onboarded with no role when the user has no memberships', async () => {
    membershipsListMock.mockResolvedValue([]);
    householdsListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('not-onboarded'));
    expect(result.current.role).toBeNull();
    expect(result.current.householdId).toBeNull();
  });

  it('is onboarded as a parent once they own a household with >= 1 child', async () => {
    membershipsListMock.mockResolvedValue([ownerMembership()]);
    householdsListMock.mockResolvedValue([householdRow()]);
    childrenListMock.mockResolvedValue([{ id: 'child-1', name: 'Ada' }]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('parent');
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
  });

  it('is not-onboarded as a parent when the owned household has no children yet', async () => {
    membershipsListMock.mockResolvedValue([ownerMembership()]);
    householdsListMock.mockResolvedValue([householdRow()]);
    childrenListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('not-onboarded'));
    expect(result.current.role).toBe('parent');
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
  });

  it('is onboarded as a co-parent on parent membership alone — no children fetch', async () => {
    membershipsListMock.mockResolvedValue([
      ownerMembership({
        role: 'parent',
        user_id: USER_ID,
      }),
    ]);
    householdsListMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('parent');
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
    expect(childrenListMock).not.toHaveBeenCalled();
  });

  it('is onboarded as a nanny once she has an active nanny membership', async () => {
    membershipsListMock.mockResolvedValue([
      ownerMembership({
        role: 'nanny',
        user_id: USER_ID,
      }),
    ]);
    householdsListMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('nanny');
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
    expect(childrenListMock).not.toHaveBeenCalled();
  });

  it('is onboarded as a helper with SETUP_ROLES.HELPER', async () => {
    membershipsListMock.mockResolvedValue([
      ownerMembership({
        role: 'helper',
        user_id: USER_ID,
      }),
    ]);
    householdsListMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('helper');
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
  });
});
