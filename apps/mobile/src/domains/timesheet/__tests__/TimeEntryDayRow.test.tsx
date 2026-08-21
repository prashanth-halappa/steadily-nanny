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
let CHEVRON_SLOT: number;

beforeAll(async () => {
  TimeEntryDayRow = (await import('../components/TimeEntryDayRow'))
    .TimeEntryDayRow;
  CHEVRON_SLOT = (await import('../components/TimeEntryRow')).CHEVRON_SLOT;
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

  it('a voided entry with no finish never reads "in progress" — it did not happen', () => {
    // `voidById` sets only `status`, deliberately: inventing a finish time the
    // carer never gave would be a lie on the shared record. So a discarded
    // clock-in keeps `clock_out_at === null`, and the row must not render
    // "9:58 PM - in progress - voided", which claims both at once.
    const entry = makeEntry({
      id: 'discarded-running',
      status: 'voided',
      clock_out_at: null,
    });
    const { getByTestId, queryByText } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(getByTestId(`hours-voided-entry-${entry.id}`)).toBeTruthy();
    expect(queryByText(/inProgress/)).toBeNull();
    expect(queryByText(/–/)).toBeNull();
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
    expect(
      within(getByTestId('hours-day-row')).getByTestId('hours-day-total').props
        .children
    ).toBe('2h');
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

    expect(getByText('editedMarker')).toBeTruthy();
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

    expect(queryByText('editedMarker')).toBeNull();
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

    expect(getByText('editedMarker')).toBeTruthy();
  });
});

describe('TimeEntryDayRow — header alignment', () => {
  it('places day total as the last child of the header row', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    const header = getByTestId('hours-day-header');
    const childArray = Array.isArray(header.props.children)
      ? header.props.children
      : [header.props.children];
    // The last child is the right-hand group (day total + reserved chevron
    // slot). What matters is that the total is the final thing in the row —
    // the AlertDialog used to sit here as a third flex child, which parked
    // the total in the MIDDLE slot and made the whole column ragged.
    const lastChild = childArray[childArray.length - 1];
    const groupChildren = Array.isArray(lastChild.props.children)
      ? lastChild.props.children
      : [lastChild.props.children];
    expect(
      groupChildren.some(
        (child: { props?: { testID?: string } }) =>
          child?.props?.testID === 'hours-day-total'
      )
    ).toBe(true);
    expect(
      childArray.some(
        (child: { type?: string }) => child?.type === 'AlertDialog'
      )
    ).toBe(false);
  });

  it('gives the label side flex-1 and the total flex-shrink-0', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    const header = getByTestId('hours-day-header');
    const childArray = Array.isArray(header.props.children)
      ? header.props.children
      : [header.props.children];
    const labelSide = childArray[0];
    const total = childArray[childArray.length - 1];
    expect(labelSide.props.className).toContain('flex-1');
    expect(total.props.className).toContain('flex-shrink-0');
  });

  // The FlashList already supplies 22px via SCREEN_CONTENT_STYLE. Adding
  // more here inset the entry cards 22px further than the WeekTotal card
  // above them (cards at 44..396 against the week card's 22..418), which is
  // exactly the misalignment this component is supposed to be fixing.
  it('adds no horizontal padding of its own, so entry cards share the week card edges', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    const className = getByTestId('hours-day-row').props.className;
    expect(className).not.toMatch(/\bp[xlr]?-/);
  });

  it('reserves the chevron column so the day total shares the duration column', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    // The header mirrors the entry line's right-hand group by CONSTRUCTION:
    // figure, 8px gap, then the same reserved `CHEVRON_SLOT` spacer the line
    // uses. The old hand-computed `pr-3` was the arithmetic this replaces.
    const header = getByTestId('hours-day-header');
    const childArray = [header.props.children].flat();
    const rightGroup = childArray[childArray.length - 1];
    const spacer = [rightGroup.props.children].flat().at(-1);
    expect(spacer.props.style.width).toBe(CHEVRON_SLOT);
  });

  it('empty day has no entry cards', () => {
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-07"
        entries={[]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByTestId('hours-day-header')).toBeNull();
    expect(queryByTestId(/hours-edit-entry/)).toBeNull();
  });
});

