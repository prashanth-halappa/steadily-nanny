/**
 * @module domains/timesheet/__tests__/TimeEntryDayRow.test
 *
 * Mock-rendering test (Pattern B, docs/09-TESTING.md §5) — covers the
 * zero-duration flag: a FINISHED entry (clock_out_at set) that computes to
 * 0 minutes must render distinctly, not blend in as a plausible short
 * shift. A still-running entry with 0 elapsed so far must NOT be flagged.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, within } from '@testing-library/react-native';
import type { TimeEntry } from '../types';

// `@rn-primitives/alert-dialog` .mjs isn't pre-compiled for bun:test —
// same stand-in as ManageHouseholdScreen.test (Wave 4 flagged-entry dialog).
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
    }) =>
      React.createElement(
        Ctx.Provider,
        {
          value: {
            open: open ?? false,
            setOpen: (next: boolean) => onOpenChange?.(next),
          },
        },
        children
      ),
    Trigger: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Pressable', props, children),
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
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Pressable', props, children),
    Action: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement('Pressable', props, children),
    useRootContext: () => React.useContext(Ctx),
  };
});

let TimeEntryDayRow: typeof import('../components/TimeEntryDayRow').TimeEntryDayRow;

beforeAll(async () => {
  TimeEntryDayRow = (await import('../components/TimeEntryDayRow'))
    .TimeEntryDayRow;
});

function makeEntry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: 'entry-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    carer_display_name: 'Nia Rowe',
    shift_id: null,
    clock_in_at: '2026-08-01T07:58:00.000Z',
    clock_out_at: '2026-08-01T07:58:00.000Z',
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

describe('TimeEntryDayRow — zero-duration flag', () => {
  it('flags a finished entry that computed to 0 minutes', () => {
    const entry = makeEntry(); // clock_in_at === clock_out_at -> 0 minutes
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByTestId('hours-zero-duration-flag')).toBeTruthy();
  });

  it('makes a flagged entry pressable so the explanation dialog can open', () => {
    const entry = makeEntry();
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByTestId(`hours-flagged-entry-${entry.id}`)).toBeTruthy();
    fireEvent.press(getByTestId(`hours-flagged-entry-${entry.id}`));
  });

  it('does NOT flag a still-running entry with 0 elapsed so far', () => {
    const entry = makeEntry({
      clock_in_at: new Date(NOW_MS).toISOString(),
      clock_out_at: null,
      status: 'running',
    });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });

  it('does NOT flag a normal finished entry with real minutes', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T09:58:00.000Z',
    });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });
});

describe('TimeEntryDayRow — voided entry (069)', () => {
  it('renders a voided entry visibly but struck through and muted', () => {
    const entry = makeEntry({
      status: 'voided',
      clock_out_at: '2026-08-01T09:58:00.000Z',
      updated_at: '2026-08-02T11:00:00.000Z',
    });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByTestId(`hours-voided-entry-${entry.id}`)).toBeTruthy();
  });

  it('excludes voided minutes from the day total', () => {
    const voided = makeEntry({
      id: 'voided',
      status: 'voided',
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T14:12:00.000Z',
    });
    const real = makeEntry({
      id: 'real',
      clock_in_at: '2026-08-01T15:00:00.000Z',
      clock_out_at: '2026-08-01T17:00:00.000Z',
    });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[voided, real]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    // 2h real only — the voided 6h14m must not appear.
    expect(within(getByTestId('hours-day-row')).getByText('2h')).toBeTruthy();
  });

  it('does not flag a voided zero-duration entry', () => {
    const entry = makeEntry({ status: 'voided' });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });

  it('offers no edit affordance on a voided entry', () => {
    const entry = makeEntry({
      status: 'voided',
      clock_out_at: '2026-08-01T09:58:00.000Z',
    });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        onEditEntry={mock(() => {})}
        timesheetStatus="submitted"
      />
    );

    expect(queryByTestId(`hours-edit-entry-${entry.id}`)).toBeNull();
  });
});

describe('TimeEntryDayRow — correction affordance (P0-2)', () => {
  it('makes an editable entry pressable and hands the entry back', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const onEditEntry = mock(() => {});
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        onEditEntry={onEditEntry}
        timesheetStatus="submitted"
      />
    );

    fireEvent.press(getByTestId(`hours-edit-entry-${entry.id}`));
    expect(onEditEntry).toHaveBeenCalledWith(entry);
  });

  it('offers no edit on the parent side — the row is identical but read-only', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        timesheetStatus="submitted"
      />
    );

    expect(queryByTestId(`hours-edit-entry-${entry.id}`)).toBeNull();
  });

  it('offers no edit once the parent has approved the week', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        onEditEntry={mock(() => {})}
        timesheetStatus="approved"
      />
    );

    expect(queryByTestId(`hours-edit-entry-${entry.id}`)).toBeNull();
  });

  it('prefers the correction over the explainer on a flagged-but-editable entry', () => {
    const entry = makeEntry(); // zero-duration
    const { getByTestId, queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        onEditEntry={mock(() => {})}
        timesheetStatus="submitted"
      />
    );

    expect(getByTestId(`hours-edit-entry-${entry.id}`)).toBeTruthy();
    expect(queryByTestId(`hours-flagged-entry-${entry.id}`)).toBeNull();
    // The flag itself stays — it's still the thing that drew her eye.
    expect(getByTestId('hours-zero-duration-flag')).toBeTruthy();
  });

  it('marks an entry that was changed after it was clocked out', () => {
    const entry = makeEntry({
      clock_out_at: '2026-08-01T09:58:00.000Z',
      updated_at: '2026-08-02T11:00:00.000Z',
    });
    const { getByText } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        timesheetStatus="submitted"
      />
    );

    expect(getByText(/edited/)).toBeTruthy();
  });
});

describe('TimeEntryDayRow — dated labels (parent CX H1)', () => {
  it('renders weekday plus calendar date on one line', () => {
    const { getByText } = render(
      <TimeEntryDayRow
        date="2026-08-03"
        entries={[]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    // i18n is unstubbed in this suite — weekday key + formatDisplayDate.
    expect(getByText(/schedule:weekday\.1 3 Aug/)).toBeTruthy();
  });

  it('marks today with a Today label', () => {
    // NOW_MS is 2026-08-01T12:00Z → Europe/London local date is 2026-08-01.
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByTestId('hours-day-today')).toBeTruthy();
  });

  it('says Not yet for a future empty day, not No hours logged', () => {
    const { getByText, queryByText } = render(
      <TimeEntryDayRow
        date="2026-08-05"
        entries={[]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByText('notYet')).toBeTruthy();
    expect(queryByText('noHoursLogged')).toBeNull();
  });

  it('says No hours logged for a past empty day', () => {
    const { getByText } = render(
      <TimeEntryDayRow
        date="2026-07-28"
        entries={[]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByText('noHoursLogged')).toBeTruthy();
  });
});

describe('TimeEntryDayRow — overnight next-day marker', () => {
  // Europe/London is BST (UTC+1) in August. An overnight shift filed under
  // 2026-08-01 that clocks out the next local evening must not read as a
  // backwards same-day range ("11:53 PM – 10:26 PM").
  it('marks a finish that falls on a later local date than the row', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T22:53:00.000Z', // 23:53 London
      clock_out_at: '2026-08-02T21:26:00.000Z', // 22:26 London next day
      local_date: '2026-08-01',
    });
    const { getByText } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByText(/nextDayMarker/)).toBeTruthy();
  });

  it('does not mark a same-local-date finish', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T09:58:00.000Z',
      local_date: '2026-08-01',
    });
    const { queryByText } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByText(/nextDayMarker/)).toBeNull();
  });
});

describe('TimeEntryDayRow — the first fragment of a split session (C6)', () => {
  // A session that crosses household-local Monday midnight is stored as two
  // rows. The first ends AT midnight and can be seconds long, and its
  // `updated_at` is the real clock-out hours later — neither is a fault, so
  // neither "check entry" nor "edited" belongs on it.
  const fragmentA = {
    clock_in_at: '2026-08-09T22:59:40.000Z', // Sun 23:59:40 London (BST)
    clock_out_at: '2026-08-09T23:00:00.000Z', // Mon 00:00 London
    updated_at: '2026-08-10T01:00:00.000Z', // she really stopped at 02:00
    local_date: '2026-08-09',
  };

  it('does not flag a 20-second first fragment as zero-duration', () => {
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-09"
        entries={[makeEntry(fragmentA)]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });

  it('does not mark it as edited', () => {
    const { queryByText } = render(
      <TimeEntryDayRow
        date="2026-08-09"
        entries={[makeEntry(fragmentA)]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByText(/edited/)).toBeNull();
  });

  it('still marks a genuinely corrected ordinary entry as edited', () => {
    const { getByText } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[
          makeEntry({
            clock_out_at: '2026-08-01T09:58:00.000Z',
            updated_at: '2026-08-02T09:12:00.000Z',
          }),
        ]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByText(/edited/)).toBeTruthy();
  });
});

describe('TimeEntryDayRow — a zero-paid cancellation fragment (C7)', () => {
  // The round-once rule can leave the last fragment of a cancelled window
  // with nothing left to pay. That is bookkeeping over a real hour, not an
  // accidental clock-in/out, and the parent must not be told to check it.
  it('does not flag a cancellation fragment whose residual came to 0', () => {
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[
          makeEntry({
            kind: 'cancellation_paid',
            clock_in_at: '2026-08-01T08:00:00.000Z',
            clock_out_at: '2026-08-01T09:00:00.000Z',
            scheduled_minutes: 0,
          }),
        ]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });
});
