/**
 * @module WeekStripTests
 *
 * TDD tests for WeekStrip. The load-bearing assertion is the storage/display
 * mismatch: `selected` uses Postgres `extract(dow)` (0=Sunday..6=Saturday),
 * but the app displays days Monday-first (en-GB). A selected `0` must render
 * as the LAST cell, never the first — that's exactly the off-by-one this
 * component exists to get right.
 */

import { describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { WeekStrip } from '../week-strip';

/** Narrows a React Native test-tree child (which may be a plain text node)
 * down to a queryable instance with `.props`. */
function isInstance(
  node: ReactTestInstance | string
): node is ReactTestInstance {
  return typeof node !== 'string';
}

describe('WeekStrip', () => {
  it('renders one cell per day of the week', () => {
    const { getByTestId } = render(
      <WeekStrip selected={[]} onToggle={() => {}} testID="week-strip" />
    );
    for (let day = 0; day <= 6; day++) {
      expect(getByTestId(`week-strip-day-${day}`)).toBeTruthy();
    }
  });

  it('renders Monday-first: day 0 (Sunday) is the LAST cell, day 1 (Monday) is the FIRST', () => {
    const { getByTestId } = render(
      <WeekStrip selected={[]} onToggle={() => {}} testID="week-strip" />
    );
    const cells = getByTestId('week-strip').children.filter(isInstance);
    expect(cells).toHaveLength(7);
    expect(cells[0]?.props.testID).toBe('week-strip-day-1');
    expect(cells[cells.length - 1]?.props.testID).toBe('week-strip-day-0');
  });

  it('D29: weekStartsOn=0 reorders display but onToggle still reports Postgres dow', () => {
    const onToggle = mock(() => {});
    const { getByTestId } = render(
      <WeekStrip
        selected={[]}
        onToggle={onToggle}
        weekStartsOn={0}
        testID="week-strip"
      />
    );
    const cells = getByTestId('week-strip').children.filter(isInstance);
    expect(cells[0]?.props.testID).toBe('week-strip-day-0');
    expect(cells[1]?.props.testID).toBe('week-strip-day-1');
    fireEvent.press(getByTestId('week-strip-day-0'));
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it('marks the selected day as selected and leaves others unselected', () => {
    const { getByTestId } = render(
      <WeekStrip selected={[0]} onToggle={() => {}} testID="week-strip" />
    );
    const cells = getByTestId('week-strip').children.filter(isInstance);
    const sunday = cells.find(c => c.props.testID === 'week-strip-day-0');
    const monday = cells.find(c => c.props.testID === 'week-strip-day-1');
    expect(sunday?.props.accessibilityState.selected).toBe(true);
    expect(monday?.props.accessibilityState.selected).toBe(false);
  });

  it('calls onToggle with the Postgres day-of-week index on press', () => {
    const onToggle = mock(() => {});
    const { getByTestId } = render(
      <WeekStrip selected={[]} onToggle={onToggle} testID="week-strip" />
    );
    fireEvent.press(getByTestId('week-strip-day-3')); // Wednesday
    expect(onToggle).toHaveBeenCalledWith(3);
  });

  it('does not fire onToggle for a disabled day', () => {
    const onToggle = mock(() => {});
    const { getByTestId } = render(
      <WeekStrip
        selected={[]}
        onToggle={onToggle}
        disabled={[2]}
        testID="week-strip"
      />
    );
    fireEvent.press(getByTestId('week-strip-day-2'));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('falls back to a default testID prefix when none is given', () => {
    const { getByTestId } = render(
      <WeekStrip selected={[]} onToggle={() => {}} />
    );
    expect(getByTestId('week-strip-day-1')).toBeTruthy();
  });
});
