/**
 * @module domains/schedule/utils/__tests__/uncoveredDisplay.causeNamed.test
 */
import { describe, expect, it } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { UncoveredWindow } from '@steadily-nanny/shared-types/uncoveredCare';
import {
  describeUncoveredCause,
  inferUncoveredCause,
  inferUncoveredCauseDetail,
} from '../uncoveredDisplay';

const CHILD = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function makeWindow(startsAt: string, endsAt: string): UncoveredWindow {
  return {
    childId: CHILD,
    commitmentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    startsAt,
    endsAt,
  };
}

function makeShift(
  status: Shift['status'],
  overrides: Partial<Shift> = {}
): Shift {
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
    ...overrides,
  } as Shift;
}

const templates = {
  'cover.cause.cancelled': 'A shift was cancelled',
  'cover.cause.declined': 'A shift was declined',
  'cover.causeNamed.cancelled':
    "{{carerName}}'s {{start}} – {{end}} shift was cancelled",
  'cover.causeNamed.declined': '{{carerName}} turned down {{start}} – {{end}}',
} as const;

function scheduleT(key: string, vars?: Record<string, unknown>): string {
  const template = templates[key as keyof typeof templates];
  if (!template) return key;
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(vars[name] ?? `{{${name}}}`)
  );
}

describe('inferUncoveredCauseDetail', () => {
  const window = makeWindow(
    '2026-03-23T10:00:00.000Z',
    '2026-03-23T12:00:00.000Z'
  );

  it('returns the overlapping cancelled shift', () => {
    const shift = makeShift('cancelled');
    const detail = inferUncoveredCauseDetail(window, [shift]);
    expect(detail.cause).toBe('cancelled');
    expect(detail.shift).toBe(shift);
    expect(inferUncoveredCause(window, [shift])).toBe('cancelled');
  });
});

describe('describeUncoveredCause', () => {
  it('names the carer for a cancelled shift when carerName resolves', () => {
    const text = describeUncoveredCause({
      cause: 'cancelled',
      shift: makeShift('cancelled'),
      carerName: 'Maria',
      timeZone: 'UTC',
      t: scheduleT,
    });
    // The SHIFT's own hours (09:00–17:00Z), not the gap window's — the
    // sentence says "shift", so describing a 9–5 shift as a "9:00–11:22 shift"
    // because that is where cover happened to fail would be a fresh small lie.
    expect(text).toBe("Maria's 9:00 AM – 5:00 PM shift was cancelled");
    expect(text).not.toContain('{{');
  });

  it('falls back to generic copy when carerName is null', () => {
    const text = describeUncoveredCause({
      cause: 'cancelled',
      shift: makeShift('cancelled'),
      carerName: null,
      timeZone: 'UTC',
      t: scheduleT,
    });
    expect(text).toBe('A shift was cancelled');
    expect(text).not.toContain('undefined');
  });
});
