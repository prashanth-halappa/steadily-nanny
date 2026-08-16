/**
 * @module domains/pay/components/__tests__/PayArrangementScreen
 *
 * D15 wiring test: renders the REAL `PayArrangementScreen` — not a stub fed
 * mocked props — against a real QueryClient, with only the API leaves
 * mocked. Covers TIER0-CX-SPEC.md §2's core states: role gate, no-carer,
 * single-carer inline, no-arrangement CTA, the picker for 2+ nannies, and
 * the change-terms round trip through the real mutation hook.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { mockAlertDialogPrimitive } from '@/src/domains/schedule/__tests__/mockAlertDialog';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

mockAlertDialogPrimitive();

let PayArrangementScreen: typeof import('../PayArrangementScreen').PayArrangementScreen;

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});
mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));
mock.module('@/lib/useColorScheme', () => ({
  useColorScheme: () => ({
    colorScheme: 'light' as const,
    isDarkColorScheme: false,
    setColorScheme: () => {},
    toggleColorScheme: () => {},
  }),
}));

const PARENT_USER_ID = 'parent-user-1';
const NANNY_A_ID = 'nanny-a';
const NANNY_B_ID = 'nanny-b';
const HOUSEHOLD_ID = 'household-1';
const now = '2026-08-01T00:00:00.000Z';

const baseHousehold = {
  id: HOUSEHOLD_ID,
  name: 'The Smiths',
  timezone: 'UTC',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: PARENT_USER_ID,
  created_at: now,
  updated_at: now,
};

const parentMembership = {
  id: 'member-1',
  household_id: HOUSEHOLD_ID,
  user_id: PARENT_USER_ID,
  role: 'owner',
  can_edit: true,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
};

function nannyMember(userId: string, name: string) {
  return {
    id: `member-${userId}`,
    household_id: HOUSEHOLD_ID,
    user_id: userId,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: name,
    colour: null,
    joined_at: now,
    created_at: now,
    updated_at: now,
  };
}

const arrangementFor = (carerId: string) => ({
  id: `arr-${carerId}`,
  household_id: HOUSEHOLD_ID,
  carer_id: carerId,
  rate_minor: 1850,
  bill_rate_minor: null,
  currency: 'GBP',
  overtime_threshold_minutes: null,
  overtime_multiplier: 1.5,
  guaranteed_minutes_per_week: null,
  pto_entitlement_minutes_per_year: null,
  mileage_rate_per_mile_minor: null,
  cancellation_paid_within_hours: null,
  valid_from: '2026-04-01',
  carer_display_name: 'Priya',
  note: null,
  created_by: PARENT_USER_ID,
  created_at: now,
});

const listMock = mock(() => Promise.resolve([baseHousehold]));
const listMembersMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([nannyMember(NANNY_A_ID, 'Priya')])
);
const membershipsListMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([parentMembership])
);
const payCurrentMock = mock<
  (householdId: string, carerId: string) => Promise<unknown>
>(() => Promise.resolve(null));
const payHistoryMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const payCreateMock = mock((_h: string, _c: string, input: unknown) =>
  Promise.resolve({ ...arrangementFor(_c), ...(input as object) })
);
const routerPush = mock();
const routerBack = mock();
// Mutable so individual tests can simulate navigating to a specific carer's
// detail view (`/settings/pay/[carerId]`) without a real router — the
// existing suite only ever exercises the picker/no-carerId path.
let searchParams: { carerId?: string } = {};

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: routerPush,
    replace: mock(),
    back: routerBack,
    navigate: mock(),
  }),
  useLocalSearchParams: () => searchParams,
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listMock, listMembers: listMembersMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
const listAcksMock = mock<() => Promise<unknown[]>>(() => Promise.resolve([]));
const cancelScheduledMock = mock<
  (h: string, c: string, a: string) => Promise<unknown>
>(() => Promise.resolve({}));
// 3-O's proposal row (§7.1). Mocked at the HOOK boundary — another slice
// owns the hook and the HTTP shape under it. Empty by default: §12 says
// nothing announces a proposal's absence. Mutable so B2 can inject an
// open proposal without remocking the module.
let proposalRows: unknown[] = [];
mock.module('@/src/hooks/queries/useTermsProposals', () => ({
  useTermsProposals: () => ({ data: proposalRows }),
  findOpenTermsProposal: (
    proposals: readonly { status: string }[] | null | undefined
  ) => (proposals ?? []).find(row => row.status === 'proposed'),
}));

const openProposalRow = {
  id: 'prop-open-1',
  household_id: HOUSEHOLD_ID,
  carer_id: NANNY_A_ID,
  proposed_by: NANNY_A_ID,
  direction: 'carer',
  status: 'proposed',
  terms: {
    rate_minor: 2000,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    valid_from: '2026-09-01',
  },
  note: null,
  supersedes_id: null,
  from_invite_id: null,
  carer_display_name: 'Priya',
  weekly_equivalent_minor: null,
  viewed_at: null,
  responded_at: null,
  accepted_by: null,
  accepted_arrangement_id: null,
  responsibility_confirmed: false,
  created_at: now,
  updated_at: now,
};

mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: payHistoryMock,
    create: payCreateMock,
    listAcks: listAcksMock,
    ack: mock(),
    dissent: mock(),
    cancelScheduled: cancelScheduledMock,
  },
}));
const ptoBalanceMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve(null)
);
mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { getBalance: ptoBalanceMock },
}));

beforeAll(async () => {
  PayArrangementScreen = (await import('../PayArrangementScreen'))
    .PayArrangementScreen;
});

beforeEach(() => {
  listMock.mockReset();
  listMembersMock.mockReset();
  membershipsListMock.mockReset();
  payCurrentMock.mockReset();
  payHistoryMock.mockReset();
  payCreateMock.mockReset();
  listAcksMock.mockReset();
  cancelScheduledMock.mockReset();
  ptoBalanceMock.mockReset();
  routerPush.mockClear();
  routerBack.mockClear();
  searchParams = {};
  proposalRows = [];

  listAcksMock.mockImplementation(() => Promise.resolve([]));
  cancelScheduledMock.mockImplementation(() => Promise.resolve({}));
  ptoBalanceMock.mockImplementation(() => Promise.resolve(null));
  listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([nannyMember(NANNY_A_ID, 'Priya')])
  );
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([parentMembership])
  );
  payCurrentMock.mockImplementation(() => Promise.resolve(null));
  payHistoryMock.mockImplementation(() => Promise.resolve([]));
  payCreateMock.mockImplementation((_h: string, _c: string, input: unknown) =>
    Promise.resolve({ ...arrangementFor(_c), ...(input as object) })
  );

  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    user: { id: PARENT_USER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('PayArrangementScreen', () => {
  it('one active nanny with no arrangement: shows the empty state and routes its CTA to the setup screen', async () => {
    const { getByTestId, getByLabelText } = renderWithProviders(
      <PayArrangementScreen />
    );

    await waitFor(() =>
      expect(getByTestId('pay-empty-no-arrangement')).toBeTruthy()
    );

    // react-i18next is key-echo-mocked (bun.setup.ts), so the accessibility
    // label is the raw translation key, not the English copy.
    fireEvent.press(getByLabelText('setPayTermsAction'));
    expect(routerPush).toHaveBeenCalledWith(
      `/settings/pay/setup/${NANNY_A_ID}`
    );
  });

  // B2 — an open terms proposal must surface even when there is no
  // arrangement yet; "Set pay" must not bypass a live negotiation.
  describe('open proposal with no arrangement (B2)', () => {
    it('no arrangement + open proposal: renders pay-open-proposal-row', async () => {
      proposalRows = [openProposalRow];

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-empty-no-arrangement')).toBeTruthy()
      );
      expect(getByTestId('pay-open-proposal-row')).toBeTruthy();
    });

    it('no arrangement + open proposal: empty-state CTA routes to the proposal, not setup', async () => {
      proposalRows = [openProposalRow];

      const { getByTestId, getByLabelText, queryByLabelText } =
        renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-empty-no-arrangement')).toBeTruthy()
      );
      expect(queryByLabelText('setPayTermsAction')).toBeNull();
      fireEvent.press(getByLabelText('reviewProposedTermsAction'));
      expect(routerPush).toHaveBeenCalledWith(
        `/pay/proposal/${openProposalRow.id}`
      );
      expect(routerPush).not.toHaveBeenCalledWith(
        `/settings/pay/setup/${NANNY_A_ID}`
      );
    });

    it('no arrangement + NO open proposal: empty-state CTA still routes to setup with the original label', async () => {
      const { getByTestId, getByLabelText, queryByTestId } =
        renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-empty-no-arrangement')).toBeTruthy()
      );
      expect(queryByTestId('pay-open-proposal-row')).toBeNull();
      fireEvent.press(getByLabelText('setPayTermsAction'));
      expect(routerPush).toHaveBeenCalledWith(
        `/settings/pay/setup/${NANNY_A_ID}`
      );
    });

    it('arrangement + open proposal: pay-open-proposal-row still renders', async () => {
      proposalRows = [openProposalRow];
      payCurrentMock.mockImplementation(() =>
        Promise.resolve(arrangementFor(NANNY_A_ID))
      );
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([arrangementFor(NANNY_A_ID)])
      );

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() => expect(getByTestId('pay-current-rate')).toBeTruthy());
      expect(getByTestId('pay-open-proposal-row')).toBeTruthy();
    });

    // Parent authored → "Terms you sent …"; carer authored → "Terms from …".
    // react-i18next is key-echo-mocked, so the rendered title IS the key.
    it('parent-authored open proposal: the row title is Terms you sent', async () => {
      proposalRows = [
        {
          ...openProposalRow,
          direction: 'parent',
          proposed_by: PARENT_USER_ID,
        },
      ];

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-open-proposal-row')).toBeTruthy()
      );
      expect(getByTestId('pay-open-proposal-title').props.children).toBe(
        'proposal.openRowTitleSent'
      );
    });

    it('carer-authored open proposal: the row title is Terms from', async () => {
      proposalRows = [openProposalRow];

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-open-proposal-row')).toBeTruthy()
      );
      expect(getByTestId('pay-open-proposal-title').props.children).toBe(
        'proposal.openRowTitleReceived'
      );
    });
  });

  it('one active nanny WITH an arrangement: renders the rate, all six term rows, and the history row', async () => {
    payCurrentMock.mockImplementation(() =>
      Promise.resolve(arrangementFor(NANNY_A_ID))
    );
    payHistoryMock.mockImplementation(() =>
      Promise.resolve([arrangementFor(NANNY_A_ID)])
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() => expect(getByTestId('pay-current-rate')).toBeTruthy());
    expect(getByTestId('pay-current-rate').props.children).toBe('£18.50');
    expect(getByTestId('pay-term-overtime')).toBeTruthy();
    expect(getByTestId('pay-term-guaranteedHours')).toBeTruthy();
    expect(getByTestId('pay-term-pto')).toBeTruthy();
    expect(getByTestId('pay-term-cancellations')).toBeTruthy();
    expect(getByTestId('pay-term-mileage')).toBeTruthy();
    expect(getByTestId('pay-term-ptoBalance')).toBeTruthy();
    expect(getByTestId(`pay-history-arr-${NANNY_A_ID}`)).toBeTruthy();
  });

  it('an entitlement is set: fetches and renders the real PTO balance figure + caption, not the placeholder', async () => {
    payCurrentMock.mockImplementation(() =>
      Promise.resolve({
        ...arrangementFor(NANNY_A_ID),
        pto_entitlement_minutes_per_year: 8400,
      })
    );
    ptoBalanceMock.mockImplementation(() =>
      Promise.resolve({
        carer_id: NANNY_A_ID,
        household_id: HOUSEHOLD_ID,
        year: 2026,
        entitlement_minutes: 8400,
        accrued_minutes: 8400,
        used_minutes: 2880,
        balance_minutes: 5520,
      })
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(ptoBalanceMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_A_ID,
        2026
      )
    );
    // react-i18next is key-echo-mocked, so a REAL figure ("terms.ptoBalanceValue")
    // is distinguishable from the "Not set" placeholder ("notSet") purely by
    // which key rendered.
    await waitFor(() =>
      expect(getByTestId('pay-term-ptoBalance-value').props.children).toBe(
        'terms.ptoBalanceValue'
      )
    );
  });

  it('no entitlement set: the balance row reads "Not set" and never fetches a balance', async () => {
    payCurrentMock.mockImplementation(() =>
      Promise.resolve(arrangementFor(NANNY_A_ID))
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-term-ptoBalance-value').props.children).toBe(
        'notSet'
      )
    );
    expect(ptoBalanceMock).not.toHaveBeenCalled();
  });

  it('opens the change sheet and submits a new arrangement through the real mutation', async () => {
    payCurrentMock.mockImplementation(() =>
      Promise.resolve(arrangementFor(NANNY_A_ID))
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-change-terms-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('pay-change-terms-button'));

    await waitFor(() => expect(getByTestId('pay-change-submit')).toBeTruthy());
    fireEvent.press(getByTestId('pay-change-submit'));

    await waitFor(() =>
      expect(payCreateMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_A_ID,
        expect.objectContaining({ rate_minor: 1850 })
      )
    );
  });

  // GOLDEN #40: the failed save renders INSIDE the still-open sheet — a
  // toast fired behind it is invisible.
  it('a failed save reports itself INSIDE the change sheet', async () => {
    payCurrentMock.mockImplementation(() =>
      Promise.resolve(arrangementFor(NANNY_A_ID))
    );
    payCreateMock.mockImplementation(() =>
      Promise.reject(new Error('offline'))
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-change-terms-button')).toBeTruthy()
    );
    fireEvent.press(getByTestId('pay-change-terms-button'));

    await waitFor(() => expect(getByTestId('pay-change-submit')).toBeTruthy());
    fireEvent.press(getByTestId('pay-change-submit'));

    await waitFor(() =>
      expect(getByTestId('pay-change-submit-error').props.children).toBe(
        'changeSheet.saveFailed'
      )
    );
  });

  it('no nanny in the household: shows the "No nanny yet" empty state routing to invite', async () => {
    listMembersMock.mockImplementation(() => Promise.resolve([]));

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() => expect(getByTestId('pay-empty-no-carer')).toBeTruthy());
  });

  it('two or more nannies: shows a picker, and pressing a row navigates to that carer', async () => {
    listMembersMock.mockImplementation(() =>
      Promise.resolve([
        nannyMember(NANNY_A_ID, 'Priya'),
        nannyMember(NANNY_B_ID, 'Amara'),
      ])
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() => expect(getByTestId('pay-carer-picker')).toBeTruthy());
    fireEvent.press(getByTestId(`pay-carer-picker-${NANNY_B_ID}`));

    expect(routerPush).toHaveBeenCalledWith(`/settings/pay/${NANNY_B_ID}`);
  });

  it('a non-parent role sees the not-available state, never the form', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([
        {
          ...parentMembership,
          id: 'member-nanny',
          user_id: NANNY_A_ID,
          role: 'nanny',
        },
      ])
    );
    useAuthStore.setState({
      session: { user: { id: NANNY_A_ID } } as unknown as never,
      user: { id: NANNY_A_ID } as unknown as never,
      isInitialized: true,
    } as never);

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PayArrangementScreen />
    );

    await waitFor(() => expect(getByTestId('pay-not-available')).toBeTruthy());
    expect(queryByTestId('pay-current-terms-card')).toBeNull();
  });

  it('a REMOVED parent (past member) sees the not-available state, never the form', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([{ ...parentMembership, status: 'removed' }])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PayArrangementScreen />
    );

    await waitFor(() => expect(getByTestId('pay-not-available')).toBeTruthy());
    expect(queryByTestId('pay-current-terms-card')).toBeNull();
  });

  describe('review finding 7: the picker rate label while its own rate query is pending', () => {
    it('renders nothing — never "Not set" — until the query settles', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([
          nannyMember(NANNY_A_ID, 'Priya'),
          nannyMember(NANNY_B_ID, 'Amara'),
        ])
      );
      // Never resolves — keeps every picker row's own useCurrentPayArrangement
      // pending for the life of the test.
      payCurrentMock.mockImplementation(() => new Promise(() => {}));

      const { getByTestId, queryByText } = renderWithProviders(
        <PayArrangementScreen />
      );

      await waitFor(() => expect(getByTestId('pay-carer-picker')).toBeTruthy());
      await waitFor(() =>
        expect(getByTestId(`pay-carer-picker-${NANNY_A_ID}`)).toBeTruthy()
      );
      expect(queryByText('notSet')).toBeNull();
    });
  });

  describe('review finding 8: carer name resolution never falls to the generic role label while a real name is known', () => {
    it("the picker row shows the arrangement's carer_display_name when the member has no display_name_override", async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([
          nannyMember(NANNY_A_ID, 'Priya'),
          { ...nannyMember(NANNY_B_ID, 'Amara'), display_name_override: null },
        ])
      );
      payCurrentMock.mockImplementation((_h: string, carerId: string) =>
        Promise.resolve(
          carerId === NANNY_B_ID
            ? {
                ...arrangementFor(NANNY_B_ID),
                carer_display_name: 'Real Amara',
              }
            : null
        )
      );

      const { getByTestId, queryByText } = renderWithProviders(
        <PayArrangementScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`pay-carer-picker-${NANNY_B_ID}`)).toBeTruthy()
      );
      await waitFor(() => expect(queryByText('Real Amara')).toBeTruthy());
      expect(queryByText('role.nanny')).toBeNull();
    });

    it("the current-terms header (2+ nannies) shows the arrangement's carer_display_name when no override is set", async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([
          nannyMember(NANNY_A_ID, 'Priya'),
          { ...nannyMember(NANNY_B_ID, 'Amara'), display_name_override: null },
        ])
      );
      payCurrentMock.mockImplementation((_h: string, carerId: string) =>
        Promise.resolve(
          carerId === NANNY_B_ID
            ? {
                ...arrangementFor(NANNY_B_ID),
                carer_display_name: 'Real Amara',
              }
            : null
        )
      );
      searchParams = { carerId: NANNY_B_ID };

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() => expect(getByTestId('pay-carer-name')).toBeTruthy());
      expect(getByTestId('pay-carer-name').props.children).toBe('Real Amara');
    });

    it('falls back to the role label only when neither an override nor an arrangement name exists', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([
          nannyMember(NANNY_A_ID, 'Priya'),
          { ...nannyMember(NANNY_B_ID, 'Amara'), display_name_override: null },
        ])
      );
      payCurrentMock.mockImplementation(() => Promise.resolve(null));
      searchParams = { carerId: NANNY_B_ID };

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() => expect(getByTestId('pay-carer-name')).toBeTruthy());
      expect(getByTestId('pay-carer-name').props.children).toBe('role.nanny');
    });
  });

  describe('review finding 10: accessibility props on the back row and carer-picker rows', () => {
    it('the back row exposes accessibilityRole/Label/hitSlop and calls router.back() on press', async () => {
      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() => expect(getByTestId('pay-back')).toBeTruthy());
      const back = getByTestId('pay-back');
      expect(back.props.accessibilityRole).toBe('button');
      expect(back.props.accessibilityLabel).toBe('back');
      expect(back.props.hitSlop).toBe(12);

      fireEvent.press(back);
      expect(routerBack).toHaveBeenCalled();
    });

    it('the not-available back row exposes the same accessibility props', async () => {
      membershipsListMock.mockImplementation(() =>
        Promise.resolve([
          {
            ...parentMembership,
            id: 'member-nanny',
            user_id: NANNY_A_ID,
            role: 'nanny',
          },
        ])
      );
      useAuthStore.setState({
        session: { user: { id: NANNY_A_ID } } as unknown as never,
        user: { id: NANNY_A_ID } as unknown as never,
        isInitialized: true,
      } as never);

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-not-available-back')).toBeTruthy()
      );
      const back = getByTestId('pay-not-available-back');
      expect(back.props.accessibilityRole).toBe('button');
      expect(back.props.accessibilityLabel).toBe('back');
      expect(back.props.hitSlop).toBe(12);
    });

    it('a carer-picker row exposes accessibilityRole/Label/hitSlop', async () => {
      listMembersMock.mockImplementation(() =>
        Promise.resolve([
          nannyMember(NANNY_A_ID, 'Priya'),
          nannyMember(NANNY_B_ID, 'Amara'),
        ])
      );

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId(`pay-carer-picker-${NANNY_A_ID}`)).toBeTruthy()
      );
      const row = getByTestId(`pay-carer-picker-${NANNY_A_ID}`);
      expect(row.props.accessibilityRole).toBe('button');
      expect(row.props.accessibilityLabel).toBe('Priya');
      expect(row.props.hitSlop).toBe(8);
    });
  });

  // §8.4 — the parent's ack pill. Three states, and a disagreement outranks
  // a seen. Never the word the 3-O proposal flow owns.
  describe('acknowledgment pill (§8.4)', () => {
    const ackRow = (kind: 'seen' | 'disagreed', created_at: string) => ({
      id: `ack-${kind}`,
      arrangement_id: `arr-${NANNY_A_ID}`,
      carer_id: NANNY_A_ID,
      kind,
      note: kind === 'disagreed' ? 'The rate went down.' : null,
      created_at,
    });

    beforeEach(() => {
      payCurrentMock.mockImplementation(() =>
        Promise.resolve(arrangementFor(NANNY_A_ID))
      );
    });

    it('no ack row: the pill reads "Not seen yet"', async () => {
      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-ack-pill-label').props.children).toBe(
          'ack.notSeenYet'
        )
      );
    });

    it('a seen row: the pill reads the seen state', async () => {
      listAcksMock.mockImplementation(() =>
        Promise.resolve([ackRow('seen', '2026-08-11T09:00:00.000Z')])
      );

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-ack-pill-label').props.children).toBe(
          'ack.seen'
        )
      );
    });

    it('a disagreement outranks a seen when both exist', async () => {
      listAcksMock.mockImplementation(() =>
        Promise.resolve([
          ackRow('seen', '2026-08-11T09:00:00.000Z'),
          ackRow('disagreed', '2026-08-12T09:00:00.000Z'),
        ])
      );

      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-ack-pill-label').props.children).toBe(
          'ack.disagreed'
        )
      );
    });
  });

  // §6 / D-16 — a `valid_from` in the future.
  describe('scheduled future change (§6)', () => {
    const scheduled = {
      ...arrangementFor(NANNY_A_ID),
      id: 'arr-scheduled',
      rate_minor: 2000,
      valid_from: '2099-01-01',
    };

    beforeEach(() => {
      payCurrentMock.mockImplementation(() =>
        Promise.resolve(arrangementFor(NANNY_A_ID))
      );
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([scheduled, arrangementFor(NANNY_A_ID)])
      );
    });

    it('renders the scheduled-change card with a before → after summary', async () => {
      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-scheduled-change-card')).toBeTruthy()
      );
      expect(getByTestId('pay-scheduled-diff').props.children).toContain(
        '£18.50 → £20.00'
      );
    });

    it('"Cancel this" asks first, and only then appends the revert row', async () => {
      const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-scheduled-cancel')).toBeTruthy()
      );
      fireEvent.press(getByTestId('pay-scheduled-cancel'));
      expect(cancelScheduledMock).not.toHaveBeenCalled();

      fireEvent.press(getByTestId('pay-scheduled-cancel-confirm'));

      await waitFor(() =>
        expect(cancelScheduledMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_A_ID,
          'arr-scheduled'
        )
      );
    });

    it('no future row: no scheduled-change card', async () => {
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([arrangementFor(NANNY_A_ID)])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <PayArrangementScreen />
      );

      await waitFor(() => expect(getByTestId('pay-current-rate')).toBeTruthy());
      expect(queryByTestId('pay-scheduled-change-card')).toBeNull();
    });
  });

  // §8.5 — history says what changed, via the same `buildTermsDiff` §7 uses.
  it('history rows carry the diff against the previous version, oldest reading "First terms set"', async () => {
    const older = {
      ...arrangementFor(NANNY_A_ID),
      id: 'arr-older',
      rate_minor: 1600,
      valid_from: '2026-01-01',
    };
    payCurrentMock.mockImplementation(() =>
      Promise.resolve(arrangementFor(NANNY_A_ID))
    );
    payHistoryMock.mockImplementation(() =>
      Promise.resolve([arrangementFor(NANNY_A_ID), older])
    );

    const { getByTestId } = renderWithProviders(<PayArrangementScreen />);

    await waitFor(() =>
      expect(
        getByTestId(`pay-history-diff-arr-${NANNY_A_ID}`).props.children
      ).toContain('£16.00 → £18.50')
    );
    expect(getByTestId('pay-history-diff-arr-older').props.children).toBe(
      'history.firstTermsSet'
    );
  });
});
