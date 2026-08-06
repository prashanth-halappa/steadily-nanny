/**
 * The minutes formula, pinned. `sumWorkedMinutes` is what `total_minutes`
 * is derived from, and `weekEarningsService` prices the same entries with
 * the same rule — so the branch that makes `scheduled_minutes` authoritative
 * for `cancellation_paid` is tested on both sides (the mirror lives in
 * `weekEarningsService.test.ts`).
 */
import { describe, expect, it } from 'bun:test';
import type { TimeEntry } from '@steadily-nanny/shared-types/schemas/timesheet.schema';
import {
  CANCELLATION_VECTORS,
  MINUTE_VECTORS,
} from '@steadily-nanny/shared-types/testVectors/minuteVectors';
import {
  computeWorkedMinutes,
  entryMinutes,
  sumWorkedMinutes,
} from '../../../../../src/domains/timesheet/utils/workedMinutes';

function entry(over: Record<string, unknown> = {}): TimeEntry {
  return {
    id: 'te1',
    household_id: 'h1',
    carer_id: 'carer-1',
    carer_display_name: 'Nia Rowe',
    shift_id: null,
    clock_in_at: '2026-08-03T08:00:00.000Z',
    clock_out_at: '2026-08-03T16:00:00.000Z',
    break_minutes: 0,
    scheduled_minutes: null,
    kind: 'worked',
    note: null,
    clock_in_location_ok: null,
    clock_out_location_ok: null,
    status: 'submitted',
    local_date: '2026-08-03',
    timezone: 'Europe/London',
    created_at: 't',
    updated_at: 't',
    ...over,
  } as TimeEntry;
}

describe('computeWorkedMinutes', () => {
  it('rounds the span and subtracts the break', () => {
    expect(
      computeWorkedMinutes(
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T16:00:00.000Z',
        30
      )
    ).toBe(450);
  });

  it('never goes negative', () => {
    expect(
      computeWorkedMinutes(
        '2026-08-03T08:00:00.000Z',
        '2026-08-03T08:10:00.000Z',
        60
      )
    ).toBe(0);
  });
});

describe('sumWorkedMinutes', () => {
  it('sums the span-derived minutes of every finished worked entry', () => {
    expect(
      sumWorkedMinutes([
        entry({ clock_out_at: '2026-08-03T12:00:00.000Z' }),
        entry({
          id: 'te2',
          clock_in_at: '2026-08-04T09:00:00.000Z',
          clock_out_at: '2026-08-04T17:00:00.000Z',
          break_minutes: 30,
        }),
      ])
    ).toBe(240 + 450);
  });

  it('skips a running entry rather than throwing', () => {
    expect(sumWorkedMinutes([entry({ clock_out_at: null })])).toBe(0);
  });
});

describe('sumWorkedMinutes — cancellation pay is scheduled_minutes-authoritative (C7)', () => {
  it('banks the fragment residual, not its own re-rounded span', () => {
    // The residual case the C7 round-once rule produces: this fragment's span
    // rounds to 420 on its own, but the window it belongs to only has 419
    // minutes left to give. The stored figure is the one that must be paid.
    const fragment = entry({
      kind: 'cancellation_paid',
      clock_in_at: '2026-08-03T12:00:40.000Z',
      clock_out_at: '2026-08-03T19:00:20.000Z', // 419m40s -> rounds to 420
      scheduled_minutes: 419,
    });

    expect(sumWorkedMinutes([fragment])).toBe(419);
  });

  it('never banks a negative, even if a stored figure went bad', () => {
    // `computeWorkedMinutes` floors at zero, so every OTHER path is
    // non-negative by construction. Reading the column raw made that a
    // convention rather than a guarantee, and a negative here subtracts from
    // the rest of the week's pay.
    expect(
      sumWorkedMinutes([
        entry({ kind: 'cancellation_paid', scheduled_minutes: -30 }),
      ])
    ).toBe(0);
  });

  it('falls back to the span for a legacy fragment with no stored minutes', () => {
    const legacy = entry({
      kind: 'cancellation_paid',
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T15:00:00.000Z',
      scheduled_minutes: null,
    });

    expect(sumWorkedMinutes([legacy])).toBe(420);
  });

  it('ignores scheduled_minutes entirely for worked and manual_adjustment kinds', () => {
    // A worked entry's `scheduled_minutes` is the SHIFT's booking frozen at
    // clock-out — what she was rostered for, not what she did. Reading it as
    // pay would bill the roster instead of the clock.
    const worked = entry({
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T12:00:00.000Z',
      scheduled_minutes: 480,
    });
    const adjustment = entry({
      id: 'te3',
      kind: 'manual_adjustment',
      clock_in_at: '2026-08-04T08:00:00.000Z',
      clock_out_at: '2026-08-04T09:00:00.000Z',
      scheduled_minutes: 480,
    });

    expect(sumWorkedMinutes([worked, adjustment])).toBe(240 + 60);
  });

  it('still subtracts a break on a legacy fragment (span fallback is unchanged)', () => {
    const legacy = entry({
      kind: 'cancellation_paid',
      clock_in_at: '2026-08-03T08:00:00.000Z',
      clock_out_at: '2026-08-03T09:00:00.000Z',
      break_minutes: 10,
      scheduled_minutes: null,
    });

    expect(sumWorkedMinutes([legacy])).toBe(50);
  });
});

// Shared with apps/mobile/src/domains/timesheet/__tests__/entryMinutes.test.ts
// (I-11): these vectors pin the exact numbers both sides must agree on.
describe('computeWorkedMinutes — shared golden vectors (I-11)', () => {
  for (const vector of MINUTE_VECTORS) {
    it(vector.name, () => {
      expect(
        computeWorkedMinutes(
          vector.clock_in_at,
          vector.clock_out_at,
          vector.break_minutes
        )
      ).toBe(vector.expected);
    });
  }
});

describe('entryMinutes — shared cancellation golden vectors (I-11)', () => {
  for (const vector of CANCELLATION_VECTORS) {
    it(vector.name, () => {
      const fragment = entry({
        kind: 'cancellation_paid',
        clock_in_at: vector.clock_in_at,
        clock_out_at: vector.clock_out_at,
        scheduled_minutes: vector.scheduled_minutes,
      });
      expect(entryMinutes(fragment)).toBe(vector.expected);
    });
  }
});
