/**
 * @module domains/setup/__tests__/CodeEntryScreen.decision.test
 *
 * Direction workstream 8c / plan §S6 D2. `HouseholdDecisionSheet` fires
 * ONLY when the invite preview says a LIVE household + a PARENT role AND
 * the redeemer already has a live household of their own — never during
 * first onboarding (no household yet), never for a nanny/helper invite.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { Share } from 'react-native';
import { useAuthStore } from '@/src/store/auth';
import { usePendingDeepLinkStore } from '@/src/store/pendingDeepLinkStore';
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

const shareSpy = Share.share as unknown as ReturnType<typeof mock>;

const EXISTING_HOUSEHOLD = {
  id: 'household-existing',
  name: 'The Okafor family',
  state: 'live',
};

const setActiveHouseholdIdMock = mock((_householdId: string) => {});
mock.module('@/src/hooks/queries/useActiveHousehold', () => ({
  useActiveHousehold: () => ({
    household: null,
    householdId: null,
    households: [],
    pastHouseholds: [],
    isPastHousehold: false,
    setActiveHouseholdId: setActiveHouseholdIdMock,
    isLoading: false,
    isError: false,
  }),
}));

interface PreviewFixture {
  household_name: string;
  children_first_names: string[];
  household_state: string;
  role: string;
  carer_name: string | null;
}

let previewFixture: PreviewFixture = {
  household_name: 'The Wilson family',
  children_first_names: [],
  household_state: 'live',
  role: 'parent',
  carer_name: null,
};

const MEMBERSHIP = { id: 'member-1', household_id: 'household-new' };

const previewInviteMock = mock(
  (): Promise<PreviewFixture> => Promise.resolve(previewFixture)
);
const redeemInviteMock = mock(
  (
    _code: string,
    _targetHouseholdId?: string,
    _weekStartsOn?: number,
    _archiveHouseholdId?: string
  ): Promise<unknown> => Promise.resolve(MEMBERSHIP)
);
const getProfileMock = mock(() =>
  Promise.resolve({ user_id: 'user-1', name: 'Tunde' })
);
const upsertProfileMock = mock((req: { name: string }) =>
  Promise.resolve({ user_id: 'user-1', name: req.name })
);
const updateNameMock = mock((req: { name: string }) =>
  Promise.resolve({ user_id: 'user-1', name: req.name })
);

let listHouseholdsResult: unknown[] = [];
const listHouseholdsMock = mock(
  (): Promise<unknown[]> => Promise.resolve(listHouseholdsResult)
);
const listPastHouseholdsMock = mock(
  (): Promise<unknown[]> => Promise.resolve([])
);
const listMembersMock = mock((): Promise<unknown[]> => Promise.resolve([]));
const createInviteMock = mock(
  (_householdId: string, _input: { role: string }) =>
    Promise.resolve({ code: 'ABC-123', role: 'parent' })
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    previewInvite: previewInviteMock,
    redeemInvite: redeemInviteMock,
    list: listHouseholdsMock,
    listPast: listPastHouseholdsMock,
    listMembers: listMembersMock,
    createInvite: createInviteMock,
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
  previewFixture = {
    household_name: 'The Wilson family',
    children_first_names: [],
    household_state: 'live',
    role: 'parent',
    carer_name: null,
  };
  listHouseholdsResult = [EXISTING_HOUSEHOLD];
  previewInviteMock.mockClear();
  previewInviteMock.mockImplementation(() => Promise.resolve(previewFixture));
  redeemInviteMock.mockClear();
  redeemInviteMock.mockImplementation(() => Promise.resolve(MEMBERSHIP));
  listHouseholdsMock.mockClear();
  listHouseholdsMock.mockImplementation(() =>
    Promise.resolve(listHouseholdsResult)
  );
  listPastHouseholdsMock.mockClear();
  listMembersMock.mockClear();
  listMembersMock.mockImplementation(() => Promise.resolve([]));
  createInviteMock.mockClear();
  createInviteMock.mockImplementation(() =>
    Promise.resolve({ code: 'ABC-123', role: 'parent' })
  );
  shareSpy.mockClear();
  mockPush.mockClear();
  mockReplace.mockClear();
  setActiveHouseholdIdMock.mockClear();
  usePendingDeepLinkStore.setState({ pendingHref: null, setAt: null });
  useSetupProgressStore.getState().reset();
  useAuthStore.setState({
    session: {
      user: { id: 'user-1', email: 'tunde@example.com', user_metadata: {} },
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

describe('CodeEntryScreen — HouseholdDecisionSheet (§8c)', () => {
  it('fires for a live parent-role invite when he already has a live household', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);
    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() =>
      expect(
        screen.getByTestId('household-decision-sheet-modal').props.visible
      ).toBe(true)
    );
    expect(redeemInviteMock).not.toHaveBeenCalled();
  });

  it('does not fire for a nanny-role invite', async () => {
    previewFixture = { ...previewFixture, role: 'nanny' };
    const screen = renderWithProviders(<CodeEntryScreen />);
    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Tunde Okafor');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('household-decision-sheet-modal').props.visible
    ).toBe(false);
  });

  it('does not fire for a helper-role invite', async () => {
    previewFixture = { ...previewFixture, role: 'helper' };
    const screen = renderWithProviders(<CodeEntryScreen />);
    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Tunde Okafor');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('household-decision-sheet-modal').props.visible
    ).toBe(false);
  });

  it('does not fire during first onboarding — no existing household', async () => {
    listHouseholdsResult = [];
    const screen = renderWithProviders(<CodeEntryScreen />);
    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Tunde Okafor');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(
      screen.getByTestId('household-decision-sheet-modal').props.visible
    ).toBe(false);
  });

  it('Invite instead mints a parent invite for the existing household, shares it, and lands on /settings/invite', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);
    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(
        screen.getByTestId('household-decision-sheet-modal').props.visible
      ).toBe(true)
    );

    fireEvent.press(screen.getByTestId('household-decision-invite-instead'));

    await waitFor(() => expect(createInviteMock).toHaveBeenCalledTimes(1));
    expect(createInviteMock.mock.calls[0]?.[0]).toBe(EXISTING_HOUSEHOLD.id);
    expect(createInviteMock.mock.calls[0]?.[1]).toMatchObject({
      role: 'parent',
    });
    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1));
    // The i18n test preload's `t()` echoes bare keys (ignores interpolation
    // params) — this asserts the right MESSAGE KEY was built, not the
    // literal interpolated string; `HouseholdDecisionSheet.test.tsx`
    // exercises the sheet's own copy in isolation.
    expect(shareSpy.mock.calls[0]?.[0]?.message).toBe('decision.shareMessage');
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith('/settings/invite')
    );
    expect(redeemInviteMock).not.toHaveBeenCalled();
  });

  it('Join & close redeems with archiveHouseholdId set to the existing household', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);
    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(
        screen.getByTestId('household-decision-sheet-modal').props.visible
      ).toBe(true)
    );

    fireEvent.press(screen.getByTestId('household-decision-join-close'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(redeemInviteMock.mock.calls[0]?.[3]).toBe(EXISTING_HOUSEHOLD.id);
    await waitFor(() =>
      expect(setActiveHouseholdIdMock).toHaveBeenCalledWith(
        MEMBERSHIP.household_id
      )
    );
  });
});
