/**
 * @module domains/setup/__tests__/CodeEntryScreen.remountRecovery.test
 *
 * Regression — redeem invalidates memberships, which briefly unmounts the
 * onboarding Stack while `useIsOnboarded` refetches. A remounted CODE screen
 * must resume the wizard from persisted setup-progress state, not present an
 * empty code form for a code that was already consumed.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import {
  SETUP_PATHS,
  SETUP_ROLES,
  SETUP_STEPS,
} from '@/src/domains/setup/types';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';
import { CodeEntryScreen } from '../components/CodeEntryScreen';

const mockPush = mock();
const mockReplace = mock();
const mockBack = mock();
const mockSignOut = mock(() => Promise.resolve());
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mockBack,
    navigate: mock(),
  }),
}));

interface PreviewFixture {
  household_name: string;
  children_first_names: string[];
  household_state: string;
  carer_name: string | null;
}

const LIVE_PREVIEW: PreviewFixture = {
  household_name: 'The Ruiz family',
  children_first_names: ['Mia'],
  household_state: 'live',
  carer_name: null,
};

const PARENT_MEMBERSHIP = {
  id: 'member-1',
  household_id: 'household-1',
  role: 'parent',
};

const previewInviteMock = mock(
  (): Promise<PreviewFixture> => Promise.resolve(LIVE_PREVIEW)
);
const redeemInviteMock = mock(() => Promise.resolve(PARENT_MEMBERSHIP));
const getProfileMock = mock(() => Promise.resolve(null as unknown));
const upsertProfileMock = mock((req: { name: string }) =>
  Promise.resolve({ user_id: 'user-1', name: req.name })
);
const updateNameMock = mock((req: { name: string }) =>
  Promise.resolve({ user_id: 'user-1', name: req.name })
);
const listHouseholdsMock = mock((): Promise<unknown[]> => Promise.resolve([]));
const listPastHouseholdsMock = mock(
  (): Promise<unknown[]> => Promise.resolve([])
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    previewInvite: previewInviteMock,
    redeemInvite: redeemInviteMock,
    list: listHouseholdsMock,
    listPast: listPastHouseholdsMock,
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    upsertProfile: upsertProfileMock,
    updateName: updateNameMock,
  },
}));
mock.module('@/src/lib/userDevice', () => ({
  registerDeviceWithBackend: mock(() => Promise.resolve()),
}));

beforeEach(() => {
  previewInviteMock.mockClear();
  previewInviteMock.mockImplementation(() => Promise.resolve(LIVE_PREVIEW));
  redeemInviteMock.mockClear();
  redeemInviteMock.mockImplementation(() => Promise.resolve(PARENT_MEMBERSHIP));
  listHouseholdsMock.mockClear();
  listHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  listPastHouseholdsMock.mockClear();
  listPastHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  getProfileMock.mockReset();
  getProfileMock.mockImplementation(() => Promise.resolve(null));
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockSignOut.mockClear();
  useSetupProgressStore.getState().reset();
  useSetupProgressStore.getState().setRole(SETUP_ROLES.PARENT);
  useSetupProgressStore.getState().setPath(SETUP_PATHS.JOIN);
  useSetupProgressStore.getState().setCurrentStep(SETUP_STEPS.CODE);
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} },
    } as unknown as never,
    isInitialized: true,
    signOut: mockSignOut,
  } as never);
});

async function enterCode(
  screen: ReturnType<typeof renderWithProviders>,
  code = 'R4K-92T'
) {
  fireEvent.changeText(screen.getByTestId('code-input'), code);
  fireEvent.press(screen.getByTestId('code-screen-cta'));
  await waitFor(() =>
    expect(screen.getByTestId('code-preview-card')).toBeTruthy()
  );
}

describe('CodeEntryScreen — remount recovery after redeem', () => {
  it('navigates to the persisted next step after a successful parent redeem', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe(
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    );
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/notifications');
  });

  it('does not present an empty code form when remounted after redeem already advanced the wizard', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe(
        SETUP_STEPS.NOTIFICATIONS_PERMISSION
      )
    );
    screen.unmount();
    mockReplace.mockClear();

    const remounted = renderWithProviders(<CodeEntryScreen />);

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/onboarding/notifications')
    );
    expect(remounted.getByTestId('code-screen-resuming-cta')).toBeTruthy();
    expect(remounted.queryByTestId('code-input')).toBeNull();
    expect(remounted.queryByTestId('code-screen-cta')).toBeNull();
  });
});
