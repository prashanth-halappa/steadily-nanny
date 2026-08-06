/**
 * WS-J: `POST /schedule-patterns/:id/respond` took **26,051 ms** against the
 * hosted DB because materialisation asked a question per occurrence. These
 * tests pin the property that fixed it: the number of repository calls must
 * NOT grow with the length of the horizon, and the batched path must produce
 * byte-identical shifts to the per-day path it replaced.
 *
 * Every fake counts calls, so "round trips" here means "awaited repository
 * calls", which is exactly what a remote Postgres charges ~50-150ms for.
 *
 * Constructor-injected fakes, never `mock.module()` — same style as
 * `scheduleMaterialisationService.test.ts`.
 *
 * @module tests/unit/domains/schedule/services/scheduleMaterialisationBatching
 */
import { describe, expect, it, mock } from 'bun:test';
import type { Shift } from '@steadily-nanny/shared-types/schemas/shift.schema';
import type {
  NewShiftChildData,
  NewShiftData,
} from '../../../../../src/domains/schedule/repositories/scheduleShiftRepository';
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

/**
 * A Tue/Thu usual week, `weeks` weeks long, starting after NOW — the shape of
 * the pattern whose acceptance measured 26s over the 12-week
 * `MATERIALISATION_HORIZON_DAYS`.
 */
function twoDaysAWeek(weeks: number): ExpandedOccurrence[] {
  const occurrences: ExpandedOccurrence[] = [];
  for (let week = 0; week < weeks; week++) {
    for (const [offset, weekday] of [
      [2, 2],
      [4, 4],
    ] as const) {
      const day = new Date(
        Date.UTC(2026, 5, 2 + week * 7 + (offset - 2), 0, 0, 0)
      );
      const localDate = day.toISOString().slice(0, 10);
      occurrences.push({
        localDate,
        weekday,
        startsAt: `${localDate}T07:00:00.000Z`,
        endsAt: `${localDate}T16:00:00.000Z`,
        children: [{ childId: 'child-1', startsAt: null, endsAt: null }],
      });
    }
  }
  return occurrences;
}

