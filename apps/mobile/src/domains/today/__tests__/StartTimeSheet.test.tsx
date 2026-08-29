/**
 * @module domains/today/__tests__/StartTimeSheet
 *
 * The mid-shift start correction. Pattern B (docs/09-TESTING.md §5): a
 * prop-driven sheet, so no QueryClientProvider — only the preload mocks and a
 * stubbed mutation.
 *
 * The cases that matter are the refusals. She is standing in a hallway with a
 * toddler; a sheet that accepts a start it will then be 400'd for has wasted
 * the one moment she had.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type * as React from 'react';

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

const mutateAsync = mock(async () => ({}));
mock.module('@/src/hooks/mutations/useUpdateTimeEntry', () => ({
  useUpdateTimeEntry: () => ({ mutateAsync, isPending: false }),
}));

let StartTimeSheet: typeof import('../components/StartTimeSheet').StartTimeSheet;

const TIME_ZONE = 'Europe/London';
/** 09:20 London on 3 Aug 2026 (BST, UTC+1). */
const CLOCK_IN_AT = '2026-08-03T08:20:00.000Z';
/** 09:00 London the same day. */
const SCHEDULED_AT = '2026-08-03T08:00:00.000Z';
const NOW_MS = new Date('2026-08-03T09:30:00.000Z').getTime();

beforeAll(async () => {
  StartTimeSheet = (await import('../components/StartTimeSheet'))
    .StartTimeSheet;
});

function renderSheet(
  overrides: Partial<React.ComponentProps<typeof StartTimeSheet>> = {}
) {
  mutateAsync.mockClear();
  const onSaved = mock();
  const utils = render(
    <StartTimeSheet
      entryId="t1"
      clockInAt={CLOCK_IN_AT}
      scheduledStartAt={SCHEDULED_AT}
      timeZone={TIME_ZONE}
      onDismiss={() => {}}
      onSaved={onSaved}
      nowMs={NOW_MS}
      {...overrides}
    />
  );
  return { ...utils, onSaved };
}

describe('StartTimeSheet', () => {
  it('prefills the scheduled start, so the common fix is one tap', () => {
    const { getByTestId } = renderSheet();
    expect(getByTestId('start-time-input').props.value).toBe('09:00');
  });

  it('falls back to the recorded start when no shift matched', () => {
    const { getByTestId } = renderSheet({ scheduledStartAt: null });
    expect(getByTestId('start-time-input').props.value).toBe('09:20');
  });

  it('sends the corrected start as an instant in the household zone', async () => {
    const { getByTestId } = renderSheet();
    fireEvent.press(getByTestId('start-time-submit'));

    expect(mutateAsync).toHaveBeenCalledWith({
      entryId: 't1',
      clock_in_at: SCHEDULED_AT,
    });
  });

  it('refuses a start in the future and does not submit', () => {
    const { getByTestId, queryByTestId } = renderSheet();
    // "Now" is 09:30 UTC, which is 10:30 London in BST — so 11:30 London is
    // an hour ahead of it.
    fireEvent.changeText(getByTestId('start-time-input'), '11:30');

    expect(queryByTestId('start-time-error')).not.toBeNull();
    fireEvent.press(getByTestId('start-time-submit'));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('refuses an unparseable time and does not submit', () => {
    const { getByTestId, queryByTestId } = renderSheet();
    fireEvent.changeText(getByTestId('start-time-input'), '99:99');

    expect(queryByTestId('start-time-error')).not.toBeNull();
    fireEvent.press(getByTestId('start-time-submit'));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('accepts an EARLIER start — starting early is not an error', () => {
    const { getByTestId } = renderSheet();
    fireEvent.changeText(getByTestId('start-time-input'), '08:30');
    fireEvent.press(getByTestId('start-time-submit'));

    expect(mutateAsync).toHaveBeenCalledWith({
      entryId: 't1',
      clock_in_at: '2026-08-03T07:30:00.000Z',
    });
  });
});
