/**
 * @module domains/pay/components/__tests__/PaySetupScreen
 *
 * D15 wiring test: renders the REAL `PaySetupScreen`. Covers the two
 * differences from `PayChangeSheet` that make this its own screen: the
 * effective-date default (day she joined, when in the past) and the
 * required — never pre-selected — cancellation choice.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { getLocales } from 'expo-localization';
import { localDateInZone } from '@/src/lib/localDate';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import {
  formatDate,
  maximumDate,
  parseDate,
} from '../EffectiveDateField.utils';

let PaySetupScreen: typeof import('../PaySetupScreen').PaySetupScreen;

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
const NANNY_ID = 'nanny-a';
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

function nannyMember(joinedAt: string) {
  return {
    id: 'member-nanny',
    household_id: HOUSEHOLD_ID,
    user_id: NANNY_ID,
    role: 'nanny',
    can_edit: false,
    status: 'active',
    display_name_override: 'Priya',
    colour: null,
    joined_at: joinedAt,
    created_at: now,
    updated_at: now,
  };
}

const listMock = mock(() => Promise.resolve([baseHousehold]));
const listMembersMock = mock(() =>
  Promise.resolve([nannyMember('2026-07-01T00:00:00.000Z')])
);
const membershipsListMock = mock(() => Promise.resolve([parentMembership]));
const routerBack = mock();
const routerReplace = mock();

mock.module('expo-router', () => ({
  useRouter: () => ({
    push: mock(),
    replace: routerReplace,
    back: routerBack,
    navigate: mock(),
  }),
  useLocalSearchParams: mock(() => ({ carerId: NANNY_ID })),
  useSegments: mock(() => []),
  usePathname: mock(() => ''),
  useFocusEffect: mock(() => {}),
  Link: 'Link',
  Redirect: 'Redirect',
  Stack: { Screen: 'StackScreen' },
  Tabs: { Screen: 'TabsScreen' },
}));

// F3(c) — the invite this carer redeemed, and whatever `pay_offer` it
// carried. Empty by default: most setup flows have no prior offer to
// prefill from (parent-first onboarding, or a nanny-first draft absorbed
// with no offer written).
const listInvitesMock = mock<() => Promise<unknown[]>>(() =>
  Promise.resolve([])
);
mock.module('@/src/api/endpoints/household', () => ({
  householdApi: {
    list: listMock,
    listMembers: listMembersMock,
    listInvites: listInvitesMock,
  },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
const payCurrentMock = mock<(...args: unknown[]) => Promise<unknown>>(() =>
  Promise.resolve(null)
);
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: mock(() => Promise.resolve([])),
  },
}));

// P1: setup SENDS A ROUND. `terms_proposals` is the write, and the mutable
// list below is what the screen reads back to decide between the form and
// the receipt.
let proposalRows: unknown[] = [];
const proposeMock = mock<
  (h: string, c: string, input: unknown) => Promise<unknown>
>(() => Promise.resolve({ id: 'prop-new' }));
const withdrawMock = mock<(id: string) => Promise<unknown>>(() =>
  Promise.resolve({
    id: 'prop-new',
    household_id: HOUSEHOLD_ID,
    carer_id: NANNY_ID,
  })
);
mock.module('@/src/api/endpoints/termsProposals', () => ({
  termsProposalApi: {
    propose: proposeMock,
    withdraw: withdrawMock,
    list: mock(() => Promise.resolve(proposalRows)),
  },
}));

const openParentRound = {
  id: 'prop-open-1',
  household_id: HOUSEHOLD_ID,
  carer_id: NANNY_ID,
  proposed_by: PARENT_USER_ID,
  direction: 'parent',
  status: 'proposed',
  terms: {
    rate_minor: 2500,
    currency: 'GBP',
    overtime_multiplier: 1.5,
    valid_from: '2026-07-01',
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

beforeAll(async () => {
  PaySetupScreen = (await import('../PaySetupScreen')).PaySetupScreen;
});

beforeEach(() => {
  // Restore bun.setup.ts's en-GB default — one test below re-points this and
  // the override would otherwise leak into every test after it.
  (
    getLocales as unknown as { mockImplementation: (fn: () => unknown) => void }
  ).mockImplementation(() => [
    {
      languageCode: 'en',
      regionCode: 'GB',
      languageTag: 'en-GB',
      currencyCode: 'GBP',
    },
  ]);
  listMock.mockReset();
  listMembersMock.mockReset();
  listInvitesMock.mockReset();
  membershipsListMock.mockReset();
  payCurrentMock.mockReset();
  proposeMock.mockReset();
  withdrawMock.mockReset();
  proposalRows = [];
  proposeMock.mockImplementation(() => Promise.resolve({ id: 'prop-new' }));
  withdrawMock.mockImplementation(() =>
    Promise.resolve({
      id: 'prop-new',
      household_id: HOUSEHOLD_ID,
      carer_id: NANNY_ID,
    })
  );
  routerBack.mockClear();
  routerReplace.mockClear();

  listMock.mockImplementation(() => Promise.resolve([baseHousehold]));
  listMembersMock.mockImplementation(() =>
    Promise.resolve([nannyMember('2026-07-01T00:00:00.000Z')])
  );
  listInvitesMock.mockImplementation(() => Promise.resolve([]));
  membershipsListMock.mockImplementation(() =>
    Promise.resolve([parentMembership])
  );
  payCurrentMock.mockImplementation(() => Promise.resolve(null));

  useAuthStore.setState({
    session: { user: { id: PARENT_USER_ID } } as unknown as never,
    user: { id: PARENT_USER_ID } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('PaySetupScreen', () => {
  it('renders the real form with the setup-specific title/subtitle and every field', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaySetupScreen />
    );

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    // Required core, always visible (§4.1).
    expect(getByTestId('pay-setup-date-input')).toBeTruthy();
    expect(getByTestId('pay-setup-cancellation-chip-window')).toBeTruthy();
    expect(getByTestId('pay-setup-cancellation-chip-none')).toBeTruthy();
    // Every optional term now sits behind a group header (D-3), and on a
    // first-ever arrangement there is nothing seeded, so all are closed.
    for (const group of [
      'overtime',
      'guaranteed-hours',
      'pto',
      'holidays',
      'mileage',
      'outside-wages',
      'in-writing',
    ]) {
      expect(getByTestId(`pay-setup-group-${group}`)).toBeTruthy();
      expect(queryByTestId(`pay-setup-group-${group}-content`)).toBeNull();
    }
  });

  it('defaults the effective date to the day she joined, since it is in the past', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(formatDate(getByTestId('pay-setup-date-input').props.value)).toBe(
        '2026-07-01'
      )
    );
  });

  // T10: setup used to have no date validation at all — the change sheet's
  // error and backdating hint existed only there. One `EffectiveDateField`
  // now owns both, so the parity gap cannot re-open.
  describe('T10: the date field validates the same on setup as on change', () => {
    it('uses the native date picker in date mode', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );

      const picker = getByTestId('pay-setup-date-input');
      // The invalid-date inline error path (Feb 30) is unreachable through
      // this UI — the picker cannot emit impossible dates. isValidCalendarDate
      // is still wired for non-UI writers and covered by payArrangementForm.test.ts.
      expect(picker.props.mode).toBe('date');
    });

    it('caps the picker at the 12-month horizon (D-16)', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );

      const todayISO = localDateInZone('UTC');
      const picker = getByTestId('pay-setup-date-input');
      // Beyond-horizon dates are structurally unreachable — maximumDate on the
      // native picker enforces D-16. The inline horizon error remains for
      // non-UI writers; isBeyondFutureHorizon is covered in payArrangementForm.test.ts.
      expect(formatDate(picker.props.maximumDate)).toBe(
        formatDate(maximumDate(todayISO))
      );
    });

    it('accepts a scheduled future date inside the horizon', async () => {
      const { getByTestId, queryByTestId } = renderWithProviders(
        <PaySetupScreen />
      );

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent(
        getByTestId('pay-setup-date-input'),
        'change',
        {},
        parseDate('2026-09-01')
      );

      expect(queryByTestId('pay-setup-date-horizon-error')).toBeNull();
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({ valid_from: '2026-09-01' }),
          })
        )
      );
    });

    it('shows the backdating hint on the seeded joined date, which is in the past', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-backdating-hint')).toBeTruthy()
      );
    });
  });

  // §5.2 / D-7, on the screen a first-time family actually meets it.
  describe('the common-defaults preset (§5.2, D-7)', () => {
    it('fills the overtime fields and records terms.preset', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));

      fireEvent.press(getByTestId('pay-setup-group-overtime'));
      fireEvent.press(getByTestId('pay-setup-preset-button'));
      expect(getByTestId('pay-preset-confirm').props.disabled).toBe(true);
      fireEvent.press(getByTestId('pay-preset-checkbox'));
      fireEvent.press(getByTestId('pay-preset-confirm'));

      expect(
        getByTestId('pay-setup-daily-overtime-threshold-input').props.value
      ).toBe('8');
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({
              overtime_threshold_minutes: 2400,
              overtime_daily_threshold_minutes: 480,
              doubletime_daily_threshold_minutes: 720,
              doubletime_multiplier: 2,
              seventh_day_multiplier: 1.5,
              seventh_day_doubletime_after_minutes: 480,
              terms: expect.objectContaining({
                preset: expect.objectContaining({
                  id: 'common-defaults',
                  version: 1,
                  confirmed_by: PARENT_USER_ID,
                }),
              }),
            }),
          })
        )
      );
    });
  });

  describe('review finding 9: the joined-date default only applies when there is genuinely no current arrangement yet', () => {
    it('when a current arrangement already exists for this carer, redirects to /settings/pay and does not render the form', async () => {
      payCurrentMock.mockImplementation(() =>
        Promise.resolve({
          id: 'arr-existing',
          household_id: HOUSEHOLD_ID,
          carer_id: NANNY_ID,
          rate_minor: 1500,
          bill_rate_minor: null,
          currency: 'GBP',
          overtime_threshold_minutes: null,
          overtime_multiplier: 1.5,
          guaranteed_minutes_per_week: null,
          pto_entitlement_minutes_per_year: null,
          mileage_rate_per_mile_minor: null,
          cancellation_paid_within_hours: null,
          valid_from: '2026-05-01',
          carer_display_name: 'Priya',
          note: null,
          created_by: PARENT_USER_ID,
          created_at: now,
        })
      );

      const { queryByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(routerReplace).toHaveBeenCalledWith('/settings/pay')
      );
      expect(queryByTestId('pay-setup-rate-input')).toBeNull();
    });

    it('with no current arrangement, still defaults to the joined date (unchanged behaviour)', async () => {
      payCurrentMock.mockImplementation(() => Promise.resolve(null));

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(
          formatDate(getByTestId('pay-setup-date-input').props.value)
        ).toBe('2026-07-01')
      );
    });
  });

  // F3(c) — a parent who typed an offer during invite creation shouldn't
  // have to retype it from memory once she redeems it.
  describe('prefilling from the redeemed invite pay_offer (F3(c))', () => {
    const inviteWithOffer = (overrides: Record<string, unknown> = {}) => ({
      id: 'invite-1',
      household_id: HOUSEHOLD_ID,
      code: 'ABC-123',
      email: null,
      role: 'nanny',
      invited_by: PARENT_USER_ID,
      expires_at: '2026-09-01T00:00:00.000Z',
      status: 'accepted',
      accepted_by: NANNY_ID,
      accepted_at: '2026-08-01T00:00:00.000Z',
      link_expires_at: null,
      opened_at: null,
      label: null,
      pay_offer: {
        rate_minor: 2200,
        currency: 'USD',
        overtime_multiplier: 1.5,
        cancellation_paid_within_hours: 12,
        valid_from: '2026-07-01',
      },
      pay_offer_promotion: 'skipped_stale',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      ...overrides,
    });

    it('seeds the rate and cancellation window from the invite offer', async () => {
      listInvitesMock.mockImplementation(() =>
        Promise.resolve([inviteWithOffer()])
      );

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input').props.value).toBe('22.00')
      );
      expect(
        getByTestId('pay-setup-cancellation-hours-input').props.value
      ).toBe('12');
    });

    it('an invite with no pay_offer leaves the form blank (unchanged behaviour)', async () => {
      listInvitesMock.mockImplementation(() =>
        Promise.resolve([inviteWithOffer({ pay_offer: null })])
      );

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      expect(getByTestId('pay-setup-rate-input').props.value).toBe('');
    });

    it('an offer on an invite redeemed by someone else is ignored', async () => {
      listInvitesMock.mockImplementation(() =>
        Promise.resolve([inviteWithOffer({ accepted_by: 'someone-else' })])
      );

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      expect(getByTestId('pay-setup-rate-input').props.value).toBe('');
    });

    it('does not override the joined-date effective-date default with the (possibly stale) offer valid_from', async () => {
      // A different, earlier date than the joined date — proves the SOURCE
      // stays `member.joined_at`, not `pay_offer.valid_from` verbatim (the
      // offer may have gone stale by the time it's redeemed, per F3(b)'s
      // API-side `skipped_stale` guard on the promotion path).
      listInvitesMock.mockImplementation(() =>
        Promise.resolve([
          inviteWithOffer({
            pay_offer: {
              rate_minor: 2200,
              currency: 'USD',
              overtime_multiplier: 1.5,
              cancellation_paid_within_hours: 12,
              valid_from: '2026-01-01',
            },
          }),
        ])
      );

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input').props.value).toBe('22.00')
      );
      expect(formatDate(getByTestId('pay-setup-date-input').props.value)).toBe(
        '2026-07-01'
      );
    });
  });

  it('the cancellation choice starts unselected — Save stays disabled until one is picked', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    expect(
      getByTestId('pay-setup-cancellation-chip-window').props.variant
    ).toBe('outline');
    expect(getByTestId('pay-setup-cancellation-chip-none').props.variant).toBe(
      'outline'
    );
    expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(true);

    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(true);

    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(false);
  });

  // C6 (docs/CROSS-CUTTING-DEFECT-PATTERNS.md §C): `onboarding.status` stays
  // 'loading' FOREVER on a failed memberships read — checking only that made
  // this outer gate a permanent spinner with no reachable retry.
  it('a failed memberships read shows a retry, not a permanent spinner (C6)', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.reject(new Error('memberships boom'))
    );

    const { getByTestId, queryByTestId, getByText } = renderWithProviders(
      <PaySetupScreen />
    );

    await waitFor(() => expect(getByTestId('error-state')).toBeTruthy());
    expect(queryByTestId('pay-loading')).toBeNull();

    membershipsListMock.mockClear();
    fireEvent.press(getByText('tryAgain'));
    await waitFor(() => expect(membershipsListMock).toHaveBeenCalled());
  });

  it('a REMOVED parent (past member) gets "not available", never the pay form', async () => {
    membershipsListMock.mockImplementation(() =>
      Promise.resolve([{ ...parentMembership, status: 'removed' }])
    );

    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaySetupScreen />
    );

    await waitFor(() =>
      expect(getByTestId('pay-setup-not-available')).toBeTruthy()
    );
    expect(queryByTestId('pay-setup-rate-input')).toBeNull();
  });

  it('defaults the currency to the device Language & Region, not a hardcoded GBP', async () => {
    // The device value is a PREFILL, so it has to reach the submitted request
    // when untouched. `getLocales` is the global mock from `bun.setup.ts`;
    // only the per-render `useState(getDeviceCurrency())` reads it, so
    // re-pointing it before render is enough. (`CURRENCY_OPTIONS` in
    // `currencyOptions()` reads the device value too, but this asserts the
    // SELECTION, not the list ordering.)
    (
      getLocales as unknown as {
        mockImplementation: (fn: () => unknown) => void;
      }
    ).mockImplementation(() => [{ currencyCode: 'USD', languageTag: 'en-US' }]);

    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    expect(getByTestId('pay-setup-currency-prefix').props.children).toBe('$');

    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(proposeMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({
          terms: expect.objectContaining({ currency: 'USD' }),
        })
      )
    );
  });

  it('prefers the household currency over the device default, once the household has loaded', async () => {
    listMock.mockImplementation(() =>
      Promise.resolve([{ ...baseHousehold, currency: 'EUR' }])
    );

    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-currency-prefix').props.children).toBe('€')
    );

    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(proposeMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({
          terms: expect.objectContaining({ currency: 'EUR' }),
        })
      )
    );
  });

  it('lets the device default be overridden — currency belongs to the arrangement, not the phone', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <PaySetupScreen />
    );

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    fireEvent.press(getByTestId('pay-setup-currency-trigger'));
    fireEvent.press(getByTestId('pay-setup-currency-EUR'));
    // Picking closes the list, so the long form doesn't stay long.
    expect(queryByTestId('pay-setup-currency-list')).toBeNull();
    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(proposeMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({
          terms: expect.objectContaining({ currency: 'EUR' }),
        })
      )
    );
  });

  // 3-E2 / migration 078. Setup starts blank on all five, and a blank tier
  // must reach the API as an explicit null rather than be dropped (T17).
  describe('078 daily tiers and the seventh day', () => {
    it('starts every new field blank and sends all five as null when untouched', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.press(getByTestId('pay-setup-group-overtime'));
      expect(
        getByTestId('pay-setup-daily-overtime-threshold-input').props.value
      ).toBe('');
      expect(
        getByTestId('pay-setup-seventh-day-multiplier-input').props.value
      ).toBe('');

      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({
              overtime_daily_threshold_minutes: null,
              doubletime_daily_threshold_minutes: null,
              doubletime_multiplier: null,
              seventh_day_multiplier: null,
              seventh_day_doubletime_after_minutes: null,
            }),
          })
        )
      );
    });

    it('submits every typed tier', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-group-overtime'));
      fireEvent.changeText(
        getByTestId('pay-setup-overtime-threshold-input'),
        '40'
      );
      fireEvent.changeText(
        getByTestId('pay-setup-daily-overtime-threshold-input'),
        '8'
      );
      fireEvent.changeText(
        getByTestId('pay-setup-doubletime-threshold-input'),
        '12'
      );
      fireEvent.changeText(
        getByTestId('pay-setup-doubletime-multiplier-input'),
        '2'
      );
      fireEvent.changeText(
        getByTestId('pay-setup-seventh-day-multiplier-input'),
        '1.5'
      );
      fireEvent.changeText(
        getByTestId('pay-setup-seventh-day-doubletime-after-input'),
        '8'
      );
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({
              overtime_threshold_minutes: 2400,
              overtime_multiplier: 1.5,
              overtime_daily_threshold_minutes: 480,
              doubletime_daily_threshold_minutes: 720,
              doubletime_multiplier: 2,
              seventh_day_multiplier: 1.5,
              seventh_day_doubletime_after_minutes: 480,
            }),
          })
        )
      );
    });

    it('keeps Save disabled on a seventh-day second tier with no double-time multiplier to pay it at', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(false);

      fireEvent.press(getByTestId('pay-setup-group-overtime'));
      fireEvent.changeText(
        getByTestId('pay-setup-seventh-day-multiplier-input'),
        '1.5'
      );
      fireEvent.changeText(
        getByTestId('pay-setup-seventh-day-doubletime-after-input'),
        '8'
      );
      expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(true);
    });
  });

  // 3-E5 / `holiday_hours_minutes` (095, §5 D-53). Blank must reach the API
  // as an explicit null, and a typed value in hours must arrive in minutes.
  describe('the unworked-holiday credit', () => {
    it('starts blank and sends null when untouched', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.press(getByTestId('pay-setup-group-holidays'));
      expect(getByTestId('pay-setup-holiday-hours-input').props.value).toBe('');

      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({ holiday_hours_minutes: null }),
          })
        )
      );
    });

    it('submits typed HOURS as minutes', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-group-holidays'));
      fireEvent.changeText(getByTestId('pay-setup-holiday-hours-input'), '8');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({ holiday_hours_minutes: 480 }),
          })
        )
      );
    });
  });

  // 3-E4 / `worked_holiday_multiplier`. Blank must reach the API as an
  // explicit null — a first-ever arrangement that omits the key persists no
  // premium and no record that none was agreed (T17).
  describe('the worked-holiday premium', () => {
    it('starts blank and sends null when untouched', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.press(getByTestId('pay-setup-group-holidays'));
      expect(
        getByTestId('pay-setup-worked-holiday-multiplier-input').props.value
      ).toBe('');

      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({ worked_holiday_multiplier: null }),
          })
        )
      );
    });

    it('submits a typed premium', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-group-holidays'));
      fireEvent.changeText(
        getByTestId('pay-setup-worked-holiday-multiplier-input'),
        '1.5'
      );
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      fireEvent.press(getByTestId('pay-setup-screen-cta'));

      await waitFor(() =>
        expect(proposeMock).toHaveBeenCalledWith(
          HOUSEHOLD_ID,
          NANNY_ID,
          expect.objectContaining({
            terms: expect.objectContaining({ worked_holiday_multiplier: 1.5 }),
          })
        )
      );
    });

    it('keeps Save disabled on a three-decimal premium the numeric(3,2) column cannot hold', async () => {
      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
      );
      fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
      fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
      expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(false);

      fireEvent.press(getByTestId('pay-setup-group-holidays'));
      fireEvent.changeText(
        getByTestId('pay-setup-worked-holiday-multiplier-input'),
        '1.555'
      );
      expect(getByTestId('pay-setup-screen-cta').props.disabled).toBe(true);
    });
  });

  /**
   * P1. Setup no longer WRITES terms: it sends a round she has to agree to.
   * The success state is the receipt, not a toast and not a bounce — the
   * parent stays on the page that now says what he sent and who owes the
   * next move.
   */
  it('sends a proposal and stays put — the receipt is the confirmation', async () => {
    const { getByTestId } = renderWithProviders(<PaySetupScreen />);

    await waitFor(() =>
      expect(getByTestId('pay-setup-rate-input')).toBeTruthy()
    );
    fireEvent.changeText(getByTestId('pay-setup-rate-input'), '18.50');
    fireEvent.press(getByTestId('pay-setup-cancellation-chip-none'));
    fireEvent.press(getByTestId('pay-setup-screen-cta'));

    await waitFor(() =>
      expect(proposeMock).toHaveBeenCalledWith(
        HOUSEHOLD_ID,
        NANNY_ID,
        expect.objectContaining({
          terms: expect.objectContaining({
            rate_minor: 1850,
            valid_from: '2026-07-01',
            cancellation_paid_within_hours: null,
          }),
        })
      )
    );
    expect(routerBack).not.toHaveBeenCalled();
  });

  /**
   * 1.1's second bug, closed by the same condition. The bounce/blank-form
   * logic keyed on `currentArrangement`, which now stays null until she
   * agrees — so re-entering mid-wait showed a BLANK FORM over a live round,
   * and sending it would 23505 against 092's partial unique index.
   */
  describe('an open round is already on the table', () => {
    it('renders the receipt instead of a blank form when the parent already sent one', async () => {
      proposalRows = [openParentRound];

      const { getByTestId, queryByTestId } = renderWithProviders(
        <PaySetupScreen />
      );

      await waitFor(() =>
        expect(getByTestId('pay-terms-receipt')).toBeTruthy()
      );
      expect(queryByTestId('pay-setup-rate-input')).toBeNull();
      expect(getByTestId('pay-terms-receipt-consequence').props.children).toBe(
        'receipt.mustAgreeParent'
      );
    });

    it('Withdraw on the receipt withdraws that round', async () => {
      proposalRows = [openParentRound];

      const { getByTestId } = renderWithProviders(<PaySetupScreen />);

      await waitFor(() =>
        expect(getByTestId('pay-terms-receipt-withdraw')).toBeTruthy()
      );
      fireEvent.press(getByTestId('pay-terms-receipt-withdraw'));

      await waitFor(() =>
        expect(withdrawMock).toHaveBeenCalledWith('prop-open-1')
      );
    });

    it('a round SHE sent gets a review route, never a form to overwrite it with', async () => {
      proposalRows = [
        { ...openParentRound, direction: 'carer', proposed_by: NANNY_ID },
      ];

      const { getByTestId, queryByTestId } = renderWithProviders(
        <PaySetupScreen />
      );

      await waitFor(() =>
        expect(getByTestId('pay-setup-open-proposal-review')).toBeTruthy()
      );
      expect(queryByTestId('pay-setup-rate-input')).toBeNull();
    });
  });
});
