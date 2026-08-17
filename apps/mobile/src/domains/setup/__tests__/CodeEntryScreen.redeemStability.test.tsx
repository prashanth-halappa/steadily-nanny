/**
 * @module domains/setup/__tests__/CodeEntryScreen.redeemStability.test
 *
 * Regression — a consumed invite code must not tear down the join UI, and a
 * failure after a successful redeem must be visible (not swallowed by the
 * bare catch in `runJoin`).
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
const DRAFT_PREVIEW: PreviewFixture = {
  household_name: "Marisol's terms",
  children_first_names: [],
  household_state: 'draft',
  carer_name: 'Marisol',
};
const MEMBERSHIP = {
  id: 'member-1',
  household_id: 'household-1',
  role: 'nanny',
};

function liveHousehold(id: string, name: string) {
  return { id, name, state: 'live' };
}

let previewCallCount = 0;

const previewInviteMock = mock((): Promise<PreviewFixture> => {
  previewCallCount += 1;
  if (previewCallCount === 1) {
    return Promise.resolve(LIVE_PREVIEW);
  }
  return Promise.reject(new Error('invite consumed'));
});
const redeemInviteMock = mock(() => Promise.resolve(MEMBERSHIP));
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
  previewCallCount = 0;
  previewInviteMock.mockClear();
  previewInviteMock.mockImplementation(() => {
    previewCallCount += 1;
    if (previewCallCount === 1) {
      return Promise.resolve(LIVE_PREVIEW);
    }
    return Promise.reject(new Error('invite consumed'));
  });
  redeemInviteMock.mockClear();
  redeemInviteMock.mockImplementation(() => Promise.resolve(MEMBERSHIP));
  listHouseholdsMock.mockClear();
  listHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  listPastHouseholdsMock.mockClear();
  listPastHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  getProfileMock.mockReset();
  getProfileMock.mockImplementation(() => Promise.resolve(null));
  mockPush.mockClear();
  mockPush.mockImplementation(() => {});
  mockReplace.mockClear();
  mockBack.mockClear();
  mockSignOut.mockClear();
  useSetupProgressStore.getState().reset();
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
  // The name box no longer arrives prefilled with the email local-part, and
  // `onJoin` refuses an empty name — so a wizard-path test has to type one,
  // exactly as a real nanny now does. Only when it is empty, so a seeded
  // existing name stays untouched.
  const nameInput = screen.queryByTestId('name-input');
  if (nameInput && !nameInput.props.value) {
    fireEvent.changeText(nameInput, 'Ana Ruiz');
  }
}

function ctaLabel(screen: ReturnType<typeof renderWithProviders>) {
  return screen.getByTestId('code-screen-cta').props.children.props.children;
}

const JOIN_CTA = 'onboarding.code.joinHousehold';

describe('CodeEntryScreen — post-redeem preview stability (onboarding wizard)', () => {
  it('keeps the preview card and join CTA after redeem when preview refetch 404s', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    // `useRedeemInvite` invalidates `household.*`; without locking the preview
    // query that refetch 404s on a consumed code and tears down the join UI.
    expect(previewInviteMock).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('code-preview-card')).toBeTruthy();
    expect(ctaLabel(screen)).toBe(JOIN_CTA);
    expect(screen.queryByTestId('code-error')).toBeNull();
  });
});

describe('CodeEntryScreen — post-redeem failure visibility (onboarding wizard)', () => {
  it('surfaces an inline error when navigation fails after a successful redeem', async () => {
    mockReplace.mockImplementation(() => {
      throw new Error('navigation failed');
    });
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() =>
      expect(screen.getByTestId('post-redeem-error')).toBeTruthy()
    );
    expect(screen.getByTestId('code-preview-card')).toBeTruthy();
    expect(ctaLabel(screen)).toBe(JOIN_CTA);
  });
});

describe('CodeEntryScreen — post-redeem preview stability (settings onJoined)', () => {
  beforeEach(() => {
    previewInviteMock.mockImplementation(() => {
      previewCallCount += 1;
      if (previewCallCount === 1) {
        return Promise.resolve({
          household_name: 'The Ruiz family',
          children_first_names: ['Mia'],
          household_state: 'live',
          carer_name: null,
        });
      }
      return Promise.reject(new Error('invite consumed'));
    });
  });

  it('keeps the preview card and join CTA after redeem when preview refetch 404s', async () => {
    const onJoinedMock = mock(() => {});
    const screen = renderWithProviders(
      <CodeEntryScreen onJoined={onJoinedMock} />
    );

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(onJoinedMock).toHaveBeenCalledTimes(1));
    expect(previewInviteMock).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('code-preview-card')).toBeTruthy();
    expect(ctaLabel(screen)).toBe(JOIN_CTA);
    expect(screen.queryByTestId('code-error')).toBeNull();
  });

  it('surfaces an inline error when onJoined throws after a successful redeem', async () => {
    const onJoinedMock = mock(() => {
      throw new Error('navigation failed');
    });
    const screen = renderWithProviders(
      <CodeEntryScreen onJoined={onJoinedMock} />
    );

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() =>
      expect(screen.getByTestId('post-redeem-error')).toBeTruthy()
    );
    expect(useSetupProgressStore.getState().role).toBeNull();
    expect(useSetupProgressStore.getState().currentStep).toBe(SETUP_STEPS.ROLE);
  });
});

describe('CodeEntryScreen — post-redeem preview stability (absorption path)', () => {
  beforeEach(() => {
    previewInviteMock.mockImplementation(() => {
      previewCallCount += 1;
      if (previewCallCount === 1) {
        return Promise.resolve(DRAFT_PREVIEW);
      }
      return Promise.reject(new Error('invite consumed'));
    });
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
  });

  it('keeps the preview card and join CTA after absorption redeem when preview refetch 404s', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('absorption-confirm-button')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('absorption-confirm-button'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    // `useRedeemInvite` invalidates `household.*`; without locking the preview
    // query that refetch 404s on a consumed code and tears down the join UI.
    expect(previewInviteMock).toHaveBeenCalledTimes(1);

    expect(screen.getByTestId('code-preview-card')).toBeTruthy();
    expect(ctaLabel(screen)).toBe(JOIN_CTA);
    expect(screen.queryByTestId('code-error')).toBeNull();
  });
});
