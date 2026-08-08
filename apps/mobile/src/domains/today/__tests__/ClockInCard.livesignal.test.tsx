/**
 * @module domains/today/__tests__/ClockInCard.livesignal.test
 *
 * Daylight's thesis is that while someone is on the clock, the room warms —
 * but the CARD is what carries the signal and the Today wash is only its echo.
 * The first pass of the migration shipped the wash and left the card neutral,
 * which inverted that. These tests pin both halves of the signal:
 *
 *   (a) the apricot dot + label appear only while an entry is running;
 *   (b) the card takes the apricot `liveCard` shadow while running, and the
 *       neutral plum `card` shadow otherwise.
 *
 * (b) matters because the two shadows are structurally identical — same
 * offsets, same layer count — and differ ONLY in colour. A regression that
 * dropped the `live` prop would look like nothing at all in a snapshot.
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { waitFor } from '@testing-library/react-native';
import { useAuthStore } from '@/src/store/auth';
import { renderWithProviders } from '@/src/test-utils';
import { ClockInCard } from '../components/ClockInCard';

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
// Relative to "now", not a fixed past ISO date — a hardcoded date eventually
// crosses `MAX_UNSCHEDULED_SHIFT_MS` (10h, no shift matched) and the entry
// reads as overdue, which now also flips the card's tone/dot this file pins.
const RUNNING_ENTRY = {
  id: 'entry-1',
  household_id: HOUSEHOLD_ID,
  clock_in_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  status: 'running',
};

/** Apricot — `palette.light.highlight` (#E8823C). */
const APRICOT_RGB = '232, 130, 60';
/** Plum ink — `palette.light.foreground` (#2A1F2B). */
const INK_RGB = '42, 31, 43';

const getRunningMock = mock(() => Promise.resolve(null as unknown));
const clockInMock = mock(() => Promise.resolve(RUNNING_ENTRY));
const clockOutMock = mock(() =>
  Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
);

mock.module('@/src/api/endpoints/timeEntries', () => ({
  timeEntryApi: {
    getRunning: getRunningMock,
    clockIn: clockInMock,
    clockOut: clockOutMock,
  },
}));

beforeEach(() => {
  getRunningMock.mockReset();
  clockInMock.mockReset();
  clockOutMock.mockReset();
  clockInMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));
  clockOutMock.mockImplementation(() =>
    Promise.resolve({ ...RUNNING_ENTRY, status: 'submitted' })
  );
  useAuthStore.setState({
    session: { user: { id: 'user-1' } } as unknown as never,
    isInitialized: true,
  } as never);
});

/**
 * The card's shadow colours, read straight off the style array.
 *
 * Deliberately NOT `StyleSheet.flatten` — the react-native test double drops
 * `boxShadow` on the way through, so a flattened read comes back empty and the
 * assertion passes or fails for the wrong reason.
 */
function shadowColours(style: unknown): string {
  const layers = (Array.isArray(style) ? style : [style])
    .filter((s): s is { boxShadow?: { color?: string }[] } => Boolean(s))
    .flatMap(s => s.boxShadow ?? []);
  return layers.map(layer => layer.color ?? '').join(' ');
}

describe('ClockInCard — the live signal', () => {
  it('shows the apricot dot and takes the apricot shadow while on the clock', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(RUNNING_ENTRY));

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-out')).toBeTruthy());

    expect(getByTestId('today-live-dot')).toBeTruthy();

    const colours = shadowColours(getByTestId('today-clock-card').props.style);
    expect(colours).toContain(APRICOT_RGB);
    expect(colours).not.toContain(INK_RGB);
  });

  it('hides the dot and falls back to the neutral shadow off the clock', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(null));

    const { getByTestId, queryByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() => expect(getByTestId('today-clock-in')).toBeTruthy());

    expect(queryByTestId('today-live-dot')).toBeNull();

    const colours = shadowColours(getByTestId('today-clock-card').props.style);
    expect(colours).toContain(INK_RGB);
    expect(colours).not.toContain(APRICOT_RGB);
  });

  // Wave 2-A: idle inversion — "Not on the clock" is the eyebrow, the day's
  // own fact (no shift today, in this fixture) is the H3 headline.
  it('off the clock with no shift today: the day fact is the headline, not the clock state', async () => {
    getRunningMock.mockImplementation(() => Promise.resolve(null));

    const { getByTestId } = renderWithProviders(
      <ClockInCard householdId={HOUSEHOLD_ID} timeZone="UTC" />
    );

    await waitFor(() =>
      expect(getByTestId('today-off-clock-none')).toBeTruthy()
    );
    expect(getByTestId('today-off-clock-none').props.children).toBe(
      'readyWhenYouAre'
    );
  });
});
