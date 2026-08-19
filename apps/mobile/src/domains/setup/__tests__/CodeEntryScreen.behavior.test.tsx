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
  carer_name: string | null;
}

const INVITE_PREVIEW: PreviewFixture = {
  household_name: 'The Ruiz family',
  children_first_names: ['Mia'],
  household_state: 'live',
  carer_name: null,
};
const MEMBERSHIP = { id: 'member-1', household_id: 'household-1' };

function liveHousehold(id: string, name: string) {
  return { id, name, state: 'live' };
}

/** Every profile/redeem write, in the order it actually hit the wire. */
let callOrder: string[] = [];

const previewInviteMock = mock(
  (): Promise<PreviewFixture> => Promise.resolve(INVITE_PREVIEW)
);
const redeemInviteMock = mock(
  (_code: string, _targetHouseholdId?: string): Promise<unknown> => {
    callOrder.push('redeemInvite');
    return Promise.resolve(MEMBERSHIP);
  }
);
const getProfileMock = mock(() => Promise.resolve(null as unknown));
const upsertProfileMock = mock((req: { name: string; phone?: string }) => {
  callOrder.push('upsertProfile');
  return Promise.resolve({ user_id: 'user-1', name: req.name });
});
const updateNameMock = mock((req: { name: string }) => {
  callOrder.push('updateName');
  return Promise.resolve({ user_id: 'user-1', name: req.name });
});

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
  previewInviteMock.mockImplementation(() => Promise.resolve(INVITE_PREVIEW));
  listHouseholdsMock.mockClear();
  listHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  listPastHouseholdsMock.mockClear();
  listPastHouseholdsMock.mockImplementation(() => Promise.resolve([]));
  usePendingDeepLinkStore.setState({ pendingHref: null, setAt: null });
  useSetupProgressStore.getState().reset();
  setActiveHouseholdIdMock.mockClear();
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
  // The name box no longer arrives prefilled with the email local-part, and
  // `onJoin` refuses an empty name — so a wizard-path test has to type one,
  // exactly as a real nanny now does. ONLY when it is empty: a test seeding an
  // existing profile name is asserting that an UNCHANGED name is not re-sent,
  // and typing over it here would fake the change it is checking for.
  const nameInput = screen.queryByTestId('name-input');
  if (nameInput && !nameInput.props.value) {
    fireEvent.changeText(nameInput, 'Ana Ruiz');
  }
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

  // Was: "falls back to the auth-derived name". It fell back to the EMAIL
  // LOCAL-PART, so signing up as ana@… prefilled the box with "ana" and
  // parent@… prefilled it with "parent" — which is then the name the other
  // party reads on every shift, hour and payment. A name we invented is worse
  // than no name: the placeholder can ask the question, a prefill cannot.
  it('leaves the box empty rather than inventing a name from the email', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await waitFor(() => expect(screen.getByTestId('name-input')).toBeTruthy());
    expect(screen.getByTestId('name-input').props.value).toBe('');
  });
});

