/**
 * @module domains/timesheet/__tests__/TimeEntryRow.test
 * One entry = one card — duration, editability, voided, break subline.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
import type { TimeEntry } from '../types';
import { formatDuration } from '../utils/duration';
import { computeEntryMinutes } from '../utils/entryMinutes';

let TimeEntryRow: typeof import('../components/TimeEntryRow').TimeEntryRow;

beforeAll(async () => {
  TimeEntryRow = (await import('../components/TimeEntryRow')).TimeEntryRow;
});

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    carer_display_name: 'Nia Rowe',
    shift_id: null,
    clock_in_at: '2026-08-01T07:58:00.000Z',
    clock_out_at: '2026-08-01T09:58:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-01',
    timezone: 'Europe/London',
    created_at: '2026-08-01T07:58:00.000Z',
    updated_at: '2026-08-01T07:58:00.000Z',
    ...overrides,
  };
}

const NOW_MS = new Date('2026-08-01T12:00:00.000Z').getTime();

describe('TimeEntryRow — per-entry duration', () => {
  it('renders duration equal to computeEntryMinutes', () => {
    const entry = makeEntry();
    const minutes = computeEntryMinutes(entry, NOW_MS);
    const { getByText } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(getByText(formatDuration(minutes))).toBeTruthy();
  });

  it('uses scheduled_minutes for a cancellation_paid entry', () => {
    const entry = makeEntry({
      kind: 'cancellation_paid',
      clock_in_at: '2026-08-01T08:00:00.000Z',
      clock_out_at: '2026-08-01T09:00:00.000Z',
      scheduled_minutes: 45,
    });
    const minutes = computeEntryMinutes(entry, NOW_MS);
    const { getByText } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(minutes).toBe(45);
    expect(getByText(formatDuration(45))).toBeTruthy();
  });
});

describe('TimeEntryRow — edit affordance', () => {
  it('shows chevron and is pressable when onPress is provided', () => {
    const entry = makeEntry();
    const onPress = mock(() => {});
    const { getByTestId, UNSAFE_getByType } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        onPress={onPress}
      />
    );

    expect(UNSAFE_getByType('ChevronRight' as never)).toBeTruthy();
    fireEvent.press(getByTestId(`hours-edit-entry-${entry.id}`));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('carries minHeight 44 on the pressable inner view', () => {
    const entry = makeEntry();
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        onPress={mock(() => {})}
      />
    );

    const pressable = getByTestId(`hours-edit-entry-${entry.id}`);
    const innerView = pressable.props.children;
    const style = Array.isArray(innerView.props.style)
      ? innerView.props.style.flat()
      : [innerView.props.style];
    expect(style.some((s: { minHeight?: number }) => s?.minHeight === 44)).toBe(
      true
    );
  });

  it('omits chevron when no onPress (read-only parent view)', () => {
    const entry = makeEntry();
    const { UNSAFE_queryByType } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(UNSAFE_queryByType('ChevronRight' as never)).toBeNull();
  });

  it('omits chevron on a running entry', () => {
    const entry = makeEntry({
      clock_out_at: null,
      status: 'running',
      clock_in_at: new Date(NOW_MS).toISOString(),
    });
    const { UNSAFE_queryByType } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        onPress={mock(() => {})}
      />
    );

    expect(UNSAFE_queryByType('ChevronRight' as never)).toBeNull();
  });
});

describe('TimeEntryRow — break subline', () => {
  it('renders break subline when break_minutes > 0', () => {
    const entry = makeEntry({ break_minutes: 30 });
    const { getByText } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(getByText('entryBreak')).toBeTruthy();
  });

  it('renders nothing for break when break_minutes is 0', () => {
    const entry = makeEntry({ break_minutes: 0 });
    const { queryByText } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(queryByText('entryBreak')).toBeNull();
  });
});

describe('TimeEntryRow — edited pill and +1 marker', () => {
  it('renders edited as a StatusPill, not inside the time string', () => {
    const entry = makeEntry({
      clock_out_at: '2026-08-01T09:58:00.000Z',
      updated_at: '2026-08-02T11:00:00.000Z',
    });
    const { getByText, getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(getByText('edited')).toBeTruthy();
    const timeEl = getByTestId(`hours-entry-time-${entry.id}`);
    expect(timeEl.props.children.join('')).not.toContain('edited');
  });

  it('keeps +1 inside the time range string', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T22:53:00.000Z',
      clock_out_at: '2026-08-02T21:26:00.000Z',
    });
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    const timeEl = getByTestId(`hours-entry-time-${entry.id}`);
    expect(timeEl.props.children.join('')).toContain('nextDayMarker');
  });
});

describe('TimeEntryRow — voided entry', () => {
  it('renders struck through and not pressable', () => {
    const entry = makeEntry({
      status: 'voided',
      clock_out_at: '2026-08-01T09:58:00.000Z',
    });
    const { getByTestId, queryByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        onPress={mock(() => {})}
      />
    );

    expect(getByTestId(`hours-voided-entry-${entry.id}`)).toBeTruthy();
    expect(queryByTestId(`hours-edit-entry-${entry.id}`)).toBeNull();
  });

  it('with no finish never reads in progress and omits the time range dash', () => {
    const entry = makeEntry({
      id: 'discarded-running',
      status: 'voided',
      clock_out_at: null,
    });
    const { getByTestId, queryByText } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(getByTestId(`hours-voided-entry-${entry.id}`)).toBeTruthy();
    expect(queryByText(/inProgress/)).toBeNull();
    expect(queryByText(/–/)).toBeNull();
  });
});

describe('TimeEntryRow — zero-duration flag', () => {
  it('calls onPress when editable and flagged', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T07:58:00.000Z',
    });
    const onPress = mock(() => {});
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        onPress={onPress}
      />
    );

    expect(getByTestId('hours-zero-duration-flag')).toBeTruthy();
    fireEvent.press(getByTestId(`hours-edit-entry-${entry.id}`));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('calls onFlagPress when not editable and flagged', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T07:58:00.000Z',
    });
    const onFlagPress = mock(() => {});
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        onFlagPress={onFlagPress}
      />
    );

    fireEvent.press(getByTestId(`hours-flagged-entry-${entry.id}`));
    expect(onFlagPress).toHaveBeenCalledTimes(1);
  });
});

describe('TimeEntryRow — the flag is legible, not just coloured', () => {
  // Regression guard: the zero-duration flag was once a "– check this entry"
  // suffix glued into the time string. Splitting metadata into slots is
  // right, but the text must survive the move — warning-coloured times with
  // no words tell a sighted carer nothing about WHY the row is highlighted,
  // and a colour-only signal is not an accessible one.
  it('renders the flag as visible text, not only as an accessibility label', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T07:58:00.000Z',
    });
    const { getByTestId, getByText } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(getByTestId(`hours-entry-flag-pill-${entry.id}`)).toBeTruthy();
    // i18n is stubbed to echo the key, so this asserts "the string reaches
    // the screen", not "this English copy".
    expect(getByText('flaggedCheckEntry')).toBeTruthy();
  });

  it('shows no flag pill on an ordinary entry', () => {
    const entry = makeEntry();
    const { queryByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(queryByTestId(`hours-entry-flag-pill-${entry.id}`)).toBeNull();
  });
});