describe('TimeEntryDayRow — the row owns the ground', () => {
  /** The single elevated container inside the row's outer spacing wrapper. */
  function rowSurface(outer: { props: { [key: string]: unknown } }) {
    return [outer.props.children].flat()[0] as {
      props: { className: string; style: Record<string, unknown>[] };
    };
  }

  it('is a 56pt card-ground ledger row — the entries inside it are lines', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    const surface = rowSurface(getByTestId('hours-day-row'));
    expect(surface.props.className).toContain('rounded-row');
    expect(surface.props.className).toContain('bg-card');
    expect(
      surface.props.style
        .flat()
        .some((s: { minHeight?: number }) => s?.minHeight === 56)
    ).toBe(true);
  });

  it('a running day takes the live ground and a live dot instead of the flat row', () => {
    const entry = makeEntry({
      id: 'running',
      clock_in_at: new Date(NOW_MS - 60 * 60 * 1000).toISOString(),
      clock_out_at: null,
      status: 'running',
    });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    expect(getByTestId('hours-day-live')).toBeTruthy();
    const surface = rowSurface(getByTestId('hours-day-row'));
    // Apricot is applied INSTEAD of `bg-card`, never on top of it.
    expect(surface.props.className).not.toContain('bg-card');
    expect(
      surface.props.style
        .flat()
        .some((s: { backgroundColor?: string }) => !!s?.backgroundColor)
    ).toBe(true);
  });

  it('shows no live dot on a day whose entries are all finished', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );

    expect(queryByTestId('hours-day-live')).toBeNull();
  });
});

