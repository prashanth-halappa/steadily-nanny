/**
 * @module domains/setup/__tests__/AvailabilityEditor.behavior.test
 *
 * Pattern B — render + press. Covers the two things source inspection cannot
 * prove about the seven-row redesign: every weekday gets a visible switch
 * (the `WeekStrip` it replaced rendered unselected days as invisible chips),
 * and "use these times on my other days" writes every OTHER enabled day
 * while leaving disabled days alone.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent } from '@testing-library/react-native';
import { renderWithProviders } from '@/src/test-utils';

interface Row {
  weekday: number;
  is_available: boolean;
  earliest_start: string | null;
  latest_finish: string | null;
  evening_mode: string;
}

const row = (
  weekday: number,
  is_available: boolean,
  start = '09:00',
  end = '17:00'
): Row => ({
  weekday,
  is_available,
  earliest_start: start,
  latest_finish: end,
  evening_mode: 'sometimes',
});

let rows: Row[] = [];
let weekStartsOn = 1;
const mutateMock = mock((_input: Record<string, unknown>) => undefined);

mock.module('@/src/hooks/queries/useAvailability', () => ({
  useAvailability: () => ({ data: rows, isLoading: false }),
}));

mock.module('@/src/hooks/mutations/useUpsertAvailability', () => ({
  useUpsertAvailability: () => ({ mutate: mutateMock }),
}));

mock.module('@/src/hooks/queries/useUserProfile', () => ({
  useUserProfile: () => ({ data: { week_starts_on: weekStartsOn } }),
}));

mock.module('@/src/components/ui/switch', () => {
  const React = require('react');
  return {
    Switch: ({
      checked,
      onCheckedChange,
      testID,
    }: {
      checked?: boolean;
      onCheckedChange?: (value: boolean) => void;
      testID?: string;
    }) =>
      React.createElement('Pressable', {
        testID,
        accessibilityState: { checked: !!checked },
        onPress: () => onCheckedChange?.(!checked),
      }),
  };
});

let AvailabilityEditor: typeof import('../components/AvailabilityEditor').AvailabilityEditor;

beforeAll(async () => {
  ({ AvailabilityEditor } = await import('../components/AvailabilityEditor'));
});

beforeEach(() => {
  rows = [];
  weekStartsOn = 1;
  mutateMock.mockClear();
});

describe('AvailabilityEditor', () => {
  it('renders a switch for all seven days even when none are selected', () => {
    const { getByTestId, queryByTestId } = renderWithProviders(
      <AvailabilityEditor />
    );

    for (let day = 0; day < 7; day += 1) {
      expect(getByTestId(`availability-day-switch-${day}`)).toBeTruthy();
      // No day is on, so no picker and no apply-to-all affordance yet.
      expect(queryByTestId(`availability-time-range-${day}`)).toBeNull();
    }
    expect(queryByTestId('availability-apply-to-other-days')).toBeNull();
  });

  it('reveals the time picker for a day that is on, and hides apply-to-all until a second day is on', () => {
    rows = [row(1, true)];
    const { getByTestId, queryByTestId } = renderWithProviders(
      <AvailabilityEditor />
    );

    expect(getByTestId('availability-time-range-1')).toBeTruthy();
    expect(queryByTestId('availability-time-range-2')).toBeNull();
    // One day on: there is nothing to apply to.
    expect(queryByTestId('availability-apply-to-other-days')).toBeNull();
  });

  it('applies the first enabled day hours to every OTHER enabled day and leaves disabled days untouched', () => {
    rows = [
      row(1, true, '08:00', '16:00'),
      row(2, true, '10:00', '18:00'),
      row(3, false, '09:00', '17:00'),
      row(5, true, '12:00', '15:00'),
    ];
    const { getByTestId } = renderWithProviders(<AvailabilityEditor />);

    fireEvent.press(getByTestId('availability-apply-to-other-days'));

    // Monday (dow 1) is the source and is NOT rewritten; Tue and Fri are.
    expect(mutateMock).toHaveBeenCalledTimes(2);
    const written = mutateMock.mock.calls.map(([input]) => input);
    expect(written).toEqual([
      {
        weekday: 2,
        is_available: true,
        earliest_start: '08:00',
        latest_finish: '16:00',
        evening_mode: 'sometimes',
      },
      {
        weekday: 5,
        is_available: true,
        earliest_start: '08:00',
        latest_finish: '16:00',
        evening_mode: 'sometimes',
      },
    ]);
    // Wednesday is off — never written, and never turned on as a side effect.
    expect(written.some(input => input.weekday === 3)).toBe(false);

    expect(getByTestId('availability-applied-confirmation')).toBeTruthy();
  });

  it('renders apply-to-all under the FIRST enabled day in display order, not the lowest dow', () => {
    // week_starts_on = 0 (Sunday first), so Sunday leads the display order.
    weekStartsOn = 0;
    rows = [row(0, true, '07:00', '12:00'), row(1, true, '09:00', '17:00')];
    const { getByTestId } = renderWithProviders(<AvailabilityEditor />);

    fireEvent.press(getByTestId('availability-apply-to-other-days'));

    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock.mock.calls[0]?.[0]).toMatchObject({
      weekday: 1,
      earliest_start: '07:00',
      latest_finish: '12:00',
    });
  });
});
