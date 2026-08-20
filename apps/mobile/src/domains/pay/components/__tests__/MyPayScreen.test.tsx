/**
 * @module domains/pay/components/__tests__/MyPayScreen
 *
 * D15 wiring test: renders the REAL `MyPayScreen` — one card per household,
 * the anonymity subtitle, the per-family empty state, and the nanny-only
 * role gate.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import enPay from '@/src/i18n/locales/en/pay.json';
import esPay from '@/src/i18n/locales/es/pay.json';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

let MyPayScreen: typeof import('../MyPayScreen').MyPayScreen;

mock.module('@/src/components/ui/loading-indicator', () => {
  const React = require('react');
  return {
    LoadingIndicator: (props?: { testID?: string }) =>
      React.createElement('View', {
        testID: props?.testID ?? 'loading-indicator-container',
      }),
  };
});

// Captured (not the preload's fresh-mock-per-call default) so tests can
// assert router.back() was actually invoked — review finding 5.
const routerBack = mock();
mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: mock(),
    back: routerBack,
    navigate: mock(),
  }),
  useLocalSearchParams: mock(() => ({})),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

const NANNY_ID = 'nanny-1';
const HOUSEHOLD_A = 'household-a';
const HOUSEHOLD_B = 'household-b';
const now = '2026-08-01T00:00:00.000Z';

const householdA = {
  id: HOUSEHOLD_A,
  name: 'The Smiths',
  timezone: 'UTC',
  address_line: null,
  latitude: null,
  longitude: null,
  approval_mode: 'either',
  approval_scope: 'all',
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: 'parent-a',
  created_at: now,
  updated_at: now,
};
const householdB = { ...householdA, id: HOUSEHOLD_B, name: 'The Reyes' };
const HOUSEHOLD_PAST = 'household-past';
const householdPast = {
  ...householdA,
  id: HOUSEHOLD_PAST,
  name: 'The Okonjos',
};

const nannyMembership = (householdId: string) => ({
  id: `member-${householdId}`,
  household_id: householdId,
  user_id: NANNY_ID,
  role: 'nanny',
  can_edit: false,
  status: 'active',
  display_name_override: null,
  colour: null,
  joined_at: now,
  created_at: now,
  updated_at: now,
});

const arrangementFor = (householdId: string) => ({
  id: `arr-${householdId}`,
  household_id: householdId,
  carer_id: NANNY_ID,
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
  created_by: 'parent-a',
  created_at: now,
});

const listMock = mock(() => Promise.resolve([householdA, householdB]));
const listPastMock = mock(() => Promise.resolve([] as unknown[]));
const membershipsListMock = mock(() =>
  Promise.resolve([nannyMembership(HOUSEHOLD_A)])
);
const payCurrentMock = mock<
  (householdId: string, carerId: string) => Promise<unknown>
>((householdId: string) =>
  Promise.resolve(
    householdId === HOUSEHOLD_A ? arrangementFor(HOUSEHOLD_A) : null
  )
);

mock.module('@/src/api/endpoints/household', () => ({
  householdApi: { list: listMock, listPast: listPastMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
const payHistoryMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
const listAcksMock = mock<() => Promise<unknown[]>>(() => Promise.resolve([]));
const ackMock = mock<(h: string, c: string, a: string) => Promise<unknown>>(
  () => Promise.resolve({})
);
const dissentMock = mock<
  (h: string, c: string, a: string, note?: string) => Promise<unknown>
>(() => Promise.resolve({}));
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: payHistoryMock,
    create: mock(),
    listAcks: listAcksMock,
    ack: ackMock,
    dissent: dissentMock,
  },
}));
const ptoBalanceMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve(null)
);
mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: { getBalance: ptoBalanceMock },
}));

// 3-O §9.1 — the one write this screen now offers.
const proposeMock = mock<(input: unknown) => Promise<unknown>>(() =>
  Promise.resolve({})
);
const withdrawMock = mock<() => Promise<unknown>>(() => Promise.resolve({}));
let proposalsPending = false;
mock.module('@/src/hooks/queries/useTermsProposals', () => ({
  useTermsProposals: () => ({
    data: proposalsPending ? undefined : proposalRows,
    isPending: proposalsPending,
  }),
}));
mock.module('@/src/hooks/mutations/useProposeTerms', () => ({
  // Scoped to HOUSEHOLD_A: F16 makes "Suggest a change" reachable on EVERY
  // write-eligible card, so a flat isError here would fail every mounted
  // sheet at once (they all share one BottomSheetBase testID prefix) rather
  // than the one household the test is actually exercising.
  useProposeTerms: (householdId: string) => ({
    mutateAsync: proposeMock,
    isPending: false,
    isError: proposeIsError && householdId === HOUSEHOLD_A,
  }),
}));
mock.module('@/src/hooks/mutations/useWithdrawTerms', () => ({
  useWithdrawTerms: () => ({ mutate: withdrawMock, isPending: false }),
}));

/** What `useTermsProposals` resolves to for the current test. */
let proposalRows: unknown[] = [];
/** What `useProposeTerms` reports as its error state for the current test. */
let proposeIsError = false;

