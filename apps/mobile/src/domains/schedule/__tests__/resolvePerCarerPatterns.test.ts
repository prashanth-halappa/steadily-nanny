/**
 * @module domains/schedule/__tests__/resolvePerCarerPatterns.test
 *
 * S7/S8: `SchedulePendingScreen` used to take
 * `.find(p => p.status !== 'ended')` across the WHOLE household's patterns —
 * one row, order-dependent, speaking for every carer at once. This groups
 * by `carer_id` first and resolves each carer's OWN precedence
 * (`resolveActivePattern`), so a household with two nannies gets one
 * section per carer instead of one row that silently picks a side.
 */
import { describe, expect, it } from 'bun:test';
import type { SchedulePattern } from '@steadily-nanny/shared-types/schemas/schedule.schema';
import { resolvePerCarerPatterns } from '../utils/patternPrecedence';

function makePattern(
  overrides: Partial<SchedulePattern> & { status: string }
): SchedulePattern {
  return {
    id: `p-${Math.random()}`,
    household_id: '11111111-1111-4111-8111-111111111111',
    carer_id: null,
    rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO',
    dtstart: '2026-08-05',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_by: null,
    sent_at: null,
    responded_at: null,
    ical_uid: 'uid',
    sequence: 0,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as SchedulePattern;
}

const PRIYA = 'carer-priya';
const MAYA = 'carer-maya';

describe('resolvePerCarerPatterns', () => {
  it('returns nothing for an empty list', () => {
    expect(resolvePerCarerPatterns([])).toEqual([]);
  });

  it('one carer, one pattern: a single section', () => {
    const pending = makePattern({ status: 'pending', carer_id: PRIYA });
    expect(resolvePerCarerPatterns([pending])).toEqual([
      { carerId: PRIYA, pattern: pending },
    ]);
  });

  it('two carers: one section each, each resolved by ITS OWN precedence', () => {
    const priyaPending = makePattern({ status: 'pending', carer_id: PRIYA });
    const priyaWithdrawn = makePattern({
      status: 'withdrawn',
      carer_id: PRIYA,
      created_at: '2026-07-01T00:00:00.000Z',
    });
    const mayaAccepted = makePattern({ status: 'accepted', carer_id: MAYA });

    const sections = resolvePerCarerPatterns([
      priyaWithdrawn,
      mayaAccepted,
      priyaPending,
    ]);

    expect(sections).toHaveLength(2);
    const byCarer = new Map(sections.map(s => [s.carerId, s.pattern]));
    // Priya's stale withdrawn row must never outrank her live pending one —
    // the exact regression `resolveActivePattern` itself guards, now applied
    // per carer instead of across the whole household.
    expect(byCarer.get(PRIYA)?.status).toBe('pending');
    expect(byCarer.get(MAYA)?.status).toBe('accepted');
  });

  it('S9: a carer whose only pattern has ended still gets a section, not nothing', () => {
    const ended = makePattern({ status: 'ended', carer_id: PRIYA });
    expect(resolvePerCarerPatterns([ended])).toEqual([
      { carerId: PRIYA, pattern: ended },
    ]);
  });

  it('groups a carer-less draft under a null-carer section rather than dropping it', () => {
    const draft = makePattern({ status: 'draft', carer_id: null });
    expect(resolvePerCarerPatterns([draft])).toEqual([
      { carerId: null, pattern: draft },
    ]);
  });
});
