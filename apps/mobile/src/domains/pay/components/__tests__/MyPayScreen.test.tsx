/**
 * @module domains/pay/components/__tests__/MyPayScreen
 *
 * D15 wiring test: renders the REAL `MyPayScreen` — one card per household,
 * the anonymity subtitle, the per-family empty state, and the nanny-only
 * role gate.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
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
    // racing it.
    await waitFor(() =>
      expect(
        getByTestId(`my-pay-term-${HOUSEHOLD_A}-cancellations`)
      ).toBeTruthy()
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

  it('no entitlement set: the balance row reads "Not set" and never fetches a balance', async () => {
    const { getByTestId } = renderWithProviders(<MyPayScreen />);

    await waitFor(() =>
      expect(
        getByTestId(`my-pay-term-${HOUSEHOLD_A}-ptoBalance-value`).props
          .children
      ).toBe('notSet')
    );
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
  describe('acknowledgment (D-31)', () => {
    const ARRANGEMENT_A = `arr-${HOUSEHOLD_A}`;
    const seenRow = {
      id: 'ack-1',
      arrangement_id: ARRANGEMENT_A,
      carer_id: NANNY_ID,
      kind: 'seen',
      note: null,
      created_at: '2026-08-11T09:00:00.000Z',
    };

    it('no ack row: the state word reads "Not seen yet" and both footer buttons are offered', async () => {
      const { getByTestId } = renderWithProviders(<MyPayScreen />);

      await waitFor(() =>
        expect(
          getByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`).props.children
        ).toBe('ack.notSeenYet')
      );
      expect(getByTestId(`my-pay-ack-seen-${HOUSEHOLD_A}`)).toBeTruthy();
      expect(getByTestId(`my-pay-ack-disagree-${HOUSEHOLD_A}`)).toBeTruthy();
    });

    it('"I\'ve seen these terms" records the ack, and the prompt gives way to the seen state word', async () => {
      let recorded = false;
      listAcksMock.mockImplementation(() =>
        Promise.resolve(recorded ? [seenRow] : [])
      );
      ackMock.mockImplementation(() => {
        recorded = true;
        return Promise.resolve(seenRow);
      });

      const { getByTestId, queryByTestId } = renderWithProviders(
        <MyPayScreen />
      );

      await waitFor(() =>
        expect(getByTestId(`my-pay-ack-seen-${HOUSEHOLD_A}`)).toBeTruthy()
      );
      fireEvent.press(getByTestId(`my-pay-ack-seen-${HOUSEHOLD_A}`));

      await waitFor(() =>
        expect(ackMock).toHaveBeenCalledWith(
          HOUSEHOLD_A,
          NANNY_ID,
          ARRANGEMENT_A
        )
      );
      await waitFor(() =>
        expect(queryByTestId(`my-pay-ack-seen-${HOUSEHOLD_A}`)).toBeNull()
      );
      expect(
        getByTestId(`my-pay-ack-state-${HOUSEHOLD_A}`).props.children
      ).toBe('ack.seenBy');
    });

    it('"I don\'t agree with this" opens the dissent sheet and records her note', async () => {
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
});
