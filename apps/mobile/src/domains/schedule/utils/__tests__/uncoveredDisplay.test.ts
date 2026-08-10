/**
 * @module domains/schedule/utils/__tests__/uncoveredDisplay.test
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import { inferUncoveredCause } from '../uncoveredDisplay';

const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeWindow(startsAt: string, endsAt: string): UncoveredWindow {
  return {
    childId: CHILD,
    commitmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    startsAt,
    endsAt,
  };
}

function makeShift(status: Shift['status']): Shift {
  return {
    id: 'ssssssss-ssss-ssss-ssss-ssssssssssss',
    household_id: 'hhhhhhhh-hhhh-hhhh-hhhh-hhhhhhhhhhhh',
    carer_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    created_by: 'pppppppp-pppp-pppp-pppp-pppppppppppp',
    kind: 'recurring',
    status,
    origin: 'system_generated',
    starts_at: '2026-03-23T09:00:00.000Z',
    ends_at: '2026-03-23T17:00:00.000Z',
    timezone: 'UTC',
    local_date: '2026-03-23',
    is_short_notice: false,
    source_pattern_id: null,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'shift@test',
    sequence: 0,
    shift_children: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  } as Shift;
}

describe('inferUncoveredCause', () => {
  const window = makeWindow(
    '2026-03-23T10:00:00.000Z',
    '2026-03-23T12:00:00.000Z'
  );

  it('prefers cancelled over declined when both overlap', () => {
    expect(
      inferUncoveredCause(window, [
        makeShift('cancelled'),
        makeShift('declined'),
      ])
    ).toBe('cancelled');
  });

  it('returns declined when a declined shift overlaps', () => {
    expect(inferUncoveredCause(window, [makeShift('declined')])).toBe(
      'declined'
    );
  });

  it('defaults to nothingScheduled when no overlapping non-covering shift', () => {
    expect(inferUncoveredCause(window, [makeShift('confirmed')])).toBe(
      'nothingScheduled'
    );
    expect(inferUncoveredCause(window, [])).toBe('nothingScheduled');
  });
});
