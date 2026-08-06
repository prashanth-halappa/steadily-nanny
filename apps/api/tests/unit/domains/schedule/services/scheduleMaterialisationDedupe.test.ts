/**
 * Migration 062's duplicate-recurring-window guard, from the app side:
 * adopt-on-23505 when the index refuses an insert, and the shared
 * "this pattern has ended, withdraw its future shifts" cleanup every
 * end-a-pattern path routes through.
 *
 * Constructor-injected fakes, never `mock.module()` — same style as
 * `scheduleMaterialisationService.test.ts`.
 *
 * @module tests/unit/domains/schedule/services/scheduleMaterialisationDedupe
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import { RecurringShiftAlreadyExistsError } from '../../../../../src/domains/schedule/errors/scheduleErrors';
import type { ExpandedOccurrence } from '../../../../../src/domains/schedule/services/recurrenceExpander';
import type {
  ConflictEventRepository,
  MaterialisationShiftRepository,
  PatternForMaterialisation,
  TimeEntryExistenceRepository,
} from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { ScheduleMaterialisationService } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';

const NOW = new Date('2026-06-01T00:00:00.000Z');

const pattern: PatternForMaterialisation = {
  id: 'pattern-1',
  householdId: 'household-1',
  carerId: 'carer-1',
  timezone: 'Europe/London',
  icalUid: 'pattern-ical-uid',
  note: 'The usual week',
};

function occurrence(
  overrides: Partial<ExpandedOccurrence> = {}
): ExpandedOccurrence {
  return {
    localDate: '2026-06-04',
    weekday: 4,
    startsAt: '2026-06-04T07:00:00.000Z',
    endsAt: '2026-06-04T16:00:00.000Z',
    children: [],
    ...overrides,
  };
}

function baseShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    household_id: 'household-1',
    carer_id: 'carer-1',
    starts_at: '2026-06-04T07:00:00.000Z',
    ends_at: '2026-06-04T16:00:00.000Z',
    timezone: 'Europe/London',
    local_date: '2026-06-04',
    kind: 'recurring',
    status: 'confirmed',
    source_pattern_id: 'pattern-1',
    origin: 'system_generated',
    is_short_notice: false,
    note: null,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: 'pattern-ical-uid::2026-06-04',
    sequence: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeRepo(
  overrides: Partial<MaterialisationShiftRepository> = {}
): MaterialisationShiftRepository {
  return {
    findByPatternAndDate: mock(async () => null),
    findActiveByPattern: mock(async () => []),
    findRecurringInWindow: mock(async () => null),
    hasChangeRequests: mock(async () => false),
    create: mock(async () => baseShift()),
    update: mock(async () => baseShift()),
    delete: mock(async () => undefined),
    replaceChildren: mock(async () => undefined),
    ...overrides,
  };
}

function makeTimeEntryRepo(
  overrides: Partial<TimeEntryExistenceRepository> = {}
): TimeEntryExistenceRepository {
  return {
    hasTimeEntries: mock(async () => false),
    ...overrides,
  };
}

function makeEventRepo(): ConflictEventRepository {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async () => undefined),
  };
}

describe('ScheduleMaterialisationService — 062 duplicate-window collision', () => {
  it('adopts the existing identical shift when the unique index refuses the insert', async () => {
    const winner = baseShift({
      id: 'shift-from-other-pattern',
      source_pattern_id: 'pattern-other',
      ical_uid: 'other-pattern-uid::2026-06-04',
    });
    const repo = makeRepo({
      create: mock(async () => {
        throw new RecurringShiftAlreadyExistsError({
          householdId: 'household-1',
          startsAt: '2026-06-04T07:00:00.000Z',
          endsAt: '2026-06-04T16:00:00.000Z',
          carerId: 'carer-1',
        });
      }),
      findRecurringInWindow: mock(async () => winner),
      update: mock(async () => winner),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.findRecurringInWindow).toHaveBeenCalledWith(
      'household-1',
      'carer-1',
      '2026-06-04T07:00:00.000Z',
      '2026-06-04T16:00:00.000Z'
    );
    // Re-pointed at THIS pattern, so the next run finds it by pattern+date
    // instead of colliding again. `ical_uid` is deliberately left alone: it
    // is already the marker in somebody's device calendar (GOLDEN-FIXES #16).
    expect(repo.update).toHaveBeenCalledWith(
      'shift-from-other-pattern',
      expect.objectContaining({ source_pattern_id: 'pattern-1' })
    );
    const patch = (repo.update as ReturnType<typeof mock>).mock.calls[0]?.[1];
    expect(patch).not.toHaveProperty('ical_uid');
    expect(repo.replaceChildren).toHaveBeenCalledWith(
      'shift-from-other-pattern',
      []
    );
    expect(result.updated).toBe(1);
    expect(result.created).toBe(0);
  });

  it('rethrows when the index says a duplicate exists but no live row can be found', async () => {
    const repo = makeRepo({
      create: mock(async () => {
        throw new RecurringShiftAlreadyExistsError({
          householdId: 'household-1',
        });
      }),
      findRecurringInWindow: mock(async () => null),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    await expect(
      svc.materialise(pattern, [occurrence()], NOW)
    ).rejects.toBeInstanceOf(RecurringShiftAlreadyExistsError);
  });
});

describe('ScheduleMaterialisationService.cancelFutureShiftsForEndedPattern', () => {
  const future = (overrides: Partial<Shift> = {}) =>
    baseShift({
      id: 'shift-future',
      starts_at: '2026-07-02T07:00:00.000Z',
      ends_at: '2026-07-02T16:00:00.000Z',
      local_date: '2026-07-02',
      ...overrides,
    });

  it('cancels a future, untouched, system-generated shift', async () => {
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [future()]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const cancelled = await svc.cancelFutureShiftsForEndedPattern(
      'pattern-1',
      NOW
    );

    expect(cancelled).toBe(1);
    expect(repo.update).toHaveBeenCalledWith(
      'shift-future',
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_ended',
        cancelled_at: NOW.toISOString(),
      })
    );
  });

  it('never touches a shift that has already started', async () => {
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [
        future({ id: 'shift-past', starts_at: '2026-05-01T07:00:00.000Z' }),
      ]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    expect(await svc.cancelFutureShiftsForEndedPattern('pattern-1', NOW)).toBe(
      0
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('never touches a completed or already-cancelled shift', async () => {
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [
        future(),
        future({ id: 'shift-done', status: 'completed' }),
        future({ id: 'shift-gone', status: 'cancelled' }),
      ]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    expect(await svc.cancelFutureShiftsForEndedPattern('pattern-1', NOW)).toBe(
      1
    );
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(repo.update).toHaveBeenCalledWith(
      'shift-future',
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('never touches a shift somebody has clocked into', async () => {
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [future()]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo({ hasTimeEntries: mock(async () => true) }),
      makeEventRepo()
    );

    expect(await svc.cancelFutureShiftsForEndedPattern('pattern-1', NOW)).toBe(
      0
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('leaves a manually-authored shift alone — it is no longer the pattern to withdraw', async () => {
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [
        future({ id: 'shift-countered', origin: 'nanny_countered' }),
      ]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    expect(await svc.cancelFutureShiftsForEndedPattern('pattern-1', NOW)).toBe(
      0
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});
