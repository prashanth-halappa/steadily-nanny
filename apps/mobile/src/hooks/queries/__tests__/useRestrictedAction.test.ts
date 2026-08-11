/**
 * @module hooks/queries/__tests__/useRestrictedAction.test
 *
 * S4 (`docs/design/attention-and-notifications.md` §7) — a co-parent in an
 * `approval_mode='owner_only'` household must be told the rule, by name,
 * BEFORE tapping, instead of learning it from a 403.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';

// Key-echo with PARAMS, overriding bun.setup's params-dropping mock: the
// whole point of this hook is which name lands in the sentence.
mock.module('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${JSON.stringify(params)}` : key,
    i18n: { language: 'en', changeLanguage: mock(() => Promise.resolve()) },
  }),
  Trans: ({ children }: { children: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: mock() },
}));

const USER_ID = 'user-coparent';
const OWNER_ID = 'user-owner';
const HOUSEHOLD_ID = 'household-1';

const membershipsListMock = mock(() => Promise.resolve([] as unknown[]));
const householdsListMock = mock(() => Promise.resolve([] as unknown[]));
const householdsListPastMock = mock(() => Promise.resolve([] as unknown[]));
const listMembersMock = mock(() => Promise.resolve([] as unknown[]));
const childrenListMock = mock(() => Promise.resolve([] as unknown[]));

mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: householdsListMock,
    listPast: householdsListPastMock,
    listMembers: listMembersMock,
  },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: childrenListMock },
}));

let useRestrictedAction: typeof import('../useRestrictedAction').useRestrictedAction;
let useAuthStore: typeof import('@/src/store/auth').useAuthStore;
let renderHookWithProviders: typeof import('@/src/test-utils').renderHookWithProviders;

beforeAll(async () => {
  useRestrictedAction = (await import('../useRestrictedAction'))
    .useRestrictedAction;
  useAuthStore = (await import('@/src/store/auth')).useAuthStore;
  renderHookWithProviders = (await import('@/src/test-utils'))
    .renderHookWithProviders;
});

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: `member-${String(overrides.user_id ?? 'x')}`,
    household_id: HOUSEHOLD_ID,
    user_id: USER_ID,
    role: 'parent',
    can_edit: true,
    status: 'active',
    display_name_override: null,
    profile_name: null,
    colour: null,
    joined_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function household(overrides: Record<string, unknown> = {}) {
  return {
    id: HOUSEHOLD_ID,
    created_by: OWNER_ID,
    name: 'Test household',
    timezone: 'UTC',
    approval_mode: 'owner_only',
    ...overrides,
  };
}

const ACTION = 'approve hours';

function render() {
  return renderHookWithProviders(() =>
    useRestrictedAction({ householdId: HOUSEHOLD_ID, action: ACTION })
  );
}

beforeEach(() => {
  for (const m of [
    membershipsListMock,
    householdsListMock,
    householdsListPastMock,
    listMembersMock,
    childrenListMock,
  ]) {
    m.mockReset();
    m.mockResolvedValue([]);
  }
  useAuthStore.setState({
    session: { user: { id: USER_ID } } as never,
    isInitialized: true,
  });
});

describe('useRestrictedAction', () => {
  it('restricts a co-parent under owner_only and NAMES the owner who can act', async () => {
    householdsListMock.mockResolvedValue([household()]);
    listMembersMock.mockResolvedValue([
      member(),
      member({
        user_id: OWNER_ID,
        role: 'owner',
        display_name_override: 'David',
      }),
    ]);

    const { result } = render();

    await waitFor(() => expect(result.current.disabled).toBe(true));
    expect(result.current.reason).toContain('David');
    expect(result.current.reason).toContain(ACTION);
  });

  it('falls back to "the household owner" when the owner has no resolvable name', async () => {
    householdsListMock.mockResolvedValue([household()]);
    listMembersMock.mockResolvedValue([
      member(),
      member({ user_id: OWNER_ID, role: 'owner' }),
    ]);

    const { result } = render();

    await waitFor(() => expect(result.current.disabled).toBe(true));
    expect(result.current.reason).toContain('restrictedActionOwner');
  });

  it('never restricts the OWNER — she is the one who can act', async () => {
    useAuthStore.setState({
      session: { user: { id: OWNER_ID } } as never,
      isInitialized: true,
    });
    householdsListMock.mockResolvedValue([household()]);
    listMembersMock.mockResolvedValue([
      member({ user_id: OWNER_ID, role: 'owner' }),
    ]);

    const { result } = render();

    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
    expect(result.current.disabled).toBe(false);
    expect(result.current.reason).toBeNull();
  });

  it('never restricts under approval_mode "either"', async () => {
    householdsListMock.mockResolvedValue([
      household({ approval_mode: 'either' }),
    ]);
    listMembersMock.mockResolvedValue([
      member(),
      member({ user_id: OWNER_ID, role: 'owner' }),
    ]);

    const { result } = render();

    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
    expect(result.current.disabled).toBe(false);
  });

  it('B5: a HELPER is a different case and never gets this treatment', async () => {
    householdsListMock.mockResolvedValue([household()]);
    listMembersMock.mockResolvedValue([
      member({ role: 'helper' }),
      member({ user_id: OWNER_ID, role: 'owner' }),
    ]);

    const { result } = render();

    await waitFor(() => expect(listMembersMock).toHaveBeenCalled());
    expect(result.current.disabled).toBe(false);
    expect(result.current.reason).toBeNull();
  });

  it('asserts nothing while the household is still loading', () => {
    householdsListMock.mockImplementation(() => new Promise(() => {}));

    const { result } = render();

    expect(result.current.disabled).toBe(false);
    expect(result.current.reason).toBeNull();
  });
});