function shiftFromRow(row: NewShiftData, id: string): Shift {
  return {
    id,
    household_id: row.household_id,
    carer_id: row.carer_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    timezone: row.timezone,
    local_date: row.starts_at.slice(0, 10),
    kind: row.kind,
    status: row.status,
    source_pattern_id: row.source_pattern_id,
    origin: row.origin,
    is_short_notice: false,
    note: row.note,
    reason: null,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_paid: false,
    cancellation_message: null,
    ical_uid: row.ical_uid,
    sequence: 0,
    created_by: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

/** Every repository call this service can make, each counting itself. */
function makeCountingRepo(
  overrides: Partial<MaterialisationShiftRepository> = {}
): MaterialisationShiftRepository {
  return {
    findActiveByPattern: mock(async () => [] as Shift[]),
    findRecurringInWindow: mock(async () => null),
    shiftIdsWithChangeRequests: mock(async () => new Set<string>()),
    create: mock(async (data: NewShiftData) => shiftFromRow(data, 'solo')),
    createMany: mock(async (rows: NewShiftData[]) =>
      rows.map((row, index) => shiftFromRow(row, `shift-${index + 1}`))
    ),
    update: mock(async (id: string) =>
      shiftFromRow(
        {
          household_id: 'household-1',
          carer_id: 'carer-1',
          starts_at: '2026-06-02T07:00:00.000Z',
          ends_at: '2026-06-02T16:00:00.000Z',
          timezone: 'Europe/London',
          kind: 'recurring',
          status: 'confirmed',
          source_pattern_id: 'pattern-1',
          origin: 'system_generated',
          note: null,
          ical_uid: 'x',
        },
        id
      )
    ),
    updateMany: mock(async () => undefined),
    deleteMany: mock(async () => undefined),
    replaceChildrenMany: mock(async () => undefined),
    ...overrides,
  };
}

function makeTimeEntryRepo(
  overrides: Partial<TimeEntryExistenceRepository> = {}
): TimeEntryExistenceRepository {
  return {
    shiftIdsWithTimeEntries: mock(async () => new Set<string>()),
    ...overrides,
  };
}

function makeEventRepo(
  overrides: Partial<ConflictEventRepository> = {}
): ConflictEventRepository {
  return {
    listEventKeysForDate: mock(async () => new Set<string>()),
    insertMany: mock(async () => undefined),
    ...overrides,
  };
}

/** Total awaited repository calls across all three injected repositories. */
function roundTrips(
  shiftRepo: MaterialisationShiftRepository,
  timeEntryRepo: TimeEntryExistenceRepository,
  eventRepo: ConflictEventRepository
): number {
  const counts = [
    ...Object.values(shiftRepo),
    ...Object.values(timeEntryRepo),
    ...Object.values(eventRepo),
  ].map(fn => (fn as ReturnType<typeof mock>).mock.calls.length);
  return counts.reduce((total, count) => total + count, 0);
}

describe('ScheduleMaterialisationService — round trips do not grow with the horizon', () => {
  it('materialises a fresh 12-week accept in a constant handful of calls, whatever the horizon length', async () => {
    const results: number[] = [];
    for (const weeks of [1, 12, 52]) {
      const shiftRepo = makeCountingRepo();
      const timeEntryRepo = makeTimeEntryRepo();
      const eventRepo = makeEventRepo();
      const svc = new ScheduleMaterialisationService(
        shiftRepo,
        timeEntryRepo,
        eventRepo
      );

      const occurrences = twoDaysAWeek(weeks);
      const result = await svc.materialise(pattern, occurrences, NOW);

      expect(result.created).toBe(occurrences.length);
      results.push(roundTrips(shiftRepo, timeEntryRepo, eventRepo));
    }

    // One week and a full year cost the SAME number of round trips. The
    // pre-batching code was ~4 per occurrence, i.e. 8 vs 416.
    expect(results[0]).toBe(results[1]);
    expect(results[1]).toBe(results[2]);
    // findActiveByPattern + shiftIdsWithTimeEntries +
    // shiftIdsWithChangeRequests + createMany + replaceChildrenMany.
    expect(results[0]).toBeLessThanOrEqual(5);
  });

  it('writes exactly the same shift rows and children the per-day path did', async () => {
    const shiftRepo = makeCountingRepo();
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const occurrences = twoDaysAWeek(2);
    await svc.materialise(pattern, occurrences, NOW);

    const [rows] = (shiftRepo.createMany as ReturnType<typeof mock>).mock
      .calls[0] as [NewShiftData[]];
    expect(rows).toHaveLength(4);
    expect(rows).toEqual(
      occurrences.map(occ => ({
        household_id: 'household-1',
        carer_id: 'carer-1',
        starts_at: occ.startsAt,
        ends_at: occ.endsAt,
        timezone: 'Europe/London',
        kind: 'recurring',
        status: 'confirmed',
        source_pattern_id: 'pattern-1',
        origin: 'system_generated',
        note: 'The usual week',
        ical_uid: `pattern-ical-uid::${occ.localDate}`,
      }))
    );

    // Children are keyed to the RIGHT shift — matched back by the
    // deterministic uid, not by RETURNING order.
    const [entries] = (shiftRepo.replaceChildrenMany as ReturnType<typeof mock>)
      .mock.calls[0] as [{ shiftId: string; children: NewShiftChildData[] }[]];
    expect(entries).toEqual(
      occurrences.map((_, index) => ({
        shiftId: `shift-${index + 1}`,
        children: [{ child_id: 'child-1', starts_at: null, ends_at: null }],
      }))
    );
  });

  it('never asks per occurrence: no repository call is made more than once per KIND of work', async () => {
    const shiftRepo = makeCountingRepo();
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    await svc.materialise(pattern, twoDaysAWeek(12), NOW);

    expect(shiftRepo.findActiveByPattern).toHaveBeenCalledTimes(1);
    expect(shiftRepo.createMany).toHaveBeenCalledTimes(1);
    expect(shiftRepo.replaceChildrenMany).toHaveBeenCalledTimes(1);
    expect(shiftRepo.create).not.toHaveBeenCalled();
    expect(shiftRepo.update).not.toHaveBeenCalled();
  });

  it('probes time entries and change requests ONCE for the whole run, with every candidate id', async () => {
    const occurrences = twoDaysAWeek(3);
    const existing = occurrences.map((occ, index) =>
      shiftFromRow(
        {
          household_id: 'household-1',
          carer_id: 'carer-1',
          starts_at: occ.startsAt,
          ends_at: occ.endsAt,
          timezone: 'Europe/London',
          kind: 'recurring',
          status: 'confirmed',
          source_pattern_id: 'pattern-1',
          origin: 'system_generated',
          note: null,
          ical_uid: `pattern-ical-uid::${occ.localDate}`,
        },
        `existing-${index}`
      )
    );
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => existing),
    });
    const timeEntryRepo = makeTimeEntryRepo();
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      timeEntryRepo,
      makeEventRepo()
    );

    await svc.materialise(pattern, occurrences, NOW);

    expect(timeEntryRepo.shiftIdsWithTimeEntries).toHaveBeenCalledTimes(1);
    expect(timeEntryRepo.shiftIdsWithTimeEntries).toHaveBeenCalledWith(
      existing.map(shift => shift.id)
    );
    expect(shiftRepo.shiftIdsWithChangeRequests).toHaveBeenCalledTimes(1);
    expect(shiftRepo.shiftIdsWithChangeRequests).toHaveBeenCalledWith(
      existing.map(shift => shift.id)
    );
    // Children for all 6 existing shifts in ONE call, and one update each.
    expect(shiftRepo.replaceChildrenMany).toHaveBeenCalledTimes(1);
    expect(shiftRepo.update).toHaveBeenCalledTimes(existing.length);
  });

  it('cancels an ended pattern`s whole future in one statement, and skips the clocked-into one', async () => {
    const occurrences = twoDaysAWeek(4);
    const shifts = occurrences.map((occ, index) =>
      shiftFromRow(
        {
          household_id: 'household-1',
          carer_id: 'carer-1',
          starts_at: occ.startsAt,
          ends_at: occ.endsAt,
          timezone: 'Europe/London',
          kind: 'recurring',
          status: 'confirmed',
          source_pattern_id: 'pattern-1',
          origin: 'system_generated',
          note: null,
          ical_uid: `pattern-ical-uid::${occ.localDate}`,
        },
        `existing-${index}`
      )
    );
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => shifts),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo({
        shiftIdsWithTimeEntries: mock(async () => new Set(['existing-0'])),
      }),
      makeEventRepo()
    );

    const cancelled = await svc.cancelFutureShiftsForEndedPattern(
      'pattern-1',
      NOW
    );

    expect(cancelled).toBe(shifts.length - 1);
    expect(shiftRepo.updateMany).toHaveBeenCalledTimes(1);
    expect(shiftRepo.updateMany).toHaveBeenCalledWith(
      shifts.slice(1).map(shift => shift.id),
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_ended',
      })
    );
    expect(shiftRepo.update).not.toHaveBeenCalled();
  });
});