describe('TimeEntryDayRow — per-entry durations only on a multi-entry day', () => {
  it('omits the entry duration on a single-entry day — the day total IS it', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { getByTestId, queryByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[entry]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    expect(queryByTestId(`hours-entry-duration-${entry.id}`)).toBeNull();
    expect(
      within(getByTestId('hours-day-row')).getByTestId('hours-day-total').props
        .children
    ).toBe('2h');
  });

  it('shows each entry duration once the day has more than one', () => {
    const morning = makeEntry({
      id: 'morning',
      clock_in_at: '2026-08-01T07:00:00.000Z',
      clock_out_at: '2026-08-01T09:00:00.000Z',
    });
    const afternoon = makeEntry({
      id: 'afternoon',
      clock_in_at: '2026-08-01T13:00:00.000Z',
      clock_out_at: '2026-08-01T14:00:00.000Z',
    });
    const { getByTestId } = render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={[morning, afternoon]}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        testID="hours-day-row"
      />
    );

    expect(getByTestId('hours-entry-duration-morning').props.children).toBe(
      '2h'
    );
    expect(getByTestId('hours-entry-duration-afternoon').props.children).toBe(
      '1h'
    );
    expect(
      within(getByTestId('hours-day-row')).getByTestId('hours-day-total').props
        .children
    ).toBe('3h');
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

/**
 * A5 — a day with seven punches, five of them under three minutes, was the
 * first thing between a reader and everything below it. The block is the
 * record and stays reachable; it stops being the toll.
 *
 * Two rules the collapse must never break: a RUNNING day is never behind a
 * tap, and nothing two parties could argue about is hidden — the voided and
 * edited counts are promoted INTO the summary rather than concealed by it.
 */
describe('TimeEntryDayRow — the busy day collapses', () => {
  function makeBusyDay(): TimeEntry[] {
    return [
      makeEntry({ id: 'e1', clock_out_at: '2026-08-01T09:58:00.000Z' }),
      makeEntry({ id: 'e2', clock_out_at: '2026-08-01T10:58:00.000Z' }),
      makeEntry({ id: 'e3', clock_out_at: '2026-08-01T11:58:00.000Z' }),
    ];
  }

  function renderDay(entries: TimeEntry[]) {
    return render(
      <TimeEntryDayRow
        date="2026-08-01"
        entries={entries}
        nowMs={NOW_MS}
        timeZone="Europe/London"
      />
    );
  }

  it('collapses a day of more than two entries, keeping the day total in view', () => {
    const { getByTestId, queryByTestId } = renderDay(makeBusyDay());

    expect(getByTestId('hours-day-summary')).toBeTruthy();
    expect(getByTestId('hours-day-total')).toBeTruthy();
    expect(queryByTestId('hours-entry-row-e1')).toBeNull();
    expect(queryByTestId('hours-entry-row-e3')).toBeNull();
  });

  it('opens on a tap of the day header, and the header says it is a button', () => {
    const { getByTestId, queryByTestId } = renderDay(makeBusyDay());

    const header = getByTestId('hours-day-header');
    expect(header.props.accessibilityRole).toBe('button');
    expect(header.props.accessibilityState).toEqual({ expanded: false });

    fireEvent.press(header);

    expect(getByTestId('hours-entry-row-e1')).toBeTruthy();
    expect(getByTestId('hours-entry-row-e3')).toBeTruthy();
    expect(queryByTestId('hours-day-summary')).toBeNull();
    expect(getByTestId('hours-day-header').props.accessibilityState).toEqual({
      expanded: true,
    });
  });

  it('never hides a running entry behind a tap', () => {
    const running = makeBusyDay().concat(
      makeEntry({ id: 'e4', clock_out_at: null, status: 'running' })
    );
    const { getByTestId, queryByTestId } = renderDay(running);

    expect(queryByTestId('hours-day-summary')).toBeNull();
    expect(queryByTestId('hours-day-chevron')).toBeNull();
    expect(getByTestId('hours-entry-row-e4')).toBeTruthy();
    expect(getByTestId('hours-day-header').props.accessibilityRole).toBe(
      undefined
    );
  });

  it('leaves one- and two-entry days exactly as they were', () => {
    const { getByTestId, queryByTestId } = renderDay(makeBusyDay().slice(0, 2));

    expect(queryByTestId('hours-day-summary')).toBeNull();
    expect(queryByTestId('hours-day-chevron')).toBeNull();
    expect(getByTestId('hours-entry-row-e1')).toBeTruthy();
    expect(getByTestId('hours-entry-row-e2')).toBeTruthy();
  });

  // The two facts a collapse could otherwise bury. A voided entry is money
  // NOT counted and an edited one is a record that moved — both are exactly
  // what a disagreement is about.
  it('promotes the voided and edited counts into the collapsed summary', () => {
    const entries = [
      ...makeBusyDay(),
      makeEntry({
        id: 'e4',
        clock_out_at: '2026-08-01T12:58:00.000Z',
        status: 'voided',
      }),
      makeEntry({
        id: 'e5',
        clock_out_at: '2026-08-01T13:58:00.000Z',
        // Corrected a day later — `wasEntryEdited`'s slack is one minute.
        updated_at: '2026-08-02T09:00:00.000Z',
      }),
    ];
    const { getByTestId } = renderDay(entries);

    const summary = getByTestId('hours-day-summary').props.children;
    expect(summary).toBe(
      'daySummaryEntries · daySummaryVoided · daySummaryEdited'
    );
  });

  it('says only the entry count when nothing was voided or edited', () => {
    const { getByTestId } = renderDay(makeBusyDay());

    expect(getByTestId('hours-day-summary').props.children).toBe(
      'daySummaryEntries'
    );
  });

  // The reserved slot is why the total column does not shift between a
  // collapsible day and a plain one — the chevron goes IN it, not beside it.
  it('keeps the total column in place by putting the chevron in the reserved slot', () => {
    const collapsible = renderDay(makeBusyDay());
    const plain = renderDay(makeBusyDay().slice(0, 1));

    const slotWidth = (view: ReturnType<typeof renderDay>) => {
      const header = view.getByTestId('hours-day-header');
      const children = Array.isArray(header.props.children)
        ? header.props.children
        : [header.props.children];
      const group = children[children.length - 1];
      const groupChildren = Array.isArray(group.props.children)
        ? group.props.children
        : [group.props.children];
      return groupChildren[groupChildren.length - 1].props.style.width;
    };

    expect(slotWidth(collapsible)).toBe(CHEVRON_SLOT);
    expect(slotWidth(collapsible)).toBe(slotWidth(plain));
    expect(collapsible.getByTestId('hours-day-chevron')).toBeTruthy();
  });
});
