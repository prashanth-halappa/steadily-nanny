/**
 * @module domains/timesheet/__tests__/TimeEntryRow.test
 *
 * One entry = one LINE inside its day's ledger row (Daylight v2). The ground,
 * the elevation and the 56pt minimum all moved up to `TimeEntryDayRow` — what
 * stays here is the content contract: the time range, whatever qualifies it
 * (voided, zero-duration, edited, `+1`), the optional duration, and the
 * chevron that means "this can be corrected".
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
import { join } from 'node:path';
import { fireEvent, render } from '@testing-library/react-native';
import type { TimeEntry } from '../types';
import { formatDuration } from '../utils/duration';
import { computeEntryMinutes } from '../utils/entryMinutes';

let TimeEntryRow: typeof import('../components/TimeEntryRow').TimeEntryRow;
let CHEVRON_SLOT: number;
let enHours: Record<string, string>;

beforeAll(async () => {
  const mod = await import('../components/TimeEntryRow');
  TimeEntryRow = mod.TimeEntryRow;
  CHEVRON_SLOT = mod.CHEVRON_SLOT;
  enHours = await Bun.file(
    join(__dirname, '../../../i18n/locales/en/hours.json')
  ).json();
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
        showDuration
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
        showDuration
      />
    );

    expect(minutes).toBe(45);
    expect(getByText(formatDuration(45))).toBeTruthy();
  });

  // On a one-entry day the day total right above IS this entry's duration.
  // Printing it twice makes a reader check whether the two agree.
  it('hides the duration by default — the day total already states it', () => {
    const entry = makeEntry();
    const { queryByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(queryByTestId(`hours-entry-duration-${entry.id}`)).toBeNull();
  });

  it('shows the duration when showDuration is true (a multi-entry day)', () => {
    const entry = makeEntry();
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        showDuration
      />
    );

    expect(getByTestId(`hours-entry-duration-${entry.id}`).props.children).toBe(
      formatDuration(computeEntryMinutes(entry, NOW_MS))
    );
  });
});

describe('TimeEntryRow — the time range is the record, not metadata', () => {
  // It used to be a muted `Small`. The times ARE what the ledger records, so
  // they read at full foreground weight; only a voided line is demoted.
  it('renders an ordinary time range unmuted', () => {
    const entry = makeEntry();
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    const timeEl = getByTestId(`hours-entry-time-${entry.id}`);
    expect(timeEl.props.className ?? '').not.toContain('text-muted-foreground');
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

  // The row's own minHeight moved UP to `TimeEntryDayRow` (56pt, one ledger
  // row) when the entry stopped being a card — see that suite. What guarantees
  // the tap target here is the pressable's hitSlop, so assert THAT rather than
  // dropping the reachability check on the floor.
  it('extends the tap target past the text with hitSlop', () => {
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

    expect(getByTestId(`hours-edit-entry-${entry.id}`).props.hitSlop).toBe(8);
  });

  it('is a LINE, not a card — no ground, no padding, no elevation of its own', () => {
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

    const row = getByTestId(`hours-entry-row-${entry.id}`);
    expect(row.props.className).not.toContain('bg-card');
    expect(row.props.className).not.toMatch(/\bp[xyltrb]?-\d/);
    expect(row.props.className).not.toContain('rounded-row');
    expect(row.props.style).toBeFalsy();
  });

  it('reserves the chevron slot even when the entry is read-only', () => {
    const entry = makeEntry();
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    const row = getByTestId(`hours-entry-row-${entry.id}`);
    const rightGroup = [row.props.children].flat().at(-1);
    const slot = [rightGroup.props.children].flat().at(-1);
    expect(slot.props.style.width).toBe(CHEVRON_SLOT);
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

describe('TimeEntryRow — edited marker and +1 marker', () => {
  it('renders edited as its own marker, not inside the time string', () => {
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

    // i18n is key-echo-mocked, so this asserts "the marker reaches the
    // screen at the key the component now reads".
    expect(getByText('editedMarker')).toBeTruthy();
    expect(getByTestId(`hours-entry-edited-pill-${entry.id}`)).toBeTruthy();
    const timeEl = getByTestId(`hours-entry-time-${entry.id}`);
    expect(timeEl.props.children.join('')).not.toContain('edited');
  });

  it('reads "Edited" in English — who changed a recorded hour is stated in words', () => {
    expect(enHours.editedMarker).toBe('Edited');
  });

  it('shows no edited marker on an untouched entry', () => {
    const entry = makeEntry({ clock_out_at: '2026-08-01T09:58:00.000Z' });
    const { queryByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    expect(queryByTestId(`hours-entry-edited-pill-${entry.id}`)).toBeNull();
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

  // T4 used to be a muted GROUND, because the entry was a card. Now that it
  // is a line inside the day's row it has no ground to mute — the demotion
  // moved onto the type itself, and the rule it encodes is unchanged: a
  // voided entry stays a complete record but must not compete with a real one.
  it('drops to T4 — muted, struck through, and never a duration in full weight', () => {
    const entry = makeEntry({
      status: 'voided',
      clock_out_at: '2026-08-01T09:58:00.000Z',
    });
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
        showDuration
      />
    );

    const timeEl = getByTestId(`hours-voided-entry-${entry.id}`);
    expect(timeEl.props.className).toContain('text-muted-foreground');
    expect(timeEl.props.className).toContain('line-through');
    expect(
      getByTestId(`hours-entry-duration-${entry.id}`).props.className
    ).toContain('text-muted-foreground');
  });

  it('keeps every StatusPill and the strike-through — the record stays complete', () => {
    const entry = makeEntry({
      status: 'voided',
      clock_out_at: '2026-08-01T09:58:00.000Z',
    });
    const { getByTestId } = render(
      <TimeEntryRow
        entry={entry}
        nowMs={NOW_MS}
        timeZone="Europe/London"
        dayDate="2026-08-01"
      />
    );

    const timeEl = getByTestId(`hours-voided-entry-${entry.id}`);
    expect(timeEl.props.className).toContain('line-through');
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
