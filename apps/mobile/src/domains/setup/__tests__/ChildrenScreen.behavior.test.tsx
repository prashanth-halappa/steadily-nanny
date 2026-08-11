/**
 * @module domains/setup/__tests__/ChildrenScreen.behavior.test
 *
 * Pattern B (behavior) — F-B11-6. A bare `catch {}` in the bootstrap effect
 * (household auto-create) used to reset the retry ref and surface nothing,
 * stranding the parent on an infinite `LoadingIndicator` with no way forward.
 * Asserts a failed bootstrap shows a visible retry affordance, and that
 * tapping it re-attempts the bootstrap.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { CreateHouseholdInput } from '@steadily-nanny/shared-types/schemas/household.schema';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';

const listHouseholdsMock = mock(() => Promise.resolve([]));
const createHouseholdMock = mock(
  (_req: CreateHouseholdInput): Promise<{ id: string; name: string }> =>
    Promise.reject(new Error('network down'))
);
const getProfileMock = mock(() =>
  Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);
const upsertProfileMock = mock(
  (_req: { name: string }): Promise<{ user_id: string; name: string }> =>
    Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);
const listChildrenMock = mock(() => Promise.resolve([]));

const mockPush = mock();
const mockReplace = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mock(),
    navigate: mock(),
  }),
}));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listHouseholdsMock,
    create: createHouseholdMock,
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    upsertProfile: upsertProfileMock,
  },
}));
mock.module('@/src/api/endpoints/children', () => ({
  childrenApi: { list: listChildrenMock },
}));
mock.module('@/src/lib/toast', () => ({
  showErrorToast: mock(() => {}),
}));
// ChildrenManager drags in ManageCommitmentsSection's icon/switch deps, which
// bun:test can't bundle — irrelevant to the bootstrap-failure path under test.
mock.module('../components/ChildrenManager', () => {
  const React = require('react');
  return {
    ChildrenManager: () =>
      React.createElement('View', { testID: 'children-manager-stub' }),
  };
});

let ChildrenScreen: typeof import('../components/ChildrenScreen').ChildrenScreen;

beforeAll(async () => {
  const mod = await import('../components/ChildrenScreen');
  ChildrenScreen = mod.ChildrenScreen;
});

beforeEach(() => {
  listHouseholdsMock.mockClear();
  createHouseholdMock.mockClear();
  getProfileMock.mockClear();
  upsertProfileMock.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  getProfileMock.mockImplementation(() =>
    Promise.resolve({ user_id: 'user-1', name: 'Ana' })
  );
  useSetupProgressStore.getState().reset();
  useSetupProgressStore.setState({ role: 'parent', path: 'create' } as never);
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} },
    } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ChildrenScreen — bootstrap failure surfacing (F-B11-6)', () => {
  it('shows a retry affordance when household bootstrap fails, instead of spinning forever', async () => {
    const screen = renderWithProviders(<ChildrenScreen />);

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy());
  });

  it('re-attempts the bootstrap when the retry affordance is pressed', async () => {
    const screen = renderWithProviders(<ChildrenScreen />);

    await waitFor(() => expect(screen.getByTestId('error-state')).toBeTruthy());

    createHouseholdMock.mockImplementationOnce(() =>
      Promise.resolve({ id: 'household-1', name: 'Our household' })
    );
    fireEvent.press(screen.getByText('tryAgain'));

    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalledTimes(2));
  });
});

describe('ChildrenScreen — the name inputs moved to HOUSEHOLD (spec §3.3)', () => {
  it('no longer renders either name field — they live on HouseholdScreen now', async () => {
    createHouseholdMock.mockImplementationOnce(() =>
      Promise.resolve({ id: 'household-1', name: 'Our household' })
    );
    const screen = renderWithProviders(<ChildrenScreen />);

    expect(screen.queryByTestId('household-name-input')).toBeNull();
    expect(screen.queryByTestId('parent-name-input')).toBeNull();
  });

  it('still auto-creates a household under the default name — the fallback survives', async () => {
    createHouseholdMock.mockImplementationOnce(() =>
      Promise.resolve({ id: 'household-1', name: 'Our household' })
    );
    renderWithProviders(<ChildrenScreen />);

    await waitFor(() => expect(createHouseholdMock).toHaveBeenCalledTimes(1));
    expect(createHouseholdMock.mock.calls[0]?.[0]).toEqual({
      name: 'Our household',
      timezone: 'America/Los_Angeles',
      currency: 'GBP',
    });
  });
});

describe('ChildrenScreen — a JOINING parent must never reach this screen', () => {
  it('bounces to CODE and creates nothing', async () => {
    useSetupProgressStore.setState({ role: 'parent', path: 'join' } as never);
    renderWithProviders(<ChildrenScreen />);

    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe('CODE')
    );
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/code');
    expect(createHouseholdMock).not.toHaveBeenCalled();
  });
});
