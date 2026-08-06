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
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';

const listHouseholdsMock = mock(() => Promise.resolve([]));
const createHouseholdMock = mock(
  (): Promise<{ id: string; name: string }> =>
    Promise.reject(new Error('network down'))
);
const getProfileMock = mock(() =>
  Promise.resolve({ user_id: 'user-1', name: 'Ana' })
);
const listChildrenMock = mock(() => Promise.resolve([]));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listHouseholdsMock,
    create: createHouseholdMock,
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    upsertProfile: mock(() =>
      Promise.resolve({ user_id: 'user-1', name: 'Ana' })
    ),
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
  useSetupProgressStore.setState({ householdId: null } as never);
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
