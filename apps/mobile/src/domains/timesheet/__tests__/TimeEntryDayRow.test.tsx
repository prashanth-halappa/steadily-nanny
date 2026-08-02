/**
 * @module domains/timesheet/__tests__/TimeEntryDayRow.test
 *
 * Mock-rendering test (Pattern B, docs/09-TESTING.md §5) — covers the
 * zero-duration flag: a FINISHED entry (clock_out_at set) that computes to
 * 0 minutes must render distinctly, not blend in as a plausible short
 * shift. A still-running entry with 0 elapsed so far must NOT be flagged.
 */
import { beforeAll, describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react-native';
import type { TimeEntry } from '../types';

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
      <TimeEntryDayRow date="2026-08-01" entries={[entry]} nowMs={NOW_MS} />
    );

    expect(getByTestId('hours-zero-duration-flag')).toBeTruthy();
  });

  it('does NOT flag a still-running entry with 0 elapsed so far', () => {
    const entry = makeEntry({
      clock_in_at: new Date(NOW_MS).toISOString(),
      clock_out_at: null,
      status: 'running',
    });
    const { queryByTestId } = render(
      <TimeEntryDayRow date="2026-08-01" entries={[entry]} nowMs={NOW_MS} />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });

  it('does NOT flag a normal finished entry with real minutes', () => {
    const entry = makeEntry({
      clock_in_at: '2026-08-01T07:58:00.000Z',
      clock_out_at: '2026-08-01T09:58:00.000Z',
    });
    const { queryByTestId } = render(
      <TimeEntryDayRow date="2026-08-01" entries={[entry]} nowMs={NOW_MS} />
    );

    expect(queryByTestId('hours-zero-duration-flag')).toBeNull();
  });
});
