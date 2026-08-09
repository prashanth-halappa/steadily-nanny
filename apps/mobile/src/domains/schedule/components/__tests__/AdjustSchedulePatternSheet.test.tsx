/**
 * @module domains/schedule/components/__tests__/AdjustSchedulePatternSheet.test
 *
 * Sheet-owns-values, screen-owns-mutation: this component only builds and
 * reports an `AmendSchedulePatternInput` via `onSubmit`. Offers exactly the
 * two amendment kinds `schedulePatternCommandService.amend` supports that a
 * parent would reach for on an accepted week — skip a week (`pause_ranges`)
 * and change/remove the end date (`until`) — and states plainly that a
 * day/time change still means sending a new usual week (the server has no
 * post-accept day/time amend).
 *
 * `TimeOffDateRangePicker` is mocked to a single "set range" control, same
 * reason `TimeOffScreen.test.tsx` mocks it (the underlying native
 * datetimepicker cannot be parsed under bun:test at PARSE time unless
 * intercepted early — see that file's header comment); the single end-date
 * field uses `@react-native-community/datetimepicker` directly, which IS
 * globally mocked to a plain host View in `bun.setup.ts`, so it is driven
 * via a real `fireEvent(..., 'change', {}, someDate)`.
 *
 * `@rn-primitives/alert-dialog` is mocked with the same stand-in used by
 * `TimeOffScreen.test.tsx` / `ManageHouseholdScreen.test` (its .mjs
 * distribution isn't pre-compiled for bun:test).
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, waitFor } from '@testing-library/react-native';
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

mock.module('@/src/domains/timeOff/components/TimeOffDateRangePicker', () => {
  const React = require('react');
  return {
    TimeOffDateRangePicker: ({
      onChange,
      testID,
    }: {
      onChange: (start: string, end: string) => void;
      testID?: string;
    }) => {
      const base = testID ?? 'time-off-date-range';
      return React.createElement(
        React.Fragment,
        null,
        React.createElement('TouchableOpacity', {
          testID: `${base}-set-range`,
          onPress: () => onChange('2026-04-01', '2026-04-08'),
        }),
        React.createElement('TouchableOpacity', {
          testID: `${base}-set-invalid-range`,
          onPress: () => onChange('2026-04-08', '2026-04-01'),
        })
      );
    },
  };
});

mock.module('@rn-primitives/alert-dialog', () => {
  const React = require('react');
  const Ctx = React.createContext({
    open: false,
    setOpen: (_open: boolean) => {},
  });

  return {
    Root: ({
      children,
      open,
      onOpenChange,
    }: {
      children: React.ReactNode;
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
    }) => {
      const setOpen = (next: boolean) => onOpenChange?.(next);
      return React.createElement(
        Ctx.Provider,
        { value: { open: open ?? false, setOpen } },
        children
      );
    },
    Trigger: ({
      children,
      onPress,
      disabled,
      ...props
    }: {
      children: React.ReactNode;
      onPress?: (e: unknown) => void;
      disabled?: boolean;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          disabled,
          onPress: (e: unknown) => {
            onPress?.(e);
            if (!disabled) setOpen(true);
          },
        },
        children
      );
    },
    Portal: ({ children }: { children: React.ReactNode }) => children,
    Overlay: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const { open } = React.useContext(Ctx);
      return open ? React.createElement('View', props, children) : null;
    },
    Content: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('View', props, children),
    Title: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Description: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Text', props, children),
    Cancel: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    Action: ({
      children,
      onPress,
      ...props
    }: {
      children?: React.ReactNode;
      onPress?: (e: unknown) => void;
      [key: string]: unknown;
    }) => {
      const { setOpen } = React.useContext(Ctx);
      return React.createElement(
        'Pressable',
        {
          ...props,
          onPress: (e: unknown) => {
            onPress?.(e);
            setOpen(false);
          },
        },
        children
      );
    },
    useRootContext: () => React.useContext(Ctx),
  };
});

let AdjustSchedulePatternSheet: typeof import('../AdjustSchedulePatternSheet').AdjustSchedulePatternSheet;
type AdjustSchedulePatternSheetProps =
  import('../AdjustSchedulePatternSheet').AdjustSchedulePatternSheetProps;

beforeAll(async () => {
  AdjustSchedulePatternSheet = (await import('../AdjustSchedulePatternSheet'))
    .AdjustSchedulePatternSheet;
});

function baseProps(
  overrides: Partial<AdjustSchedulePatternSheetProps> = {}
): AdjustSchedulePatternSheetProps {
  return {
    visible: true,
    onDismiss: mock(),
    dtstart: '2026-01-05',
    until: null,
    pauseRanges: [],
    onSubmit: mock(),
    isSubmitting: false,
    ...overrides,
  };
}

describe('AdjustSchedulePatternSheet menu', () => {
  it('renders the day/time-change note and both amendment options', () => {
    const { getByTestId, getByText } = renderWithProviders(
      <AdjustSchedulePatternSheet {...baseProps()} />
    );

    expect(getByText('pending.adjustSheetDayTimeNote')).toBeTruthy();
    expect(getByTestId('schedule-adjust-skip-week-option')).toBeTruthy();
    expect(getByTestId('schedule-adjust-end-date-option')).toBeTruthy();
    // No "remove end date" affordance from the menu itself.
    expect(() => getByTestId('schedule-adjust-end-date-remove')).toThrow();
  });
});

describe('AdjustSchedulePatternSheet skip-a-week flow', () => {
  it('submits pause_ranges appended to the existing ranges, no confirm needed', async () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <AdjustSchedulePatternSheet
        {...baseProps({
          pauseRanges: [{ from: '2026-02-01', to: '2026-02-08' }],
          onSubmit,
        })}
      />
    );

    fireEvent.press(getByTestId('schedule-adjust-skip-week-option'));
    expect(getByTestId('schedule-adjust-skip-week')).toBeTruthy();

    fireEvent.press(getByTestId('schedule-adjust-skip-week-dates-set-range'));
    fireEvent.press(getByTestId('schedule-adjust-skip-week-submit'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({
      pause_ranges: [
        { from: '2026-02-01', to: '2026-02-08' },
        { from: '2026-04-01', to: '2026-04-08' },
      ],
    });
  });

  it('the back affordance returns to the menu without submitting', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <AdjustSchedulePatternSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.press(getByTestId('schedule-adjust-skip-week-option'));
    fireEvent.press(getByTestId('schedule-adjust-skip-week-back'));

    expect(getByTestId('schedule-adjust-menu')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables submit when skipStart/skipEnd is an invalid range', () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <AdjustSchedulePatternSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.press(getByTestId('schedule-adjust-skip-week-option'));
    fireEvent.press(
      getByTestId('schedule-adjust-skip-week-dates-set-invalid-range')
    );
    fireEvent.press(getByTestId('schedule-adjust-skip-week-submit'));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('AdjustSchedulePatternSheet end-date flow', () => {
  it('confirms via AlertDialog before submitting a NEW end date (destructive)', async () => {
    const onSubmit = mock();
    const { getByTestId } = renderWithProviders(
      <AdjustSchedulePatternSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.press(getByTestId('schedule-adjust-end-date-option'));
    fireEvent(
      getByTestId('schedule-adjust-end-date-picker'),
      'change',
      {},
      new Date(2026, 2, 1) // 2026-03-01
    );
    fireEvent.press(getByTestId('schedule-adjust-end-date-submit'));
    // Not submitted yet — the AlertDialog confirm hasn't fired.
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.press(getByTestId('schedule-adjust-end-date-confirm'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ until: '2026-03-01' });
  });

  it('rejects an end date before dtstart with an inline error, never calling onSubmit', () => {
    const onSubmit = mock();
    const { getByTestId, queryByTestId } = renderWithProviders(
      <AdjustSchedulePatternSheet
        {...baseProps({ dtstart: '2026-01-05', onSubmit })}
      />
    );

    fireEvent.press(getByTestId('schedule-adjust-end-date-option'));
    fireEvent(
      getByTestId('schedule-adjust-end-date-picker'),
      'change',
      {},
      new Date(2026, 0, 1) // 2026-01-01, before dtstart
    );

    expect(getByTestId('schedule-adjust-end-date-error')).toBeTruthy();
    expect(queryByTestId('schedule-adjust-end-date-confirm')).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('only offers "remove end date" when the pattern already has one, and it skips the confirm dialog', async () => {
    const onSubmit = mock();
    const { getByTestId, queryByTestId, rerender } = renderWithProviders(
      <AdjustSchedulePatternSheet {...baseProps({ onSubmit })} />
    );

    fireEvent.press(getByTestId('schedule-adjust-end-date-option'));
    expect(queryByTestId('schedule-adjust-end-date-remove')).toBeNull();

    rerender(
      <AdjustSchedulePatternSheet
        {...baseProps({ until: '2026-06-01', onSubmit })}
      />
    );
    fireEvent.press(getByTestId('schedule-adjust-end-date-option'));

    fireEvent.press(getByTestId('schedule-adjust-end-date-remove'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith({ until: null });
  });
});

describe('AdjustSchedulePatternSheet — GOLDEN-FIX #1', () => {
  it('never renders a bare RN <Modal> — goes through BottomSheetBase', async () => {
    const source = await Bun.file(
      join(__dirname, '../AdjustSchedulePatternSheet.tsx')
    ).text();
    expect(source).toContain('BottomSheetBase');
    expect(source).not.toMatch(/<Modal\b/);
  });
});
