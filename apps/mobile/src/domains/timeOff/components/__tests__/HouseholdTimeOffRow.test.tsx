/**
 * @module domains/timeOff/components/__tests__/HouseholdTimeOffRow.test
 *
 * TIER0-CX-SPEC.md §5.1: the row shows a real "8h paid" / "Not marked paid"
 * StatusPill (deleting the raw `row.status` string it used to print), and
 * tapping opens `MarkTimeOffPaidSheet`. Mutation failure keeps the sheet
 * open with the typed values (the `ClockOutSheet` discipline) — verified
 * here since the row owns the mutation, the sheet only owns the form.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';

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

const HOUSEHOLD_ID = 'household-1';
const CARER_ID = 'carer-1';
const TIME_OFF_ID = 'timeoff-1';

const timeOff = {
  id: TIME_OFF_ID,
  user_id: CARER_ID,
  starts_at: '2026-08-24T00:00:00.000Z',
  ends_at: '2026-08-27T00:00:00.000Z',
  all_day: true,
  message: null,
  status: 'confirmed',
  ical_uid: 'ical-1',
  sequence: 0,
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

const usageEntry = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  carer_id: CARER_ID,
  kind: 'usage',
  minutes: -480,
  effective_date: '2026-08-26',
  time_off_id: TIME_OFF_ID,
  carer_display_name: 'Amara',
  note: null,
  created_by: null,
  created_at: '2026-08-26T10:00:00.000Z',
};

const getBalanceMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve({
    carer_id: CARER_ID,
    household_id: HOUSEHOLD_ID,
    year: 2026,
    entitlement_minutes: 8400,
    accrued_minutes: 8400,
    used_minutes: 0,
    balance_minutes: 8400,
  })
);
const getLedgerMock = mock<() => Promise<unknown[]>>(() => Promise.resolve([]));
const markPaidMock = mock<() => Promise<unknown>>(() =>
  Promise.resolve(usageEntry)
);

mock.module('@/src/api/endpoints/pto', () => ({
  ptoApi: {
    getBalance: getBalanceMock,
    getLedger: getLedgerMock,
    markPaid: markPaidMock,
  },
}));
mock.module('@/src/lib/toast', () => ({
  showSuccessToast: mock(() => {}),
  showErrorToast: mock(() => {}),
}));

let HouseholdTimeOffRow: typeof import('../HouseholdTimeOffRow').HouseholdTimeOffRow;

beforeAll(async () => {
  HouseholdTimeOffRow = (await import('../HouseholdTimeOffRow'))
    .HouseholdTimeOffRow;
});

beforeEach(() => {
  getBalanceMock.mockReset();
  getLedgerMock.mockReset();
  markPaidMock.mockReset();
  getBalanceMock.mockImplementation(() =>
    Promise.resolve({
      carer_id: CARER_ID,
      household_id: HOUSEHOLD_ID,
      year: 2026,
      entitlement_minutes: 8400,
      accrued_minutes: 8400,
      used_minutes: 0,
      balance_minutes: 8400,
    })
  );
  getLedgerMock.mockImplementation(() => Promise.resolve([]));
  markPaidMock.mockImplementation(() => Promise.resolve(usageEntry));

  useAuthStore.setState({
    session: { user: { id: 'parent-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('HouseholdTimeOffRow', () => {
  it('not yet marked: shows the "Not marked paid" pill', async () => {
    const { getByTestId, getByText } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
      />
    );

    await waitFor(() =>
      expect(
        getByTestId(`household-time-off-status-${TIME_OFF_ID}`)
      ).toBeTruthy()
    );
    expect(getByText('householdTimeOff.notMarkedPaid')).toBeTruthy();
  });

  it('already marked: shows the "Xh paid" pill, never the raw status string', async () => {
    getLedgerMock.mockImplementation(() => Promise.resolve([usageEntry]));

    const { getByText, queryByText } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
      />
    );

    await waitFor(() =>
      expect(getByText('householdTimeOff.paidBadge')).toBeTruthy()
    );
    expect(queryByText('confirmed')).toBeNull();
  });

  it('tapping the row opens the mark-paid sheet', async () => {
    const { getByTestId } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
      />
    );

    expect(getByTestId('pto-mark-paid-sheet').props.visible).toBe(false);
    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));
    await waitFor(() =>
      expect(getByTestId('pto-mark-paid-sheet').props.visible).toBe(true)
    );
  });

  it('a non-parent viewer cannot open the sheet', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid={false}
      />
    );

    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));
    expect(queryByTestId('pto-mark-paid-sheet')).toBeNull();
  });

  it('submits through the real mutation and closes the sheet on success', async () => {
    const { getByTestId } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
      />
    );

    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));
    await waitFor(() =>
      expect(getByTestId('pto-mark-paid-hours-input')).toBeTruthy()
    );
    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '8');
    fireEvent.press(getByTestId('pto-mark-paid-submit'));

    await waitFor(() =>
      expect(markPaidMock).toHaveBeenCalledWith(HOUSEHOLD_ID, {
        time_off_id: TIME_OFF_ID,
        minutes: 480,
      })
    );
    await waitFor(() =>
      expect(getByTestId('pto-mark-paid-sheet').props.visible).toBe(false)
    );
  });

  it('mutation failure keeps the sheet open with the typed values (ClockOutSheet discipline)', async () => {
    markPaidMock.mockImplementation(() =>
      Promise.reject(new Error('network error'))
    );

    const { getByTestId } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
      />
    );

    fireEvent.press(getByTestId(`household-time-off-${TIME_OFF_ID}`));
    await waitFor(() =>
      expect(getByTestId('pto-mark-paid-hours-input')).toBeTruthy()
    );
    fireEvent.changeText(getByTestId('pto-mark-paid-hours-input'), '8');
    fireEvent.press(getByTestId('pto-mark-paid-submit'));

    await waitFor(() => expect(markPaidMock).toHaveBeenCalled());
    // Sheet stays open, and the typed value survives.
    expect(getByTestId('pto-mark-paid-sheet')).toBeTruthy();
    expect(getByTestId('pto-mark-paid-hours-input').props.value).toBe('8');
  });
});