const openProposal = (proposedBy: string) => ({
  id: 'prop-1',
  household_id: HOUSEHOLD_A,
  carer_id: NANNY_ID,
  proposed_by: proposedBy,
  direction: proposedBy === NANNY_ID ? 'carer' : 'parent',
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
});

beforeAll(async () => {
  MyPayScreen = (await import('../MyPayScreen')).MyPayScreen;
});

beforeEach(() => {
  listMock.mockReset();
  listPastMock.mockReset();
  listPastMock.mockImplementation(() => Promise.resolve([]));
  membershipsListMock.mockReset();
  payCurrentMock.mockReset();
  payHistoryMock.mockReset();
  listAcksMock.mockReset();
  ackMock.mockReset();
  dissentMock.mockReset();
  ptoBalanceMock.mockReset();
  proposeMock.mockReset();
  withdrawMock.mockReset();
  proposeMock.mockImplementation(() => Promise.resolve({}));
  withdrawMock.mockImplementation(() => Promise.resolve({}));
  proposalRows = [];
  proposeIsError = false;
  proposalsPending = false;
  routerBack.mockClear();

  payHistoryMock.mockImplementation(() => Promise.resolve([]));
  listAcksMock.mockImplementation(() => Promise.resolve([]));
  ackMock.mockImplementation(() => Promise.resolve({}));
  dissentMock.mockImplementation(() => Promise.resolve({}));
  ptoBalanceMock.mockImplementation(() => Promise.resolve(null));
  listMock.mockImplementation(() => Promise.resolve([householdA, householdB]));
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([nannyMembership(HOUSEHOLD_A)])
  );
  payCurrentMock.mockImplementation((householdId: string) =>
    Promise.resolve(
      householdId === HOUSEHOLD_A ? arrangementFor(HOUSEHOLD_A) : null
    )
  );

  useAuthStore.setState({
    session: { user: { id: NANNY_ID } } as unknown as never,
    user: { id: NANNY_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('MyPayScreen', () => {
  it('renders one card per household, with terms for the one with an arrangement and an empty state for the one without', async () => {
    const { getByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-household-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    expect(getByTestId(`my-pay-household-${HOUSEHOLD_B}`)).toBeTruthy();
    // The card appears as soon as the household list resolves, but its terms
    // come from a separate `payCurrent` query — await that too rather than
    // racing it. The default fixture has every term unset, so no
    // `my-pay-term-*` row will render; the history toggle is the signal the
    // arrangement itself has arrived.
    await waitFor(() =>
      expect(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`)).toBeTruthy()
    );

    await waitFor(() =>
      expect(getByTestId(`my-pay-empty-${HOUSEHOLD_B}`)).toBeTruthy()
    );
  });

  it('an entitlement is set: fetches and renders the real per-family PTO balance', async () => {
    payCurrentMock.mockImplementation((householdId: string) =>
      Promise.resolve(
        householdId === HOUSEHOLD_A
          ? {
              ...arrangementFor(HOUSEHOLD_A),
              pto_entitlement_minutes_per_year: 8400,
            }
          : null
      )
    );
    ptoBalanceMock.mockImplementation(() =>
      Promise.resolve({
        carer_id: NANNY_ID,
        household_id: HOUSEHOLD_A,
        year: 2026,
        entitlement_minutes: 8400,
        accrued_minutes: 8400,
        used_minutes: 2880,
        balance_minutes: 5520,
      })
    );

    const { getByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(ptoBalanceMock).toHaveBeenCalledWith(HOUSEHOLD_A, NANNY_ID, 2026)
    );
    await waitFor(() =>
      expect(
        getByTestId(`my-pay-term-${HOUSEHOLD_A}-ptoBalance-value`).props
          .children
      ).toBe('terms.ptoBalanceValue')
    );
  });

  it('no entitlement set: the balance row is absent and never fetches a balance', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    expect(queryByTestId(`my-pay-term-${HOUSEHOLD_A}-ptoBalance`)).toBeNull();
    expect(ptoBalanceMock).not.toHaveBeenCalled();
  });

  it('"See history" expands the inline history list', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    expect(queryByTestId(`my-pay-history-${HOUSEHOLD_A}`)).toBeNull();

    fireEvent.press(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`));

    expect(getByTestId(`my-pay-history-${HOUSEHOLD_A}`)).toBeTruthy();
  });

  it('a non-nanny role sees the not-available state', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([{ ...nannyMembership(HOUSEHOLD_A), role: 'owner' }])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId('my-pay-not-available')).toBeTruthy()
    );
    expect(queryByTestId(`my-pay-household-${HOUSEHOLD_A}`)).toBeNull();
  });

  describe('review finding 5: a back affordance in every state, including loading and not-available', () => {
    it('the loading state has a back control that calls router.back() on press', () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      // Synchronous — react-query hooks start pending on the very first
      // render, before any awaited settle.
      const back = getByTestId('my-pay-loading-back');
      expect(back.props.accessibilityRole).toBe('button');
      expect(back.props.accessibilityLabel).toBe('back');
      expect(back.props.hitSlop).toBe(12);

      fireEvent.press(back);
      expect(routerBack).toHaveBeenCalled();
    });

    it('the not-available state has a back control that calls router.back() on press', async () => {
      membershipsListMock.mockImplementation(() =>
        Promise.resolve([{ ...nannyMembership(HOUSEHOLD_A), role: 'owner' }])
      );

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId('my-pay-not-available-back')).toBeTruthy()
      );
      const back = getByTestId('my-pay-not-available-back');
      expect(back.props.accessibilityRole).toBe('button');
      expect(back.props.accessibilityLabel).toBe('back');
      expect(back.props.hitSlop).toBe(12);

      fireEvent.press(back);
      expect(routerBack).toHaveBeenCalled();
    });

    it('the main loaded state has a back control that calls router.back() on press', async () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() => expect(getByTestId('my-pay-back')).toBeTruthy());
      const back = getByTestId('my-pay-back');
      expect(back.props.accessibilityRole).toBe('button');
      expect(back.props.accessibilityLabel).toBe('back');
      expect(back.props.hitSlop).toBe(12);

      fireEvent.press(back);
      expect(routerBack).toHaveBeenCalled();
    });
  });

  // The pay she is owed by the family she left is the whole point of the
  // removed-member read access. Listing only ACTIVE households hid it.
  it('renders a card for a household she was removed from', async () => {
    listMock.mockImplementation(() => Promise.resolve([householdA]));
    listPastMock.mockImplementation(() => Promise.resolve([householdPast]));
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([
        nannyMembership(HOUSEHOLD_A),
        { ...nannyMembership(HOUSEHOLD_PAST), status: 'removed' },
      ])
    );

    const { findByTestId } = renderWithProviders(<MyPayScreen />);

    expect(
      await findByTestId(`my-pay-household-${HOUSEHOLD_PAST}`)
    ).toBeTruthy();
    expect(await findByTestId(`my-pay-household-${HOUSEHOLD_A}`)).toBeTruthy();
  });

  // D-31/D-41, spec §8.2/§8.3. The state word is the load-bearing part: a
  // 'seen' row must NEVER read as agreement anywhere on this screen.
  /**
   * 1.7 — THE READ RECEIPT IS RECORDED, NOT ASKED FOR.
   *
   * The nanny persona on the button this replaces: "it looks exactly like an
   * 'I agree' button… then the fine print says the opposite," and on tapping
   * it, "the button just vanished." The fact the ack records — that she saw
   * this version — is one the app already knows the moment the screen renders
   * with data, which is exactly the rule `terms_proposals.viewed_at` uses.
   * Recording it needs no button, and a button that cannot be told apart from
   * consent on a pay screen is worse than no button.
   *
   * This ships LAST in P1 and only because acceptance has replaced it: the
   * record it removes now exists in a stronger form on the proposal.
   */
  describe('the read receipt (1.7)', () => {
    const ARRANGEMENT_A = `arr-${HOUSEHOLD_A}`;
    const seenRow = {
      id: 'ack-1',
      arrangement_id: ARRANGEMENT_A,
      carer_id: NANNY_ID,
      kind: 'seen',
      note: null,
      created_at: '2026-08-11T09:00:00.000Z',
    };
    const disagreedRow = {
      ...seenRow,
      id: 'ack-2',
      kind: 'disagreed',
      note: 'The rate went down.',
      created_at: '2026-08-12T09:00:00.000Z',
    };

    it('records the read automatically on first render with data', async () => {
      renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(ackMock).toHaveBeenCalledWith(
          HOUSEHOLD_A,
          NANNY_ID,
          ARRANGEMENT_A
        )
      );
    });

    it('there is no button to mistake for an agreement, and no line defusing one', async () => {
      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      expect(queryByTestId(`my-pay-ack-prompt-${HOUSEHOLD_A}`)).toBeNull();
      expect(queryByTestId(`my-pay-ack-seen-${HOUSEHOLD_A}`)).toBeNull();
      expect(queryByTestId(`my-pay-ack-recorded-${HOUSEHOLD_A}`)).toBeNull();
      // The reassurance line existed SOLELY to defuse that button.
      expect('seenButton' in enPay.ack).toBe(false);
      expect('reassurance' in enPay.ack).toBe(false);
      expect('recordedNow' in enPay.ack).toBe(false);
      expect('seenButton' in esPay.ack).toBe(false);
      expect('reassurance' in esPay.ack).toBe(false);
      expect('recordedNow' in esPay.ack).toBe(false);
    });

    it('does not re-record when a seen row already exists', async () => {
      listAcksMock.mockImplementation(() => Promise.resolve([seenRow]));

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(
          getByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`).props.children
        ).toBe('ack.seenBy')
      );
      expect(ackMock).not.toHaveBeenCalled();
    });

    it('never records before the ack list has loaded', async () => {
      listAcksMock.mockImplementation(() => new Promise(() => {}));

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      expect(ackMock).not.toHaveBeenCalled();
    });

    // The Read line and the seen pill STAY — 1.7 removes the button, never
    // the record. A disagreement still gets its own line beside it.
    it('keeps the read date, and the disagreement line beside it', async () => {
      listAcksMock.mockImplementation(() =>
        Promise.resolve([disagreedRow, seenRow])
      );

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(
          getByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`).props.children
        ).toBe('ack.seenBy')
      );
      expect(
        getByTestId(`my-pay-ack-disagreed-${HOUSEHOLD_A}`).props.children
      ).toBe('ack.needsUpdatingLine');
    });

    /**
     * "Needs updating to what? Did the rate change again?" — the rename says
     * the actual fact, and it may only appear where that fact is true: a
     * grandfathered row nobody agreed. On agreed terms the button would be a
     * contradiction of the line directly above it.
     */
    it('the dissent button says what it means, and only on a row nobody agreed', async () => {
      const { getByTestId, getByText } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      expect(getByText('ack.needsUpdatingButton')).toBeTruthy();
      expect(enPay.ack.needsUpdatingButton).toBe("I haven't agreed to these");
      expect(esPay.ack.needsUpdatingButton).not.toMatch(/necesita/i);
    });

    it('an AGREED row offers no dissent button — she already agreed', async () => {
      proposalRows = [
        {
          ...openProposal(NANNY_ID),
          id: 'prop-accepted',
          status: 'accepted',
          accepted_arrangement_id: ARRANGEMENT_A,
          responded_at: now,
        },
      ];
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([arrangementFor(HOUSEHOLD_A)])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-terms-state-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      expect(queryByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeNull();
    });

    it('the dissent sheet still records her note', async () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      fireEvent.press(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`));

      const input = getByTestId(`my-pay-dissent-note-${HOUSEHOLD_A}`);
      fireEvent.changeText(input, 'My rate went down without a conversation.');
      fireEvent.press(getByTestId(`my-pay-dissent-submit-${HOUSEHOLD_A}`));

      await waitFor(() =>
        expect(dissentMock).toHaveBeenCalledWith(
          HOUSEHOLD_A,
          NANNY_ID,
          ARRANGEMENT_A,
          'My rate went down without a conversation.'
        )
      );
    });

    // GOLDEN #40: a failure inside a sheet stays inside the sheet — the card
    // error behind the open sheet is a message nobody reads.
    it('a failed dissent reports itself INSIDE the sheet, with her note kept', async () => {
      dissentMock.mockImplementation(() =>
        Promise.reject(new Error('offline'))
      );

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      fireEvent.press(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`));
      fireEvent.changeText(
        getByTestId(`my-pay-dissent-note-${HOUSEHOLD_A}`),
        'The rate went down.'
      );
      fireEvent.press(getByTestId(`my-pay-dissent-submit-${HOUSEHOLD_A}`));

      await waitFor(() =>
        expect(getByTestId(`my-pay-dissent-error-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      // The sheet stays open with her typed note intact.
      expect(
        getByTestId(`my-pay-dissent-note-${HOUSEHOLD_A}`).props.value
      ).toBe('The rate went down.');
    });
  });

  /**
   * 1.3 — the SAME state line in the SAME slot for both roles. Today the
   * parent got it above the rate and she got a shorter, less attributed
   * document below the rows; `screens-pay-terms.md` §1 calls that the T16
   * violation. Same util, same position, worded for each reader.
   */
  describe('the terms state line', () => {
    it('a grandfathered row reads "not agreed in Steadily", in force and honest', async () => {
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([arrangementFor(HOUSEHOLD_A)])
      );

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(
          getByTestId(`my-pay-terms-state-${HOUSEHOLD_A}`).props.children
        ).toBe('notAgreedSetBy')
      );
    });

    it('a row an accepted round points at reads as agreed', async () => {
      proposalRows = [
        {
          ...openProposal(NANNY_ID),
          id: 'prop-accepted',
          status: 'accepted',
          accepted_arrangement_id: `arr-${HOUSEHOLD_A}`,
          responded_at: now,
        },
      ];
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([arrangementFor(HOUSEHOLD_A)])
      );

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(
          getByTestId(`my-pay-terms-state-${HOUSEHOLD_A}`).props.children
        ).toBe('proposal.state.agreedWith')
      );
    });

    it('while proposals are still loading, my-pay-terms-state-<HOUSEHOLD_A> does not render and no side-data retry renders', async () => {
      proposalsPending = true;
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([arrangementFor(HOUSEHOLD_A)])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-household-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      // await waitFor over the card is enough; terms state line is inside the card
      expect(queryByTestId(`my-pay-terms-state-${HOUSEHOLD_A}`)).toBeNull();
      expect(queryByTestId(`my-pay-side-data-retry-${HOUSEHOLD_A}`)).toBeNull();
    });
  });

  // §8.5 — the history says WHAT changed, computed by the same
  // `buildTermsDiff` the change review uses.
  it('history rows carry the diff against the previous version, and the oldest reads "First terms set"', async () => {
    const older = {
      ...arrangementFor(HOUSEHOLD_A),
      id: 'arr-older',
      rate_minor: 1600,
      valid_from: '2026-01-01',
    };
    payHistoryMock.mockImplementation(() =>
      Promise.resolve([arrangementFor(HOUSEHOLD_A), older])
    );

    const { getByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    fireEvent.press(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`));

    await waitFor(() =>
      expect(
        getByTestId(`my-pay-history-diff-arr-${HOUSEHOLD_A}`).props.children
      ).toContain('→')
    );
    expect(getByTestId('my-pay-history-diff-arr-older').props.children).toBe(
      'history.firstTermsSet'
    );
  });

  // ---------------------------------------------------------------------
  // 3-O §9.1 — proposals from My pay. The same object, the same review
  // screen and the same accept sheet a nanny-first onboarding produces:
  // one lifecycle, not two.
  // ---------------------------------------------------------------------
  describe('suggesting a change (§9.1)', () => {
    it('offers exactly one write per card, below the history toggle', async () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);
      await waitFor(() =>
        expect(getByTestId(`my-pay-suggest-change-${HOUSEHOLD_A}`)).toBeTruthy()
      );
    });

    it('a household she was REMOVED from offers no write at all', async () => {
      listMock.mockImplementation(() => Promise.resolve([householdA]));
      listPastMock.mockImplementation(() => Promise.resolve([householdPast]));
      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );
      await waitFor(() =>
        expect(getByTestId(`my-pay-household-${HOUSEHOLD_PAST}`)).toBeTruthy()
      );
      expect(
        queryByTestId(`my-pay-suggest-change-${HOUSEHOLD_PAST}`)
      ).toBeNull();
      // …and the gate is per-household, not a blanket one: the family she
      // still works for keeps its affordance.
      expect(getByTestId(`my-pay-suggest-change-${HOUSEHOLD_A}`)).toBeTruthy();
    });

    // GOLDEN #40: the propose sheet's failure renders inline in the sheet —
    // a toast (or an error behind it) is invisible under the open sheet.
    it('a failed proposal reports itself INSIDE the propose sheet', async () => {
      proposeIsError = true;

      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId(`my-pay-suggest-change-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      fireEvent.press(getByTestId(`my-pay-suggest-change-${HOUSEHOLD_A}`));

      expect(getByTestId('pay-propose-submit-error').props.children).toBe(
        'proposal.sendFailed'
      );
    });

    // 1.2: her open round gets the RECEIPT, the same card the parent gets for
    // his — what was sent, that they have to agree before her clock opens,
    // and whether they have opened it. A pill said none of that.
    it('while HER proposal is open the card shows the receipt, with Withdraw on it', async () => {
      proposalRows = [openProposal(NANNY_ID)];

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-terms-receipt-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      expect(
        getByTestId(`my-pay-terms-receipt-${HOUSEHOLD_A}-consequence`).props
          .children
      ).toBe('receipt.mustAgreeCarer');
      expect(queryByTestId(`my-pay-proposal-pill-${HOUSEHOLD_A}`)).toBeNull();

      fireEvent.press(
        getByTestId(`my-pay-terms-receipt-${HOUSEHOLD_A}-withdraw`)
      );
      expect(withdrawMock).toHaveBeenCalled();
    });

    it('when THEY countered, the ball is hers and the card sends her to the review surface', async () => {
      proposalRows = [openProposal('parent-a')];
      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );
      await waitFor(() =>
        expect(
          getByTestId(`my-pay-proposal-review-${HOUSEHOLD_A}`)
        ).toBeTruthy()
      );
      expect(
        queryByTestId(`my-pay-proposal-withdraw-${HOUSEHOLD_A}`)
      ).toBeNull();
    });
  });

  /**
   * §9.1's `canWrite` already hid "Suggest a change" on a past-household
   * card. It missed two OTHER writes on the same card: the auto-ack effect
   * (fires unconditionally on first render with data) and the dissent
   * button (gated only on `agreement.kind`). Both write into
   * `pay_arrangement_acks`, which migration 109's RLS fix now refuses for a
   * non-active member — so before this fix, the auto-ack either wrote an
   * unauthorized "she agrees" receipt on her behalf for a family she no
   * longer works for (pre-109), or now fails and surfaces a confusing
   * `ack.recordFailed` banner on a card that is supposed to be simple read
   * access to her own record (post-109). This block pins both closed.
   */
  describe('past-household writes are gated on canWrite (the auto-ack and dissent gap)', () => {
    beforeEach(() => {
      listMock.mockImplementation(() => Promise.resolve([householdA]));
      listPastMock.mockImplementation(() => Promise.resolve([householdPast]));
      membershipsListMock.mockImplementation(() =>
        Promise.resolve([
          nannyMembership(HOUSEHOLD_A),
          { ...nannyMembership(HOUSEHOLD_PAST), status: 'removed' },
        ])
      );
      // Both cards need an arrangement — the ack effect and the dissent
      // button both live inside the `arrangement` branch, and a card with
      // nothing set never reaches either.
      payCurrentMock.mockImplementation((householdId: string) =>
        Promise.resolve(
          householdId === HOUSEHOLD_A || householdId === HOUSEHOLD_PAST
            ? arrangementFor(householdId)
            : null
        )
      );
    });

    it('does not auto-ack a past-household card', async () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      // Let the card fully settle — same idiom as "never records before the
      // ack list has loaded" above: if the (buggy) effect were going to
      // fire, it already would have by the time the state line renders.
      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-state-${HOUSEHOLD_PAST}`)).toBeTruthy()
      );
      expect(ackMock).not.toHaveBeenCalledWith(
        HOUSEHOLD_PAST,
        NANNY_ID,
        `arr-${HOUSEHOLD_PAST}`
      );
    });

    // The one I'd most fear regressing: the family she still works for must
    // keep the automatic read receipt exactly as before.
    it('still auto-acks the active household card', async () => {
      renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(ackMock).toHaveBeenCalledWith(
          HOUSEHOLD_A,
          NANNY_ID,
          `arr-${HOUSEHOLD_A}`
        )
      );
    });

    it('hides the dissent affordance on a past-household card, keeps it on an active one', async () => {
      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-household-${HOUSEHOLD_PAST}`)).toBeTruthy()
      );
      expect(queryByTestId(`my-pay-ack-disagree-${HOUSEHOLD_PAST}`)).toBeNull();
      expect(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeTruthy();
    });

    it('never shows the "could not record" error on a past-household card in the ordinary read case', async () => {
      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-state-${HOUSEHOLD_PAST}`)).toBeTruthy()
      );
      expect(queryByTestId(`my-pay-ack-error-${HOUSEHOLD_PAST}`)).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // F16 — a nanny's blind spot on a live first offer. HOUSEHOLD_B has no
  // arrangement (`payCurrentMock` resolves null for it) in every fixture
  // above; these prove the open-round receipt/pill and the "Suggest a
  // change" write are now reachable from that same no-arrangement card.
  // ---------------------------------------------------------------------
  describe('a live first offer with no arrangement yet (F16)', () => {
    it('a receipt for her own first offer renders even with no arrangement', async () => {
      proposalRows = [openProposal(NANNY_ID)];

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-terms-receipt-${HOUSEHOLD_B}`)).toBeTruthy()
      );
      expect(queryByTestId(`my-pay-empty-${HOUSEHOLD_B}`)).toBeNull();
    });

    it('a pill + review link for a first offer THEY sent renders even with no arrangement', async () => {
      proposalRows = [openProposal('parent-a')];

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(
          getByTestId(`my-pay-proposal-review-${HOUSEHOLD_B}`)
        ).toBeTruthy()
      );
      expect(queryByTestId(`my-pay-empty-${HOUSEHOLD_B}`)).toBeNull();
    });

    it('no arrangement AND no open round: the bare empty state, with Suggest a change reachable', async () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(getByTestId(`my-pay-empty-${HOUSEHOLD_B}`)).toBeTruthy()
      );
      expect(getByTestId(`my-pay-suggest-change-${HOUSEHOLD_B}`)).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------
  // F18 — the scheduled-change card, extracted into `ScheduledChangeCard`
  // and reused here READ-ONLY: a nanny sees the raise coming but cannot
  // edit or cancel it.
  // ---------------------------------------------------------------------
  describe('the scheduled change card, read-only (F18)', () => {
    it('a future-dated history row renders the card with no edit/cancel affordances', async () => {
      const scheduled = {
        ...arrangementFor(HOUSEHOLD_A),
        id: 'arr-scheduled',
        rate_minor: 2000,
        valid_from: '2099-01-01',
      };
      payHistoryMock.mockImplementation(() =>
        Promise.resolve([scheduled, arrangementFor(HOUSEHOLD_A)])
      );

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId('pay-scheduled-change-card')).toBeTruthy()
      );
      expect(queryByTestId('pay-scheduled-edit')).toBeNull();
      expect(queryByTestId('pay-scheduled-cancel')).toBeNull();
    });

    it('no future-dated row: no scheduled-change card', async () => {
      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-history-toggle-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      expect(queryByTestId('pay-scheduled-change-card')).toBeNull();
    });
  });
});

// False alarm (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §B): a failed read used
// to fall through the same `?? []`/`?? null` a genuinely empty one does, so
// a dropped connection told her "not agreed in Steadily" over terms she DID
// agree, or "Not read yet" over a read she recorded.
describe('MyPayScreen — a failed read never asserts a fact (false alarm)', () => {
  it('current.isError renders ErrorState with a working retry, not the empty state', async () => {
    payCurrentMock.mockImplementation((householdId: string) =>
      householdId === HOUSEHOLD_A
        ? Promise.reject(new Error('current boom'))
        : Promise.resolve(null)
    );

    const { getByTestId, queryByTestId, getByText } = renderWithProviders(
      <MyPayScreen />
    );

    await waitFor(() =>
      expect(getByTestId(`my-pay-error-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    expect(queryByTestId(`my-pay-empty-${HOUSEHOLD_A}`)).toBeNull();

    payCurrentMock.mockClear();
    fireEvent.press(getByText('tryAgain'));
    await waitFor(() => expect(payCurrentMock).toHaveBeenCalled());
  });

  it('a failed history read hides the terms-state label rather than claiming "not agreed in Steadily"', async () => {
    payHistoryMock.mockImplementation(() =>
      Promise.reject(new Error('history boom'))
    );

    const { getByTestId, queryByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-household-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    await waitFor(() =>
      expect(getByTestId(`my-pay-side-data-retry-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    expect(queryByTestId(`my-pay-terms-state-${HOUSEHOLD_A}`)).toBeNull();
  });

  it('a failed acks read hides the ack state line rather than claiming "Not read yet"', async () => {
    listAcksMock.mockImplementation(() =>
      Promise.reject(new Error('acks boom'))
    );

    const { getByTestId, queryByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-side-data-retry-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    expect(queryByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`)).toBeNull();
    expect(queryByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeNull();
  });

  // C6 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): a failed memberships read
  // used to pin `onboarding.status` at 'loading' forever — the outer gate
  // checked ONLY `status === 'loading'`, so this was a permanent spinner
  // with no reachable retry.
  it('a failed memberships read shows a retry, not a permanent spinner (C6)', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.reject(new Error('memberships boom'))
    );

    const { getByTestId, queryByTestId, getByText } = renderWithProviders(
      <MyPayScreen />
    );

    await waitFor(() =>
      expect(getByTestId('my-pay-membership-error')).toBeTruthy()
    );
    expect(queryByTestId('my-pay-loading')).toBeNull();

    membershipsListMock.mockClear();
    fireEvent.press(getByText('tryAgain'));
    await waitFor(() => expect(membershipsListMock).toHaveBeenCalled());
  });

  it('retrying the side-data InlineRetry refetches history and acks', async () => {
    listAcksMock.mockImplementation(() =>
      Promise.reject(new Error('acks boom'))
    );

    const { getByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(getByTestId(`my-pay-side-data-retry-${HOUSEHOLD_A}`)).toBeTruthy()
    );
    listAcksMock.mockClear();
    payHistoryMock.mockClear();

    fireEvent.press(
      getByTestId(`my-pay-side-data-retry-${HOUSEHOLD_A}-button`)
    );

    await waitFor(() => expect(listAcksMock).toHaveBeenCalled());
    expect(payHistoryMock).toHaveBeenCalled();
  });
});
