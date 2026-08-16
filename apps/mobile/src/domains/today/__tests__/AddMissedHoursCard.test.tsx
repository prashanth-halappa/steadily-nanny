/**
 * @module domains/today/__tests__/AddMissedHoursCard.test
 *
 * "Add missed hours" (forgotten clock-in recovery): a CTA on the carer's
 * Today screen opens a BottomSheetBase sheet — date (defaults to today in
 * the household zone), a TimeRangePicker, an optional note — and submits
 * via useCreateRetroactiveEntry.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';
const NANNY_ID = '33333333-3333-4333-8333-333333333333';
const TIME_ZONE = 'Europe/London';

setSystemTime(new Date('2026-08-06T12:00:00.000Z'));
afterAll(() => setSystemTime());

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

mock.module('@/src/store/auth', () => ({
  useAuthStore: mock((selector: (s: unknown) => unknown) =>
    selector({ user: { id: NANNY_ID } })
  ),
}));

mock.module('@/src/hooks/queries/useWeekTimeEntries', () => ({
  useWeekTimeEntries: mock(() => ({
    data: [],
    isLoading: false,
    isPending: false,
  })),
}));

mock.module('@/src/hooks/queries/useShiftsRange', () => ({
  useShiftsRange: mock(() => ({
    data: [
      {
        id: 'shift-1',
        household_id: HOUSEHOLD_ID,
        carer_id: NANNY_ID,
        kind: 'regular',
        status: 'confirmed',
        local_date: '2026-08-06',
        starts_at: '2026-08-06T09:00:00.000Z',
        ends_at: '2026-08-06T17:00:00.000Z',
        note: null,
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ],
    isLoading: false,
    isPending: false,
  })),
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
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    expect(getByTestId('today-missed-hours-cta')).toBeTruthy();
    expect(queryByTestId('today-missed-hours-sheet')).toBeNull();
  });

  // A1's recovery path. The blocked card promised her these hours could be
  // added "once terms are agreed"; this headline is that promise arriving,
  // and it says WHY the hours are worth adding — the rate she just agreed.
  it('leads with the post-acceptance headline when asked, and stays plain otherwise', () => {
    const withHeadline = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
        firstRunHeadline
      />
    );
    expect(
      String(
        withHeadline.getByTestId('today-missed-hours-headline').props.children
      )
    ).toBe('missedHours.afterTermsHeadline');

    const plain = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );
    expect(plain.queryByTestId('today-missed-hours-headline')).toBeNull();
    // The recovery affordance itself is unchanged either way.
    expect(plain.getByTestId('today-missed-hours-cta')).toBeTruthy();
  });

  it('opens the sheet with a TimeRangePicker and a note field on press', () => {
    const { getByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));

    expect(getByTestId('today-missed-hours-sheet')).toBeTruthy();
    expect(getByTestId('today-missed-hours-times')).toBeTruthy();
    expect(getByTestId('today-missed-hours-note')).toBeTruthy();
  });

  it('submits household_id + resolved clock_in_at/clock_out_at + trimmed note', async () => {
    const { getByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
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
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));
    fireEvent.press(getByTestId('today-missed-hours-submit'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledTimes(1));
    const call = mockMutateAsync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.note).toBeUndefined();
  });

  it('closes the sheet after a successful submit', async () => {
    const { getByTestId, queryByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
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
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
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

  it('disables submit when the time range is invalid', () => {
    const { getByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    fireEvent.press(getByTestId('today-missed-hours-cta'));
    fireEvent(
      getByTestId('today-missed-hours-times-end'),
      'change',
      {},
      new Date(2026, 0, 1, 8, 0)
    );

    const submit = getByTestId('today-missed-hours-submit');
    expect(
      submit.props.disabled ?? submit.props.accessibilityState?.disabled
    ).toBe(true);
  });

  // Wave 2-A: the outer Card + H4 title is gone — a 130pt card whose only
  // content was a button labelled the same as its own title. The trigger is
  // now a single ghost text link that opens the SAME unchanged sheet.
  it('has no card surface — the trigger is a bare ghost link, not a Card', () => {
    const { getByTestId, queryByTestId } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    expect(queryByTestId('today-missed-hours-card')).toBeNull();
    const cta = getByTestId('today-missed-hours-cta');
    expect(cta.props.children.props.children).toBe('missedHours.cta');
  });

  // Review fix: a ghost Button centres by default, which read as a section
  // heading floating in whitespace between two cards, not a link. Left-align
  // it, drop its text to Small (a recovery affordance, not a peer of "Clock
  // in"), and pull it tight under ClockInCard rather than orphaned between
  // the two cards.
  it('left-aligns the link, sizes it Small, and sits tight under the card above it', () => {
    const { getByTestId, getByText } = render(
      <AddMissedHoursCard
        householdId={HOUSEHOLD_ID}
        timeZone={TIME_ZONE}
        weekStartsOn={1}
      />
    );

    const cta = getByTestId('today-missed-hours-cta');
    expect(String(cta.props.className ?? '')).toContain('self-start');
    expect(String(cta.props.className ?? '')).toMatch(/-mt-/);

    const layers = getByText('missedHours.cta').props.style;
    const merged = Object.assign(
      {},
      ...(Array.isArray(layers) ? layers : [layers]).filter(Boolean)
    );
    expect(merged.fontSize).toBe(14);
  });
});
