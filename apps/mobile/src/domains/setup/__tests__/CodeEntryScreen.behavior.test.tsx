/**
 * @module domains/setup/__tests__/CodeEntryScreen.behavior.test
 *
 * Pattern B (behavior) — the nanny flow never collected a name, so the
 * server-bootstrapped `user_profiles` row stayed `name: null` and every
 * money surface her family sees rendered the 'Carer' fallback.
 *
 * The ORDER is the load-bearing part: the membership snapshot taken at
 * redeem reads the profile, so the name has to be persisted BEFORE
 * `redeemInvite` — asserted here against real hooks with only the API
 * leaves (`householdApi`, `userApi`) mocked.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';
import { CodeEntryScreen } from '../components/CodeEntryScreen';

const mockPush = mock();
const mockReplace = mock();
const mockSignOut = mock(() => Promise.resolve());
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    back: mock(),
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

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    previewInvite: previewInviteMock,
    redeemInvite: redeemInviteMock,
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
  mockSignOut.mockClear();
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

describe('CodeEntryScreen — nanny name (GAP 1)', () => {
  it('persists the typed name BEFORE redeeming the invite', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Ana Ruiz');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(['upsertProfile', 'redeemInvite']);
    expect(upsertProfileMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'Ana Ruiz',
    });
    // The profile write must not swallow the step advance it now precedes.
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe('AVAILABILITY')
    );
  });

  it('never redeems with an empty name — the whole point of the step', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), '   ');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(screen.getByTestId('name-error')).toBeTruthy());
    expect(redeemInviteMock).not.toHaveBeenCalled();
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it('pre-fills an existing profile name and patches it — never re-upserts placeholder city/country', async () => {
    getProfileMock.mockImplementation(() =>
      Promise.resolve({
        user_id: 'user-1',
        name: 'Ana',
        city: 'Madrid',
        country: 'ES',
      })
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('name-input').props.value).toBe('Ana')
    );
    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Ana Ruiz');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(['updateName', 'redeemInvite']);
    expect(updateNameMock.mock.calls[0]?.[0]).toEqual({ name: 'Ana Ruiz' });
    expect(upsertProfileMock).not.toHaveBeenCalled();
  });

  it('leaves an unchanged existing name alone and still redeems', async () => {
    getProfileMock.mockImplementation(() =>
      Promise.resolve({ user_id: 'user-1', name: 'Ana', city: 'Madrid' })
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('name-input').props.value).toBe('Ana')
    );
    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(['redeemInvite']);
    expect(updateNameMock).not.toHaveBeenCalled();
  });

  it('falls back to the auth-derived name, same as the parent bootstrap does', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await waitFor(() =>
      expect(screen.getByTestId('name-input').props.value).toBe('ana')
    );
  });
});

describe('CodeEntryScreen — role branch (WS-F)', () => {
  it('a nanny membership advances to AVAILABILITY and sets the local role to nanny', async () => {
    redeemInviteMock.mockImplementationOnce(() => {
      callOrder.push('redeemInvite');
      return Promise.resolve({ ...MEMBERSHIP, role: 'nanny' });
    });
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe('AVAILABILITY')
    );
    expect(useSetupProgressStore.getState().role).toBe('nanny');
  });

  it('a parent (co-parent) membership sets the local role to parent and skips straight to NOTIFICATIONS_PERMISSION — they are joining an existing household, not creating one', async () => {
    redeemInviteMock.mockImplementationOnce(() => {
      callOrder.push('redeemInvite');
      return Promise.resolve({ ...MEMBERSHIP, role: 'parent' });
    });
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe(
        'NOTIFICATIONS_PERMISSION'
      )
    );
    expect(useSetupProgressStore.getState().role).toBe('parent');
  });

  it('a helper membership skips availability entirely and advances straight to NOTIFICATIONS_PERMISSION', async () => {
    redeemInviteMock.mockImplementationOnce(() => {
      callOrder.push('redeemInvite');
      return Promise.resolve({ ...MEMBERSHIP, role: 'helper' });
    });
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useSetupProgressStore.getState().currentStep).toBe(
        'NOTIFICATIONS_PERMISSION'
      )
    );
    expect(useSetupProgressStore.getState().role).toBe('helper');
  });
});

describe('CodeEntryScreen — trapped-nanny escape hatches (W1-E fix 2)', () => {
  it('renders a back affordance that returns to the role screen', () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    const back = screen.getByTestId('code-screen-back');
    expect(back).toBeTruthy();
    fireEvent.press(back);

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/role');
  });

  it('renders a sign-out affordance that calls the auth store sign-out', () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    const signOutButton = screen.getByTestId('code-screen-sign-out');
    expect(signOutButton).toBeTruthy();
    fireEvent.press(signOutButton);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});