describe('ScheduleMaterialisationService — batch insert still adopts on a 062 collision', () => {
  it('retries row by row when createMany reports a window collision, adopting only the loser', async () => {
    const occurrences = twoDaysAWeek(1); // two occurrences
    const first = occurrences[0];
    if (!first) {
      throw new Error('fixture must produce occurrences');
    }
    const winner = shiftFromRow(
      {
        household_id: 'household-1',
        carer_id: 'carer-1',
        starts_at: first.startsAt,
        ends_at: first.endsAt,
        timezone: 'Europe/London',
        kind: 'recurring',
        status: 'confirmed',
        source_pattern_id: 'pattern-other',
        origin: 'system_generated',
        note: null,
        ical_uid: 'other-pattern-uid::x',
      },
      'shift-from-other-pattern'
    );

    const shiftRepo = makeCountingRepo({
      createMany: mock(async () => null),
      create: mock(async (data: NewShiftData) => {
        if (data.starts_at === first.startsAt) {
          const { RecurringShiftAlreadyExistsError } = await import(
            '../../../../../src/domains/schedule/errors/scheduleErrors'
          );
          throw new RecurringShiftAlreadyExistsError({
            householdId: data.household_id,
            carerId: data.carer_id,
            startsAt: data.starts_at,
            endsAt: data.ends_at,
          });
        }
        return shiftFromRow(data, 'shift-new');
      }),
      findRecurringInWindow: mock(async () => winner),
      update: mock(async () => winner),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, occurrences, NOW);

    // The colliding occurrence adopted the existing row; the other was created
    // normally by the per-row retry.
    expect(shiftRepo.create).toHaveBeenCalledTimes(2);
    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-from-other-pattern',
      expect.objectContaining({ source_pattern_id: 'pattern-1' })
    );
    expect(result).toEqual({
      created: 1,
      updated: 1,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    });
  });
});

// GOLDEN-FIXES #25: `shift.starts_at` comes back from PostgREST as
// `...+00:00`; `occ.startsAt` is built in JS as `....000Z`. Compared as
// STRINGS every unchanged shift looks moved, so every horizon run reverted the
// carer's accepted week to `pending`.
describe('ScheduleMaterialisationService — times-moved compares instants, not strings', () => {
  const postgrestShift = (startsAt: string, endsAt: string): Shift => ({
    ...shiftFromRow(
      {
        household_id: 'household-1',
        carer_id: 'carer-1',
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: 'Europe/London',
        kind: 'recurring',
        status: 'confirmed',
        source_pattern_id: 'pattern-1',
        origin: 'system_generated',
        note: null,
        ical_uid: 'pattern-ical-uid::2026-06-02',
      },
      'shift-1'
    ),
    local_date: '2026-06-02',
  });

  it('keeps a confirmed shift confirmed when PostgREST `+00:00` and JS `.000Z` describe the same instant', async () => {
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [
        postgrestShift(
          '2026-06-02T07:00:00+00:00',
          '2026-06-02T16:00:00+00:00'
        ),
      ]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    await svc.materialise(
      pattern,
      [
        {
          localDate: '2026-06-02',
          weekday: 2,
          startsAt: '2026-06-02T07:00:00.000Z',
          endsAt: '2026-06-02T16:00:00.000Z',
          children: [],
        },
      ],
      NOW
    );

    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ status: 'confirmed' })
    );
  });

  it('still reverts to pending when the instant genuinely moved', async () => {
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [
        postgrestShift(
          '2026-06-02T07:00:00+00:00',
          '2026-06-02T16:00:00+00:00'
        ),
      ]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    await svc.materialise(
      pattern,
      [
        {
          localDate: '2026-06-02',
          weekday: 2,
          startsAt: '2026-06-02T08:00:00.000Z',
          endsAt: '2026-06-02T16:00:00.000Z',
          children: [],
        },
      ],
      NOW
    );

    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ status: 'pending' })
    );
  });
});
