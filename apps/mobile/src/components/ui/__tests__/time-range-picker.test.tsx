/**
 * @module TimeRangePickerTests
 *
 * Render tests (docs/09-TESTING.md §5 Pattern B). This file was previously
 * source-inspection only (Pattern A) because
 * `@react-native-community/datetimepicker` ships raw Flow-typed `.js`
 * source that crashed Bun's parser at import time, before any
 * `mock.module()` could intercept it — see `bun.setup.ts`'s mock for that
 * package (D25) for the fix: mocking it in the shared preload, the only
 * place early enough to matter (same root-cause class as D19's netinfo
 * fix). That mock renders the native picker as a plain host `View`
 * forwarding `onChange`, so a real selection can be driven with
 * `fireEvent(getByTestId('...-start'), 'change', {}, someDate)`.
 *
 * The pure "HH:MM" logic (parseTime/formatTime/isEndAfterStart) has its own
 * dedicated, dependency-free unit tests in time-range-picker.utils.test.ts —
 * this file exercises the real component wired to the real (mocked-native)
 * picker: actual `onChange` calls, derived inline errors, and end-to-end
 * invalid-range handling.
 */
import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { TimeRangePicker } from '../time-range-picker';

mock.module('@/lib/animations/useReducedMotion', () => ({
  useReducedMotion: mock(() => false),
}));

// Derived from `render` rather than hand-written: a props-only shape does not
// satisfy `fireEvent`'s `ReactTestInstance` parameter, and hand-typing it here
// drifts the moment the testing library's return type changes.
type GetByTestId = ReturnType<typeof render>['getByTestId'];

/** Drives the mocked native picker's onChange exactly like a real selection. */
function selectStart(
  getByTestId: GetByTestId,
  testID: string,
  hours: number,
  minutes: number
) {
  fireEvent(
    getByTestId(`${testID}-start`),
    'change',
    {},
    new Date(2026, 0, 1, hours, minutes)
  );
}
function selectEnd(
  getByTestId: GetByTestId,
  testID: string,
  hours: number,
  minutes: number
) {
  fireEvent(
    getByTestId(`${testID}-end`),
    'change',
    {},
    new Date(2026, 0, 1, hours, minutes)
  );
}

function StatefulRangePicker({
  initialStart = '09:00',
  initialEnd = '17:00',
  testID = 'range',
}: {
  initialStart?: string;
  initialEnd?: string;
  testID?: string;
}) {
  const [start, setStart] = useState(initialStart);
  const [end, setEnd] = useState(initialEnd);
  return (
    <TimeRangePicker
      testID={testID}
      start={start}
      end={end}
      onChange={(nextStart, nextEnd) => {
        setStart(nextStart);
        setEnd(nextEnd);
      }}
    />
  );
}

describe('TimeRangePicker', () => {
  it('renders start and end pickers under the given testID', () => {
    const { getByTestId } = render(
      <TimeRangePicker
        testID="range"
        start="09:00"
        end="17:00"
        onChange={mock()}
      />
    );
    expect(getByTestId('range-start')).toBeTruthy();
    expect(getByTestId('range-end')).toBeTruthy();
  });

  it('defaults to the "time-range-picker" testID when none is given', () => {
    const { getByTestId } = render(
      <TimeRangePicker start="09:00" end="17:00" onChange={mock()} />
    );
    expect(getByTestId('time-range-picker')).toBeTruthy();
  });

  it('calls onChange with a formatted "HH:MM" string, never a raw Date, when the start changes', () => {
    const onChange = mock();
    const { getByTestId } = render(
      <TimeRangePicker
        testID="range"
        start="09:00"
        end="17:00"
        onChange={onChange}
      />
    );
    selectStart(getByTestId, 'range', 8, 0);
    expect(onChange).toHaveBeenCalledWith('08:00', '17:00');
  });

  it('calls onChange with a formatted "HH:MM" string when the end changes', () => {
    const onChange = mock();
    const { getByTestId } = render(
      <TimeRangePicker
        testID="range"
        start="09:00"
        end="17:00"
        onChange={onChange}
      />
    );
    selectEnd(getByTestId, 'range', 18, 30);
    expect(onChange).toHaveBeenCalledWith('09:00', '18:30');
  });

  it('always calls onChange with the picked value even when the range becomes invalid', () => {
    const onChange = mock();
    const { getByTestId } = render(
      <TimeRangePicker
        testID="range"
        start="09:00"
        end="17:00"
        onChange={onChange}
      />
    );
    selectEnd(getByTestId, 'range', 8, 0);
    expect(onChange).toHaveBeenCalledWith('09:00', '08:00');
  });

  it('calls onChange with an invalid start at or after the current end and shows the inline error', () => {
    const { getByTestId, queryByTestId } = render(<StatefulRangePicker />);
    expect(queryByTestId('range-error')).toBeNull();

    selectStart(getByTestId, 'range', 18, 0); // after the current end (17:00)

    expect(getByTestId('range-error')).toBeTruthy();
  });

  it('calls onChange with an invalid end at or before the current start and shows the inline error', () => {
    const { getByTestId } = render(<StatefulRangePicker />);
    selectEnd(getByTestId, 'range', 8, 0); // before the current start (09:00)

    expect(getByTestId('range-error')).toBeTruthy();
  });

  it('treats end exactly equal to start as invalid — "after" is strict, not "on or after"', () => {
    const { getByTestId } = render(<StatefulRangePicker />);
    selectEnd(getByTestId, 'range', 9, 0); // exactly equal to start

    expect(getByTestId('range-error')).toBeTruthy();
  });

  it('renders the range-error node when mounted with invalid props', () => {
    const { getByTestId } = render(
      <TimeRangePicker
        testID="range"
        start="17:00"
        end="09:00"
        onChange={mock()}
      />
    );
    expect(getByTestId('range-error')).toBeTruthy();
  });

  it('clears the error once props become valid again', () => {
    const { getByTestId, queryByTestId } = render(<StatefulRangePicker />);
    selectStart(getByTestId, 'range', 18, 0);
    expect(getByTestId('range-error')).toBeTruthy();

    selectStart(getByTestId, 'range', 8, 0);
    expect(queryByTestId('range-error')).toBeNull();
  });
});
