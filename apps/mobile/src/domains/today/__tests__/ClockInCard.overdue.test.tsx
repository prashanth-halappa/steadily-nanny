/**
 * @module domains/today/__tests__/ClockInCard.overdue
 *
 * Daylight UX #7 — nothing used to handle a forgotten clock-out: the card
 * would show `37h 12m` the next morning and the server would faithfully
 * record every idle hour. This file is the check that the two halves of the
 * fix actually reach the network call: the card crosses into its overdue
 * state, and confirming from there sends a bounded `clock_out_at` instead of
 * "now".
 *
 * Renders the real card against a real QueryClient with only the API leaves
 * mocked — same standard as `ClockInCard.clockout.test.tsx`.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import { palette } from '~/lib/design-tokens/palette';
import { ClockInCard } from '../components/ClockInCard';

const SURFACE_ATTENTION = palette.light.surfaceAttention.hex;

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
const SHIFT_ID = 'shift-1';

// Clocked in 14 hours ago against a shift that was scheduled to finish 6
// hours ago: the carer went home and forgot.
const CLOCK_IN_MS = Date.now() - 14 * 60 * 60 * 1000;
const SHIFT_END_MS = Date.now() - 6 * 60 * 60 * 1000;
const SHIFT_END_ISO = new Date(SHIFT_END_MS).toISOString();

const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  shift_id: SHIFT_ID,
  clock_in_at: new Date(CLOCK_IN_MS).toISOString(),
  status: 'running',
};

const getRunningMock = mock(() => Promise.resolve<unknown>(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
);
const getShiftMock = mock(() =>
  Promise.resolve<unknown>({
    id: SHIFT_ID,
    household_id: HOUSEHOLD_ID,
    starts_at: new Date(CLOCK_IN_MS).toISOString(),
    ends_at: SHIFT_END_ISO,
    status: 'confirmed',
  })
);

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: mock(),
    clockOut: clockOutMock,
  },
}));
mock.module('@/src/api/endpoints/shifts', () => ({
  shiftApi: { getById: getShiftMock },
}));
// Local notifications are the other half of #7 and are exercised by
// `clockOutReminder.test.ts`; stubbed here so this file tests the card.
mock.module('expo-notifications', () => ({
  getAllScheduledNotificationsAsync: mock(async () => []),
  cancelScheduledNotificationAsync: mock(async () => undefined),
  scheduleNotificationAsync: mock(async () => 'id'),
  SchedulableTriggerInputTypes: { TIME_INTERVAL: 'timeInterval' },
}));

beforeEach(() => {
  getRunningMock.mockReset();
  clockOutMock.mockReset();
  getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() =>
    Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
  );
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

describe('ClockInCard — forgotten clock-out (#7)', () => {
  it('stops reporting and starts asking once the shift has run past its scheduled finish', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" weekStartsOn={1} />
    );

    await waitFor(() => expect(getByTestId('today-overdue-hint')).toBeTruthy());
  });

  it('sends the scheduled finish rather than now, so 14 idle hours are never banked', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" weekStartsOn={1} />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());
    fireEvent.press(getByTestId('today-clock-out'));

    await waitFor(() => expect(getByTestId('clockout-confirm')).toBeTruthy());
    // The sheet says out loud that the pre-filled finish is a guess from the
    // schedule rather than something the carer did.
    expect(getByTestId('clockout-overdue-hint')).toBeTruthy();

    fireEvent.press(getByTestId('clockout-confirm'));

    await waitFor(() => expect(clockOutMock).toHaveBeenCalledTimes(1));
    const [, payload] = clockOutMock.mock.calls[0] as unknown as [
      string,
      { clock_out_at?: string },
    ];
    expect(payload.clock_out_at).toBeDefined();
    // Rounded to the displayed minute, but the scheduled finish — not now,
    // and not 14 hours of elapsed time.
    const sentMs = Date.parse(payload.clock_out_at as string);
    expect(Math.abs(sentMs - SHIFT_END_MS)).toBeLessThan(60_000);
  });

  // Wave 2-A: overdue is a meaning change ("please close this out"), not a
  // continuation of "working" — the card itself flips to tone="attention"
  // (the tinted `surfaceAttention` ground), and the apricot live dot (that
  // signal belongs to actually-working) disappears.
  it('flips the card to tone="attention", and drops the live dot', async () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" weekStartsOn={1} />
    );

    await waitFor(() => expect(getByTestId('today-overdue-hint')).toBeTruthy());

    const styleArray = [getByTestId('today-clock-card').props.style].flat();
    expect(
      styleArray.some(
        s =>
          s && typeof s === 'object' && s.backgroundColor === SURFACE_ATTENTION
      )
    ).toBe(true);
    expect(queryByTestId('today-live-dot')).toBeNull();
  });

  // Rule B regression (cross-agent audit): the overdue Caption sits on the
  // tinted `surfaceAttention` ground now — `warningStrong` there is
  // 4.07:1, under AA for 14px semibold. Pin it to `foreground` (no colour
  // className override) so it can't drift back.
  it('renders the overdue caption in foreground, never warningStrong (Rule B)', async () => {
    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" weekStartsOn={1} />
    );

    await waitFor(() => expect(getByTestId('today-overdue-hint')).toBeTruthy());

    const caption = getByTestId('today-live-caption');
    expect(String(caption.props.className ?? '')).not.toContain('warning');
  });
});
