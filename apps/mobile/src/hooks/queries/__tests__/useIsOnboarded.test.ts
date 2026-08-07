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
const householdsListPastMock = mock(() => Promise.resolve([] as unknown[]));
const childrenListMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: householdsListMock, listPast: householdsListPastMock },
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
  householdsListPastMock.mockReset();
  childrenListMock.mockReset();
  membershipsListMock.mockResolvedValue([]);
  householdsListMock.mockResolvedValue([]);
  householdsListPastMock.mockResolvedValue([]);
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

  // TanStack v5: when the query is still enabled:false (auth not initialized),
  // isLoading is false (pending+idle) while data is undefined. Using isLoading
  // alone used to report not-onboarded and flash the role fork on cold start /
  // SIGNED_IN. isPending must keep us in loading.
  it('stays loading while auth is not initialized — pending+idle is not not-onboarded', () => {
    useAuthStore.setState({
      session: { user: { id: USER_ID } } as any,
      isInitialized: false,
    });
    membershipsListMock.mockResolvedValue([
      ownerMembership({ role: 'nanny', user_id: USER_ID }),
    ]);
    householdsListMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    expect(result.current.status).toBe('loading');
    expect(result.current.role).toBeNull();
    expect(result.current.membershipsError).toBe(false);
    expect(membershipsListMock).not.toHaveBeenCalled();
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

  // A parent removed a nanny. Her JWT still reads the timesheets, expenses
  // and pay she accrued there (the API read gates allow it) — but with her
  // only membership flipped to `removed`, the pre-existing active-only filter
  // left her with no membership at all, and the entry router dropped her into
  // the "Who are you?" signup wizard. The hours she is owed became
  // unreachable in the app.
  it('is onboarded, flagged past, for a nanny removed from the only household she worked in', async () => {
    membershipsListMock.mockResolvedValue([
      ownerMembership({ role: 'nanny', status: 'removed' }),
    ]);
    householdsListMock.mockResolvedValue([]);
    householdsListPastMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.role).toBe('nanny');
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
    expect(result.current.isPastMember).toBe(true);
  });

  // The other half of the pair: an ACTIVE member must never be flagged past,
  // or every write affordance in the app disappears for everyone.
  it('does NOT flag an active member as past', async () => {
    membershipsListMock.mockResolvedValue([ownerMembership({ role: 'nanny' })]);
    householdsListMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(result.current.isPastMember).toBe(false);
  });

  // Reporting a DIFFERENT household's role for the selected household is
  // worse than reporting none: it would show a nanny the parent surfaces of
  // a family she still works for, while she is looking at the one she left.
  it('reports the removed role for the selected past household, not another household active role', async () => {
    membershipsListMock.mockResolvedValue([
      ownerMembership({
        id: 'member-active-elsewhere',
        household_id: 'household-other',
        role: 'owner',
      }),
      ownerMembership({
        id: 'member-removed',
        role: 'nanny',
        status: 'removed',
      }),
    ]);
    householdsListMock.mockResolvedValue([
      householdRow({ id: 'household-other' }),
    ]);
    householdsListPastMock.mockResolvedValue([
      householdRow({ created_by: 'someone-else' }),
    ]);
    const { useActiveHouseholdStore } = await import(
      '@/src/store/activeHousehold'
    );
    useActiveHouseholdStore.getState().setPreferredHouseholdId(HOUSEHOLD_ID);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.isPastMember).toBe(true));
    expect(result.current.householdId).toBe(HOUSEHOLD_ID);
    expect(result.current.role).toBe('nanny');

    useActiveHouseholdStore.getState().reset();
  });

  // A failed memberships query is NOT "this user never signed up". Observed on
  // device: with the API unreachable, a nanny holding two active memberships
  // was routed to the onboarding role fork. `data` was undefined, the `?? []`
  // at the top of the hook turned that into "no memberships", and the entry
  // router sent her to "Who are you?".
  //
  // These two cases are deliberately a DISCRIMINATING PAIR: a fix that reports
  // `membershipsError` for both the errored and the genuinely-empty case (or
  // for neither) fails one of them. Testing only the error case would pass
  // against `membershipsError: true` hard-coded.
  it('reports membershipsError and does NOT claim not-onboarded when the query fails', async () => {
    membershipsListMock.mockRejectedValue(new Error('network down'));
    householdsListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.membershipsError).toBe(true));
    // The load-bearing assertion: "we don't know" must never be reported as
    // "we know they are not onboarded", because that routes into the wizard.
    expect(result.current.status).not.toBe('not-onboarded');
    expect(result.current.role).toBeNull();
  });

  it('does NOT report membershipsError when the query succeeds with zero memberships', async () => {
    membershipsListMock.mockResolvedValue([]);
    householdsListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.status).toBe('not-onboarded'));
    expect(result.current.membershipsError).toBe(false);
  });

  it('exposes a retry that refetches the memberships query', async () => {
    membershipsListMock.mockRejectedValue(new Error('network down'));
    householdsListMock.mockResolvedValue([]);

    const { result } = renderHookWithProviders(() => useIsOnboarded());

    await waitFor(() => expect(result.current.membershipsError).toBe(true));
    const callsBeforeRetry = membershipsListMock.mock.calls.length;

    membershipsListMock.mockResolvedValue([
      ownerMembership({ role: 'nanny', user_id: USER_ID }),
    ]);
    result.current.retryMemberships();

    await waitFor(() => expect(result.current.status).toBe('onboarded'));
    expect(membershipsListMock.mock.calls.length).toBeGreaterThan(
      callsBeforeRetry
    );
    expect(result.current.membershipsError).toBe(false);
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
