/**
 * @module domains/setup/__tests__/CodeEntryScreen.weekStartsOn.test
 *
 * D-8 at the REDEMPTION boundary. When a parent with no live household
 * redeems a nanny's draft code, 094 INSTANTIATES a new live household — and
 * nothing has ever set `week_starts_on` on a nanny-authored draft, so it
 * would carry 075's SQL default of 1 (Monday) into a US family's FLSA
 * workweek and lock it the moment a timesheet exists. The redeemer is the
 * employer; their device decides it, exactly as it does on the parent
 * `create` path (`ChildrenScreen.weekStartsOn.test.tsx`).
 *
 * A separate file from `CodeEntryScreen.behavior.test.tsx` for the same
 * reason its ChildrenScreen sibling is separate: `expo-localization` has to
 * be mocked to a US region BEFORE the screen is imported, and the global
 * preload (`bun.setup.ts`) pins `regionCode: 'GB'`.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';
import { useSetupProgressStore } from '@/src/store/setupProgress';
import { renderWithProviders } from '@/src/test-utils';

mock.module('expo-localization', () => ({
  getLocales: mock(() => [
    {
      languageCode: 'en',
      regionCode: 'US',
      languageTag: 'en-US',
      currencyCode: 'USD',
    },
  ]),
  getCalendars: mock(() => [{ timeZone: 'America/Los_Angeles' }]),
}));

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: mock(),
    navigate: mock(),
  }),
}));

const INVITE_PREVIEW = {
  household_name: null,
  children_first_names: [],
  household_state: 'draft',
  carer_name: 'Marisol',
};

const previewInviteMock = mock(() => Promise.resolve(INVITE_PREVIEW));
const redeemInviteMock = mock(
  (
    _code: string,
    _targetHouseholdId?: string,
    _weekStartsOn?: number
  ): Promise<unknown> =>
    Promise.resolve({ id: 'member-1', household_id: 'household-1' })
);
const getProfileMock = mock(() =>
  Promise.resolve({ user_id: 'user-1', name: 'Ana' } as unknown)
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    previewInvite: previewInviteMock,
    redeemInvite: redeemInviteMock,
    list: mock(() => Promise.resolve([])),
    listPast: mock(() => Promise.resolve([])),
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: {
    getProfile: getProfileMock,
    upsertProfile: mock(() =>
      Promise.resolve({ user_id: 'user-1', name: 'Ana' })
    ),
    updateName: mock(() => Promise.resolve({ user_id: 'user-1', name: 'Ana' })),
  },
}));
mock.module('@/src/lib/userDevice', () => ({
  registerDeviceWithBackend: mock(() => Promise.resolve()),
}));

let CodeEntryScreen: typeof import('../components/CodeEntryScreen').CodeEntryScreen;

beforeAll(async () => {
  const mod = await import('../components/CodeEntryScreen');
  CodeEntryScreen = mod.CodeEntryScreen;
});

beforeEach(() => {
  redeemInviteMock.mockClear();
  usePendingDeepLinkStore.setState({ pendingHref: null, setAt: null });
  useSetupProgressStore.getState().reset();
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'ana@example.com', user_metadata: {} },
    } as unknown as never,
    isInitialized: true,
    signOut: mock(() => Promise.resolve()),
  } as never);
});

describe('CodeEntryScreen — week_starts_on at redemption (D-8)', () => {
  it('sends week_starts_on: 0 (Sunday) for a US-region device', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    fireEvent.changeText(screen.getByTestId('code-input'), 'R4K-92T');
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('code-preview-card')).toBeTruthy()
    );

    fireEvent.changeText(screen.getByTestId('name-input'), 'Ana Ruiz');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(redeemInviteMock.mock.calls[0]?.[2]).toBe(0);
  });
});
