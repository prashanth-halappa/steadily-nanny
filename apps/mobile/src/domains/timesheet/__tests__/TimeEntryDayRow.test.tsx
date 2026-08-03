/**
 * @module domains/timesheet/__tests__/TimeEntryDayRow.test
 *
 * Mock-rendering test (Pattern B, docs/09-TESTING.md §5) — covers the
 * zero-duration flag: a FINISHED entry (clock_out_at set) that computes to
 * 0 minutes must render distinctly, not blend in as a plausible short
 * shift. A still-running entry with 0 elapsed so far must NOT be flagged.
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render } from '@testing-library/react-native';
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
