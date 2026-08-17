/**
 * S4a from the materialiser's side: migration 104's exclusion constraint can
 * now refuse an occurrence, and the nightly horizon job must not 500 because
 * of it.
 *
 * The rule this file pins is the one 062's adopt path already established and
 * this extends: a refused row is a CONFLICT to record, never a failed run.
 * A `pattern_conflict` day-thread row goes down (keyed, so re-expanding the
 * same pattern every night cannot grow the table without bound) and the rest
 * of the horizon is materialised as normal.
 *
 * Note the difference from 062: a duplicate is ADOPTED, because the existing
 * row IS this occurrence. An overlap cannot be adopted — the existing row is
 * a DIFFERENT booking that happens to collide — so there is no shift of ours
 * to point the conflict at, and both the event's `shift_id` and the result's
 * `shiftId` are null.
 *
 * Constructor-injected fakes, never `mock.module()` — same style as
 * `scheduleMaterialisationDedupe.test.ts`.
 *
 * @module tests/unit/domains/schedule/services/scheduleMaterialisationOverlap
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type { NewShiftData } from '../../../../../src/domains/schedule/repositories/scheduleShiftRepository';
import type { ExpandedOccurrence } from '../../../../../src/domains/schedule/services/recurrenceExpander';
import type {
  ConflictEventRepository,
  MaterialisationShiftRepository,
  PatternForMaterialisation,
  TimeEntryExistenceRepository,
} from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { ScheduleMaterialisationService } from '../../../../../src/domains/schedule/services/scheduleMaterialisationService';
import { ShiftOverlapsError } from '../../../../../src/domains/shift/errors/shiftErrors';

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
    startTime: '07:00:00',
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
    findActiveByPattern: mock(async () => []),
    findRecurringInWindow: mock(async () => null),
    shiftIdsWithChangeRequests: mock(async () => new Set<string>()),
    create: mock(async () => baseShift()),
    update: mock(async () => baseShift()),
    createMany: mock(async (rows: NewShiftData[]) =>
      rows.map((row, index) =>
        baseShift({ id: `shift-${index + 1}`, ical_uid: row.ical_uid })
      )
    ),
    updateMany: mock(async () => undefined),
    deleteMany: mock(async () => undefined),
    replaceChildrenMany: mock(async () => undefined),
    ...overrides,
  };
}

function makeTimeEntryRepo(): TimeEntryExistenceRepository {
  return { shiftIdsWithTimeEntries: mock(async () => new Set<string>()) };
}

function makeEventRepo(): ConflictEventRepository {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async () => undefined),
  };
}

const overlap = () =>
  new ShiftOverlapsError({
    householdId: 'household-1',
    carerId: 'carer-1',
    startsAt: '2026-06-04T07:00:00.000Z',
    endsAt: '2026-06-04T16:00:00.000Z',
  });

describe('ScheduleMaterialisationService — 104 overlap on CREATE', () => {
  it('records a conflict and keeps going instead of failing the run', async () => {
    const day2 = occurrence({
      localDate: '2026-06-05',
      startsAt: '2026-06-05T07:00:00.000Z',
      endsAt: '2026-06-05T16:00:00.000Z',
    });
    let call = 0;
    const repo = makeRepo({
      createMany: mock(async () => null),
      create: mock(async () => {
        call += 1;
        if (call === 1) {
          throw overlap();
        }
        return baseShift({ id: 'shift-day2', local_date: '2026-06-05' });
      }),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    const result = await svc.materialise(pattern, [occurrence(), day2], NOW);

    // The second occurrence still landed — one collision does not abort a horizon.
    expect(result.created).toBe(1);
    expect(result.conflicts).toEqual([
      {
        shiftId: null,
        localDate: '2026-06-04',
        reason: 'overlaps_existing_shift',
      },
    ]);
  });

  it('appends a keyed pattern_conflict row with a NULL shift_id', async () => {
    const repo = makeRepo({
      createMany: mock(async () => null),
      create: mock(async () => {
        throw overlap();
      }),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    await svc.materialise(pattern, [occurrence()], NOW);

    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      {
        household_id: 'household-1',
        // No shift of OURS exists — the insert is what was refused.
        shift_id: null,
        local_date: '2026-06-04',
        actor_id: null,
        event_type: 'pattern_conflict',
        payload: {
          key: 'pattern-1|overlap|2026-06-04',
          pattern_id: 'pattern-1',
          shift_origin: null,
          reason: 'overlaps a shift already on the calendar',
        },
      },
    ]);
  });

  it('does not re-raise the same conflict on the next run (keyed dedupe)', async () => {
    const repo = makeRepo({
      createMany: mock(async () => null),
      create: mock(async () => {
        throw overlap();
      }),
    });
    const eventRepo: ConflictEventRepository = {
      listEventKeysForDate: mock(
        async () => new Set(['pattern-1|overlap|2026-06-04'])
      ),
      insertMany: mock(async () => undefined),
    };
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    await svc.materialise(pattern, [occurrence()], NOW);

    expect(eventRepo.insertMany).not.toHaveBeenCalled();
  });
});

describe('ScheduleMaterialisationService — 104 overlap on UPDATE', () => {
  it('records a conflict when re-timing an occurrence collides, and keeps going', async () => {
    // An existing shift for this pattern+date whose times have MOVED, so
    // `applyUpdates` tries to rewrite it onto a window that is now taken.
    const existing = baseShift({
      starts_at: '2026-06-04T06:00:00.000Z',
      ends_at: '2026-06-04T15:00:00.000Z',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
      update: mock(async () => {
        throw overlap();
      }),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(result.updated).toBe(0);
    expect(result.conflicts).toEqual([
      {
        shiftId: 'shift-1',
        localDate: '2026-06-04',
        reason: 'overlaps_existing_shift',
      },
    ]);
    // Here we DO have a shift of ours to point at, so the row names it.
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        shift_id: 'shift-1',
        payload: expect.objectContaining({
          key: 'pattern-1|shift-1|2026-06-04',
          reason: 'overlaps a shift already on the calendar',
        }),
      }),
    ]);
  });

  it('still applies every other update in the batch', async () => {
    const day1 = baseShift({
      id: 'shift-a',
      starts_at: '2026-06-04T06:00:00.000Z',
      ends_at: '2026-06-04T15:00:00.000Z',
    });
    const day2 = baseShift({
      id: 'shift-b',
      local_date: '2026-06-05',
      starts_at: '2026-06-05T06:00:00.000Z',
      ends_at: '2026-06-05T15:00:00.000Z',
      ical_uid: 'pattern-ical-uid::2026-06-05',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [day1, day2]),
      update: mock(async (id: string) => {
        if (id === 'shift-a') {
          throw overlap();
        }
        return day2;
      }),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(
      pattern,
      [
        occurrence(),
        occurrence({
          localDate: '2026-06-05',
          startsAt: '2026-06-05T07:00:00.000Z',
          endsAt: '2026-06-05T16:00:00.000Z',
        }),
      ],
      NOW
    );

    expect(result.updated).toBe(1);
    expect(result.conflicts).toHaveLength(1);
  });
});
