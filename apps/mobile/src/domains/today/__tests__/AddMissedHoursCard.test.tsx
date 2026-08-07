/**
 * @module domains/today/__tests__/AddMissedHoursCard.test
 *
 * "Add missed hours" (forgotten clock-in recovery): a CTA on the carer's
 * Today screen opens a BottomSheetBase sheet — date (defaults to today in
 * the household zone), a TimeRangePicker, an optional note — and submits
 * via useCreateRetroactiveEntry.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const TIME_ZONE = 'Europe/London';

const createdEntry = {
  id: '11111111-1111-4111-8111-111111111111',
  household_id: HOUSEHOLD_ID,
  carer_id: '33333333-3333-4333-8333-333333333333',
  carer_display_name: 'Ines Ferreira',
  shift_id: null,
  clock_in_at: '2026-08-01T09:00:00.000Z',
  clock_out_at: '2026-08-01T17:00:00.000Z',
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  clock_in_location_ok: null,
  clock_out_location_ok: null,
  status: 'submitted',
  local_date: '2026-08-01',
  timezone: TIME_ZONE,
  created_at: '2026-08-01T17:00:00.000Z',
  updated_at: '2026-08-01T17:00:00.000Z',
};

let mockMutateAsync: ReturnType<typeof mock>;
let mockIsPending: boolean;

mock.module('@/src/hooks/mutations/useCreateRetroactiveEntry', () => ({
  useCreateRetroactiveEntry: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}));

let AddMissedHoursCard: typeof import('../components/AddMissedHoursCard').AddMissedHoursCard;

beforeAll(async () => {
  AddMissedHoursCard = (await import('../components/AddMissedHoursCard'))
    .AddMissedHoursCard;
});

beforeEach(() => {
  mockIsPending = false;
  mockMutateAsync = mock(() => Promise.resolve(createdEntry));
});

describe('AddMissedHoursCard', () => {
  it('renders the CTA and keeps the sheet hidden until pressed', () => {
    const { getByTestId, queryByTestId } = render(
      <AddMissedHoursCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    expect(getByTestId('today-missed-hours-cta')).toBeTruthy();
    expect(queryByTestId('today-missed-hours-sheet')).toBeNull();
  });

  it('opens the sheet with a TimeRangePicker and a note field on press', () => {
    const { getByTestId } = render(
      <AddMissedHoursCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));

    expect(getByTestId('today-missed-hours-sheet')).toBeTruthy();
    expect(getByTestId('today-missed-hours-times')).toBeTruthy();
    expect(getByTestId('today-missed-hours-note')).toBeTruthy();
  });

  it('submits household_id + resolved clock_in_at/clock_out_at + trimmed note', async () => {
    const { getByTestId } = render(
      <AddMissedHoursCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));
    fireEvent.changeText(
      getByTestId('today-missed-hours-note'),
      '  Forgot to clock in  '
    );
    fireEvent.press(getByTestId('today-missed-hours-submit'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const call = mockMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.household_id).toBe(HOUSEHOLD_ID);
    expect(typeof call.clock_in_at).toBe('string');
    expect(typeof call.clock_out_at).toBe('string');
    expect(call.note).toBe('Forgot to clock in');
  });

  it('omits note when left blank', async () => {
    const { getByTestId } = render(
      <AddMissedHoursCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));
    fireEvent.press(getByTestId('today-missed-hours-submit'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const call = mockMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.note).toBeUndefined();
  });

  it('closes the sheet after a successful submit', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddMissedHoursCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));
    fireEvent.press(getByTestId('today-missed-hours-submit'));

    await waitFor(() =>
      expect(queryByTestId('today-missed-hours-sheet')).toBeNull()
    );
  });

  it('keeps the sheet open (note preserved) when the mutation fails', async () => {
    mockMutateAsync = mock(() => Promise.reject(new Error('overlap')));
    const { getByTestId } = render(
      <AddMissedHoursCard householdId={HOUSEHOLD_ID} timeZone={TIME_ZONE} />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));
    fireEvent.changeText(getByTestId('today-missed-hours-note'), 'Note kept');
    fireEvent.press(getByTestId('today-missed-hours-submit'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    expect(getByTestId('today-missed-hours-sheet')).toBeTruthy();
    expect(getByTestId('today-missed-hours-note').props.value).toBe(
      'Note kept'
    );
  });
});
