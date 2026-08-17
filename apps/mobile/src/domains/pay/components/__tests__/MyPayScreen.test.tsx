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
mock.module('@/src/hooks/queries/useTermsProposals', () => ({
  useTermsProposals: () => ({ data: proposalRows }),
}));
mock.module('@/src/hooks/mutations/useProposeTerms', () => ({
  useProposeTerms: () => ({
    mutateAsync: proposeMock,
    isPending: false,
    isError: proposeIsError,
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
});
