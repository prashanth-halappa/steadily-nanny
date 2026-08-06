/**
 * @module domains/timeOff/components/__tests__/HouseholdTimeOffRow.test
 *
 * TIER0-CX-SPEC.md §5.1: the row shows a real "8h paid" / "Not marked paid"
 * StatusPill (deleting the raw `row.status` string it used to print), and
 * tapping opens `MarkTimeOffPaidSheet`. Mutation failure keeps the sheet
 * open with the typed values (the `ClockOutSheet` discipline) — verified
 * here since the row owns the mutation, the sheet only owns the form.
 *
 * Phase 3+4 adversarial review findings 2 and 15: paid-ness must be NETTED
 * against reversing `adjustment` rows (not just "does a usage row exist"),
 * and the PTO year must resolve against the household's LOCAL date, never
 * UTC.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { queryKeys } from '@/src/api/queryKeys';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import { toAllDayRange } from '../../utils/timeOffDate';

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
  it('F-B8-4: renders the inclusive Mon–Wed date range, not the raw exclusive ends_at boundary', async () => {
    // Mon 10 Aug – Wed 12 Aug, stored with an EXCLUSIVE end (local midnight
    // Thu 13 Aug) same as every other all-day time-off surface
    // (`toAllDayRange`, the same builder `TimeOffRow`'s sibling data goes
    // through). A `.slice(0, 10)` UTC truncation of the raw `starts_at`/
    // `ends_at` renders "10 Aug – 13 Aug" — both a day too long (the
    // exclusive boundary leaks into the label) and vulnerable to a
    // timezone slip. The fix must match `TimeOffRow`'s
    // `formatTimeOffRangeLabel` output exactly.
    const range = toAllDayRange('2026-08-10', '2026-08-12');
    const monWedTimeOff = {
      ...timeOff,
      starts_at: range.starts_at,
      ends_at: range.ends_at,
    };

    const { getByText, queryByText } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={monWedTimeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="UTC"
      />
    );

    await waitFor(() =>
      expect(getByText('Mon 10 Aug – Wed 12 Aug')).toBeTruthy()
    );
    expect(queryByText('10 Aug – 13 Aug')).toBeNull();
  });

  it('not yet marked: shows the "Not marked paid" pill', async () => {
    const { getByTestId, getByText } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="UTC"
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
        householdTimezone="UTC"
      />
    );

    await waitFor(() =>
      expect(getByText('householdTimeOff.paidBadge')).toBeTruthy()
    );
    expect(queryByText('confirmed')).toBeNull();
  });

  it('FULLY reversed (cancellation reversing adjustment): shows "Not marked paid", never a stale paid pill', async () => {
    // The ledger is append-only — the usage row never disappears — so the
    // reversing adjustment carries the SAME time_off_id
    // (ptoCommandService.reconcileCancelledTimeOff) and exactly mirrors it.
    getLedgerMock.mockImplementation(() =>
      Promise.resolve([
        usageEntry,
        {
          id: 'entry-2',
          household_id: HOUSEHOLD_ID,
          carer_id: CARER_ID,
          kind: 'adjustment',
          minutes: 480,
          effective_date: '2026-08-26',
          time_off_id: TIME_OFF_ID,
          carer_display_name: 'Amara',
          note: 'Reversed automatically',
          created_by: null,
          created_at: '2026-08-27T10:00:00.000Z',
        },
      ])
    );

    const { getByText, queryByText, queryClient } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="UTC"
      />
    );

    // The expected end-state ("not marked paid") is the SAME text as the
    // pre-fetch default — so waiting on that text alone would pass before
    // the ledger fetch (and the netting) ever ran. Wait on the query's
    // actual settled state instead, so this genuinely exercises the netted
    // result rather than the loading placeholder.
    await waitFor(() => {
      const state = queryClient.getQueryState(
        queryKeys.pto.ledger(HOUSEHOLD_ID, CARER_ID, 2026)
      );
      expect(state?.status).toBe('success');
    });

    expect(getByText('householdTimeOff.notMarkedPaid')).toBeTruthy();
    expect(queryByText('householdTimeOff.paidBadge')).toBeNull();
  });

  it('PARTIALLY reversed: still shows the paid pill, at the remainder', async () => {
    getLedgerMock.mockImplementation(() =>
      Promise.resolve([
        usageEntry,
        {
          id: 'entry-2',
          household_id: HOUSEHOLD_ID,
          carer_id: CARER_ID,
          kind: 'adjustment',
          minutes: 240, // reverses half of the 480-minute usage row
          effective_date: '2026-08-26',
          time_off_id: TIME_OFF_ID,
          carer_display_name: 'Amara',
          note: 'Partial correction',
          created_by: null,
          created_at: '2026-08-27T10:00:00.000Z',
        },
      ])
    );

    const { getByText, queryByText } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="UTC"
      />
    );

    // Here the expected end-state ("paid") DIFFERS from the pre-fetch
    // default ("not marked paid"), so waiting for it genuinely proves the
    // fetch resolved and the netting ran (same reasoning as the existing
    // "already marked" test above).
    await waitFor(() =>
      expect(getByText('householdTimeOff.paidBadge')).toBeTruthy()
    );
    expect(queryByText('householdTimeOff.notMarkedPaid')).toBeNull();
  });

  it('never marked: still shows "Not marked paid" (no ledger rows at all)', async () => {
    getLedgerMock.mockImplementation(() => Promise.resolve([]));

    const { getByTestId, getByText } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="UTC"
      />
    );

    await waitFor(() =>
      expect(
        getByTestId(`household-time-off-status-${TIME_OFF_ID}`)
      ).toBeTruthy()
    );
    expect(getByText('householdTimeOff.notMarkedPaid')).toBeTruthy();
  });

  it('finding 15: resolves the PTO year against the HOUSEHOLD-LOCAL date, not UTC', async () => {
    // 31 Dec 23:00 UTC is already 1 Jan LOCALLY for a household east of
    // UTC — Pacific/Auckland is UTC+13 in southern-hemisphere summer, so
    // this instant is local 2027-01-01 12:00, year 2027, not the UTC
    // year 2026.
    const nzTimeOff = {
      ...timeOff,
      starts_at: '2026-12-31T23:00:00.000Z',
      ends_at: '2027-01-02T23:00:00.000Z',
    };

    renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={nzTimeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="Pacific/Auckland"
      />
    );

    await waitFor(() => expect(getLedgerMock).toHaveBeenCalled());
    expect(getLedgerMock).toHaveBeenCalledWith(HOUSEHOLD_ID, CARER_ID, 2027);
    expect(getLedgerMock).not.toHaveBeenCalledWith(
      HOUSEHOLD_ID,
      CARER_ID,
      2026
    );
  });

  it('tapping the row opens the mark-paid sheet', async () => {
    const { getByTestId } = renderWithProviders(
      <HouseholdTimeOffRow
        timeOff={timeOff as never}
        householdId={HOUSEHOLD_ID}
        carerName="Amara"
        canMarkPaid
        householdTimezone="UTC"
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
        householdTimezone="UTC"
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
        householdTimezone="UTC"
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
        householdTimezone="UTC"
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