// Same thought as the name field: she is already saying who she is, and the
// family needs a number for the 07:40 "the bus isn't moving" call. Optional
// — she can skip and add it later. Invalid junk is still blocked inline.
describe('CodeEntryScreen — nanny mobile number', () => {
  it('renders the field with the nanny label and hint', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);
    await waitFor(() => expect(screen.getByTestId('phone-input')).toBeTruthy());

    expect(screen.getByText('setup.phoneLabel')).toBeTruthy();
    expect(screen.getByText('setup.phoneHintNanny')).toBeTruthy();
    expect(screen.queryByText('setup.phoneHint')).toBeNull();

    const input = screen.getByTestId('phone-input');
    expect(input.props.keyboardType).toBe('phone-pad');
    expect(input.props.textContentType).toBe('telephoneNumber');
    expect(input.props.autoComplete).toBe('tel');
  });

  it('submits a valid number through the existing profile upsert', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Ana Ruiz');
    fireEvent.changeText(screen.getByTestId('phone-input'), '07700 900123');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(callOrder).toEqual(['upsertProfile', 'redeemInvite']);
    expect(upsertProfileMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'Ana Ruiz',
      phone: '07700 900123',
    });
  });

  it('can continue without a number — the field is optional for the nanny', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Ana Ruiz');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('phone-error')).toBeNull();
    expect(upsertProfileMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'Ana Ruiz',
    });
    expect(upsertProfileMock.mock.calls[0]?.[0].phone).toBeUndefined();
  });

  it('blocks an invalid number with an inline error and does not redeem', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.changeText(screen.getByTestId('name-input'), 'Ana Ruiz');
    fireEvent.changeText(screen.getByTestId('phone-input'), 'ask Amara');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(screen.getByTestId('phone-error')).toBeTruthy());
    expect(screen.getByText('setup.phoneInvalid')).toBeTruthy();
    expect(redeemInviteMock).not.toHaveBeenCalled();
    expect(upsertProfileMock).not.toHaveBeenCalled();
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

  it('an OWNER membership from nanny-first draft redeem maps to parent setup role — not nanny/Availability (Phase 6 B2)', async () => {
    // 094 instantiate makes the redeemer owner. redeemInvite returns that
    // row; without OWNER→PARENT mapping the wizard fell through to NANNY.
    redeemInviteMock.mockImplementationOnce(() => {
      callOrder.push('redeemInvite');
      return Promise.resolve({ ...MEMBERSHIP, role: 'owner' });
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
    expect(mockReplace).toHaveBeenCalledWith('/onboarding/notifications');
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

describe('CodeEntryScreen — active household after redeem (B3)', () => {
  it('sets the active household to the redeemed membership on success', async () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(setActiveHouseholdIdMock).toHaveBeenCalledWith(
      MEMBERSHIP.household_id
    );
  });

  it('does not set the active household when redeem fails', async () => {
    redeemInviteMock.mockImplementationOnce(() => {
      callOrder.push('redeemInvite');
      return Promise.reject(new Error('invalid code'));
    });

    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(setActiveHouseholdIdMock).not.toHaveBeenCalled();
  });
});

describe('CodeEntryScreen — trapped-nanny escape hatches (W1-E fix 2)', () => {
  it('renders a back affordance that returns to the start fork', () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    const back = screen.getByTestId('code-screen-back');
    expect(back).toBeTruthy();
    fireEvent.press(back);

    expect(mockReplace).toHaveBeenCalledWith('/onboarding/start');
  });

  it('renders a sign-out affordance that calls the auth store sign-out', () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    const signOutButton = screen.getByTestId('code-screen-sign-out');
    expect(signOutButton).toBeTruthy();
    fireEvent.press(signOutButton);

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });
});

describe('CodeEntryScreen — two entry modes (D-50, §3.4)', () => {
  it('mode b is the default: empty field, nothing pre-filled', () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    expect(screen.getByTestId('code-input').props.value).toBe('');
  });

  it('mode a, step 1: a code on the route params pre-fills the field', () => {
    const screen = renderWithProviders(
      <CodeEntryScreen initialCode="R4K-92T" />
    );

    expect(screen.getByTestId('code-input').props.value).toBe('R4K-92T');
  });

  it('mode a, step 2: a link tapped while signed out is replayed into the field', () => {
    usePendingDeepLinkStore.getState().setPendingLink('/t/B7Q-31M');

    const screen = renderWithProviders(<CodeEntryScreen />);

    expect(screen.getByTestId('code-input').props.value).toBe('B7Q-31M');
    // Consumed, so a remount cannot yank her back to a code she has moved on
    // from — the store's own single-use contract.
    expect(usePendingDeepLinkStore.getState().pendingHref).toBeNull();
  });

  it('a route param wins over a pending link — first hit in the resolution order', () => {
    usePendingDeepLinkStore.getState().setPendingLink('/t/B7Q-31M');

    const screen = renderWithProviders(
      <CodeEntryScreen initialCode="R4K-92T" />
    );

    expect(screen.getByTestId('code-input').props.value).toBe('R4K-92T');
  });

  it('PRE-FILLING NEVER AUTO-SUBMITS — redemption is single-use, so a mis-routed link must not burn a code', async () => {
    renderWithProviders(<CodeEntryScreen initialCode="R4K-92T" />);

    await waitFor(() => expect(previewInviteMock).not.toHaveBeenCalled());
    expect(redeemInviteMock).not.toHaveBeenCalled();
  });

  it('the field is NEVER read-only in mode a — a wrong or stale code has to be correctable in place', () => {
    const screen = renderWithProviders(
      <CodeEntryScreen initialCode="R4K-92T" />
    );

    const input = screen.getByTestId('code-input');
    expect(input.props.editable).not.toBe(false);
    fireEvent.changeText(input, 'ZZZ-999');
    expect(screen.getByTestId('code-input').props.value).toBe('ZZZ-999');
  });
});

