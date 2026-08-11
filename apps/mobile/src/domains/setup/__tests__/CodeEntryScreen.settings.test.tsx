/**
 * @module domains/setup/__tests__/CodeEntryScreen.settings.test
 *
 * Settings variant — an already-onboarded carer redeeming a code for an
 * additional household. Must never touch the MMKV-persisted wizard store.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { SETUP_STEPS } from '@/src/domains/setup/types';
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

const INVITE_PREVIEW = {
  household_name: 'The Ruiz family',
  children_first_names: ['Mia'],
};
const MEMBERSHIP = { id: 'member-1', household_id: 'household-1' };

/** Every profile/redeem write, in the order it actually hit the wire. */
let callOrder: string[] = [];

const previewInviteMock = mock(() => Promise.resolve(INVITE_PREVIEW));
const redeemInviteMock = mock(() => {
  callOrder.push('redeemInvite');
  return Promise.resolve(MEMBERSHIP);
});
const getProfileMock = mock(() => Promise.resolve(null as unknown));
const upsertProfileMock = mock((req: { name: string }) => {
  callOrder.push('upsertProfile');
  return Promise.resolve({ user_id: 'user-1', name: req.name });
});
const updateNameMock = mock((req: { name: string }) => {
  callOrder.push('updateName');
  return Promise.resolve({ user_id: 'user-1', name: req.name });
});

// The absorption confirm (§8.2) reads the redeemer's live households, so this
// screen now mounts `useHouseholds` in both variants.
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
  callOrder = [];
  previewInviteMock.mockClear();
  redeemInviteMock.mockClear();
  upsertProfileMock.mockClear();
  updateNameMock.mockClear();
  getProfileMock.mockReset();
  getProfileMock.mockImplementation(() => Promise.resolve(null));
  mockPush.mockClear();
  mockReplace.mockClear();
  mockBack.mockClear();
  mockSignOut.mockClear();
  useSetupProgressStore.setState({
    role: null,
    currentStep: SETUP_STEPS.ROLE,
    householdId: null,
  });
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} },
    } as unknown as never,
    isInitialized: true,
    signOut: mockSignOut,
  } as never);
});

/** Fill the code, tap Continue, and wait for the preview card to land. */
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

describe('CodeEntryScreen — settings variant (onJoined)', () => {
  it('redeems without profile writes, reports household id, and leaves wizard store untouched', async () => {
    const onJoinedMock = mock();
    const screen = renderWithProviders(
      <CodeEntryScreen onJoined={onJoinedMock} />
    );

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(onJoinedMock).toHaveBeenCalledTimes(1));
    expect(onJoinedMock).toHaveBeenCalledWith('household-1');
    expect(callOrder).toEqual(['redeemInvite']);
    expect(useSetupProgressStore.getState().role).toBeNull();
    expect(useSetupProgressStore.getState().currentStep).toBe(SETUP_STEPS.ROLE);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('hides the name field and sign-out affordance', () => {
    const screen = renderWithProviders(<CodeEntryScreen onJoined={mock()} />);

    expect(screen.queryByTestId('name-input')).toBeNull();
    expect(screen.queryByTestId('code-screen-sign-out')).toBeNull();
  });

  it('back navigates with router.back(), not replace to the role screen', () => {
    const screen = renderWithProviders(<CodeEntryScreen onJoined={mock()} />);

    fireEvent.press(screen.getByTestId('code-screen-back'));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalledWith('/onboarding/role');
  });
});
