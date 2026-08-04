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
  approval_timeout_minutes: 60,
  short_notice_hours: 24,
  cancellation_paid_within_hours: 24,
  created_by: 'parent-a',
  created_at: now,
  updated_at: now,
};
const householdB = { ...householdA, id: HOUSEHOLD_B, name: 'The Reyes' };

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
  householdApi: { list: listMock },
}));
mock.module('@/src/api/endpoints/user', () => ({
  userApi: { listMemberships: membershipsListMock },
}));
mock.module('@/src/api/endpoints/payArrangements', () => ({
  payArrangementApi: {
    getCurrent: payCurrentMock,
    getHistory: mock(() => Promise.resolve([])),
    create: mock(),
  },
}));

beforeAll(async () => {
  MyPayScreen = (await import('../MyPayScreen')).MyPayScreen;
});

beforeEach(() => {
  listMock.mockReset();
  membershipsListMock.mockReset();
  payCurrentMock.mockReset();

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
    expect(
      getByTestId(`my-pay-term-${HOUSEHOLD_A}-cancellations`)
    ).toBeTruthy();

    await waitFor(() =>
      expect(getByTestId(`my-pay-empty-${HOUSEHOLD_B}`)).toBeTruthy()
    );
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
});