describe('CodeEntryScreen — a draft code has no family to preview', () => {
  // What the server actually sends for a draft invite (householdQueryService):
  // no name, no children — those are placeholders the nanny typed while
  // pricing her own week — and `carer_name` in their place. The card read the
  // two empty fields anyway and rendered an empty box above the button.
  const DRAFT_PREVIEW_AS_SERVED = {
    household_name: '',
    children_first_names: [],
    household_state: 'draft',
    role: 'parent',
    carer_name: 'Marisol R.',
  };

  it('names the carer instead of rendering an empty household heading', async () => {
    previewInviteMock.mockImplementation(() =>
      Promise.resolve(DRAFT_PREVIEW_AS_SERVED)
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    fireEvent.changeText(screen.getByTestId('code-input'), 'R4K-92T');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() =>
      expect(screen.getByTestId('code-preview-carer')).toBeTruthy()
    );
    expect(screen.queryByTestId('code-preview-household')).toBeNull();
  });

  it('renders no card at all when there is not even a carer name to show', async () => {
    previewInviteMock.mockImplementation(() =>
      Promise.resolve({ ...DRAFT_PREVIEW_AS_SERVED, carer_name: null })
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    fireEvent.changeText(screen.getByTestId('code-input'), 'R4K-92T');
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    // Wait for the preview to have LANDED (the CTA turns into Join), so the
    // absent card is the rendered outcome and not just a slow network.
    await waitFor(() =>
      expect(screen.getByText('onboarding.code.joinHousehold')).toBeTruthy()
    );
    expect(screen.queryByTestId('code-preview-card')).toBeNull();
  });
});

describe('CodeEntryScreen — absorption confirm (§8.2 / D-34)', () => {
  const DRAFT_PREVIEW = {
    household_name: "Marisol's terms",
    children_first_names: [],
    household_state: 'draft',
    carer_name: 'Marisol',
  };

  it('opens the sheet BEFORE redemption when a parent with a live household redeems a draft code', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() =>
      expect(screen.getByTestId('absorption-sheet-title')).toBeTruthy()
    );
    expect(redeemInviteMock).not.toHaveBeenCalled();
  });

  it('passes the chosen household as the redemption target once confirmed', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('absorption-confirm-button')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('absorption-confirm-button'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(redeemInviteMock.mock.calls[0]).toEqual(['R4K-92T', 'household-9']);
  });

  it('shows a household picker ONLY when the parent has two or more', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
    const single = renderWithProviders(<CodeEntryScreen />);
    await enterCode(single);
    fireEvent.press(single.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(single.getByTestId('absorption-confirm-button')).toBeTruthy()
    );
    expect(single.queryByTestId('absorption-household-picker')).toBeNull();
    single.unmount();

    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        liveHousehold('household-9', 'The Ahmeds'),
        liveHousehold('household-10', 'The Ahmeds (weekends)'),
      ])
    );
    const multi = renderWithProviders(<CodeEntryScreen />);
    await enterCode(multi);
    fireEvent.press(multi.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(multi.getByTestId('absorption-household-picker')).toBeTruthy()
    );
    expect(multi.getByTestId('absorption-household-household-10')).toBeTruthy();
  });

  it('absorbs into the household the parent picked, not the default', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([
        liveHousehold('household-9', 'The Ahmeds'),
        liveHousehold('household-10', 'The Ahmeds (weekends)'),
      ])
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('absorption-household-picker')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('absorption-household-household-10'));
    fireEvent.press(screen.getByTestId('absorption-confirm-button'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(redeemInviteMock.mock.calls[0]).toEqual(['R4K-92T', 'household-10']);
  });

  it('no sheet for a parent with NO household — redemption instantiates the family from the draft', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() => Promise.resolve([]));
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    // Redemption running straight through IS the assertion: the positive
    // case above proves the sheet gates it, so "redeemed, untargeted" can
    // only mean no confirm intervened. (`BottomSheetBase` keeps its subtree
    // mounted behind an invisible `<Modal>` for the exit animation, so a
    // queryByTestId here would find the hidden copy and prove nothing.)
    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(redeemInviteMock.mock.calls[0]).toEqual(['R4K-92T', undefined]);
  });

  it('no sheet for an ordinary LIVE household invite, even with a household already', async () => {
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));

    await waitFor(() => expect(redeemInviteMock).toHaveBeenCalledTimes(1));
    expect(redeemInviteMock.mock.calls[0]).toEqual(['R4K-92T', undefined]);
  });

  it('cancelling redeems nothing — a confirm can be declined', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('absorption-cancel-button')).toBeTruthy()
    );
    fireEvent.press(screen.getByTestId('absorption-cancel-button'));

    expect(redeemInviteMock).not.toHaveBeenCalled();
  });

  it('offers NO "create a separate household instead" fork — absorption is the only correct outcome (D-34)', async () => {
    previewInviteMock.mockImplementation(() => Promise.resolve(DRAFT_PREVIEW));
    listHouseholdsMock.mockImplementation(() =>
      Promise.resolve([liveHousehold('household-9', 'The Ahmeds')])
    );
    const screen = renderWithProviders(<CodeEntryScreen />);

    await enterCode(screen);
    fireEvent.press(screen.getByTestId('code-screen-cta'));
    await waitFor(() =>
      expect(screen.getByTestId('absorption-confirm-button')).toBeTruthy()
    );

    // Exactly two actions: confirm, and cancel.
    expect(screen.getByTestId('absorption-cancel-button')).toBeTruthy();
    expect(screen.queryByTestId('absorption-separate-household')).toBeNull();
  });
});

describe('CodeEntryScreen — where the code lives (WP-K)', () => {
  it('shows a "where to look" block above the input, with the hint key', () => {
    const screen = renderWithProviders(<CodeEntryScreen />);

    expect(screen.getByTestId('code-entry-where-to-look')).toBeTruthy();
    expect(screen.getByText('onboarding.code.whereToLook')).toBeTruthy();
  });
});
