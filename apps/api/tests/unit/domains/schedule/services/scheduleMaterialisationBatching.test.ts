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
import { expandRecurrence } from '../../../../../src/domains/schedule/services/recurrenceExpander';
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
      touchedDates: ['2026-06-02', '2026-06-04'],
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

/**
 * WS-M. The batched path was reported as converting a pattern's wall-clock
 * times to UTC in the SERVER's timezone instead of the household's. It does
 * not: the conversion happens exactly once, in `expandRecurrence`, from
 * `pattern.timezone`, and the batch only copies the instant it produced.
 *
 * The reason that had to be checked by hand is that NOTHING above would have
 * noticed if it were true. Every test in this file (and in
 * `scheduleMaterialisationService.test.ts`) hands `materialise` hand-written
 * occurrence literals — `${localDate}T07:00:00.000Z` — so the fixtures never
 * cross a timezone and a server-local implementation would satisfy them
 * byte-for-byte. This block closes that gap: the REAL expander drives the REAL
 * batch, the absolute UTC instants are pinned, and the process timezone is
 * deliberately set to one that is NOT the pattern's, so a conversion that ever
 * reads the process zone fails here instead of shipping.
 *
 * Both DST halves are covered — 09:00 London is 08:00Z in August (BST) and
 * 09:00Z in January (GMT) — because a fixed-offset shortcut passes one and
 * fails the other. See GOLDEN-FIXES #21/#29 and `recurrenceExpander`'s header.
 */
describe('ScheduleMaterialisationService — wall-clock -> UTC uses the PATTERN zone, not the process zone', () => {
  /** A Monday 09:00-17:00 London usual week — the shape behind the WS-M report. */
  const mondayNineToFive = {
    rrule: 'FREQ=WEEKLY;INTERVAL=1',
    exdates: [],
    pauseRanges: [],
    timezone: 'Europe/London',
    days: [{ weekday: 1, startTime: '09:00:00', endTime: '17:00:00' }],
  };

  /** The row `createMany` is handed for one real expanded occurrence. */
  async function rowFor(localDate: string, now: Date): Promise<NewShiftData> {
    const shiftRepo = makeCountingRepo();
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );
    const occurrences = expandRecurrence(
      { ...mondayNineToFive, dtstart: localDate, until: localDate },
      localDate
    );
    expect(occurrences).toHaveLength(1);
    await svc.materialise(pattern, occurrences, now);

    const [rows] = (shiftRepo.createMany as ReturnType<typeof mock>).mock
      .calls[0] as [NewShiftData[]];
    const row = rows[0];
    if (!row) {
      throw new Error('the occurrence was never handed to createMany');
    }
    return row;
  }

  /** Run `fn` with the process timezone pinned, then restore it. */
  async function withProcessTz<T>(
    timeZone: string,
    fn: () => Promise<T>
  ): Promise<T> {
    const original = process.env.TZ;
    process.env.TZ = timeZone;
    try {
      return await fn();
    } finally {
      process.env.TZ = original;
    }
  }

  it('summer (BST): 09:00 London materialises to 08:00Z, whatever the server zone', async () => {
    // 16:00Z would be 09:00 America/Los_Angeles — i.e. what a server-local
    // conversion writes on the dev machine this was reported from.
    for (const serverZone of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
      const row = await withProcessTz(serverZone, () =>
        rowFor('2026-08-10', new Date('2026-08-01T00:00:00.000Z'))
      );
      expect(row.starts_at).toBe('2026-08-10T08:00:00.000Z');
      expect(row.ends_at).toBe('2026-08-10T16:00:00.000Z');
      expect(row.timezone).toBe('Europe/London');
    }
  });

  it('winter (GMT): the SAME 09:00 wall clock materialises to 09:00Z — the offset is re-derived per date', async () => {
    for (const serverZone of ['America/Los_Angeles', 'Asia/Tokyo', 'UTC']) {
      const row = await withProcessTz(serverZone, () =>
        rowFor('2027-01-11', new Date('2027-01-01T00:00:00.000Z'))
      );
      expect(row.starts_at).toBe('2027-01-11T09:00:00.000Z');
      expect(row.ends_at).toBe('2027-01-11T17:00:00.000Z');
    }
  });
});

// F-B6-4 remaining half: a no-op nightly horizon run must not rewrite every
// shift it re-expands. `applyUpdates` used to run `update` +
// `replaceChildrenMany` for every paired occurrence, clean or dirty — bumping
// `sequence` on every row (the mobile ShiftDetailScreen's copy switches on
// `sequence === 0`, and the calendar seam treats a higher sequence as "needs
// push") and counting every row as `updated`, on a run where literally
// nothing changed.
describe('ScheduleMaterialisationService — a no-op re-run does not rewrite unchanged shifts', () => {
  /** An existing shift that already matches `pattern` and `unchangedOcc` byte-for-byte, modulo serialisation. */
  const unchangedShift = (overrides: Partial<Shift> = {}): Shift => ({
    ...shiftFromRow(
      {
        household_id: 'household-1',
        carer_id: 'carer-1',
        // PostgREST's `+00:00` — deliberately NOT the `.000Z` the occurrence
        // below is built with (GOLDEN-FIXES #25).
        starts_at: '2026-06-02T07:00:00+00:00',
        ends_at: '2026-06-02T16:00:00+00:00',
        timezone: 'Europe/London',
        kind: 'recurring',
        status: 'confirmed',
        source_pattern_id: 'pattern-1',
        origin: 'system_generated',
        note: 'The usual week', // matches `pattern.note` — see top-of-file fixture
        ical_uid: 'pattern-ical-uid::2026-06-02',
      },
      'shift-1'
    ),
    local_date: '2026-06-02',
    sequence: 0,
    ...overrides,
  });

  const unchangedOcc: ExpandedOccurrence = {
    localDate: '2026-06-02',
    weekday: 2,
    startsAt: '2026-06-02T07:00:00.000Z',
    endsAt: '2026-06-02T16:00:00.000Z',
    children: [],
  };

  it('performs zero update calls and zero replaceChildrenMany calls when nothing about the shift changed', async () => {
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [unchangedShift()]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [unchangedOcc], NOW);

    expect(shiftRepo.update).not.toHaveBeenCalled();
    expect(shiftRepo.replaceChildrenMany).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.touchedDates).toEqual([]);
  });

  it('still updates, demotes confirmed to pending, and bumps sequence when the time moved', async () => {
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [unchangedShift()]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const moved: ExpandedOccurrence = {
      ...unchangedOcc,
      startsAt: '2026-06-02T08:00:00.000Z',
    };
    const result = await svc.materialise(pattern, [moved], NOW);

    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({
        status: 'pending',
        starts_at: moved.startsAt,
        sequence: 1,
      })
    );
    expect(shiftRepo.replaceChildrenMany).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);
  });

  it('updates without demoting status when only the note changed', async () => {
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [unchangedShift()]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const amendedPattern: PatternForMaterialisation = {
      ...pattern,
      note: 'New note for the household',
    };
    const result = await svc.materialise(amendedPattern, [unchangedOcc], NOW);

    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({
        status: 'confirmed',
        note: 'New note for the household',
        sequence: 1,
      })
    );
    expect(result.updated).toBe(1);
  });

  it('in a mixed batch, only the dirty pair is updated — the clean pair is left alone', async () => {
    const dirtyOcc: ExpandedOccurrence = {
      localDate: '2026-06-04',
      weekday: 4,
      startsAt: '2026-06-04T07:00:00.000Z',
      endsAt: '2026-06-04T16:00:00.000Z',
      children: [],
    };
    const dirtyShift = unchangedShift({
      id: 'shift-2',
      local_date: '2026-06-04',
      // Moved from what `dirtyOcc` now produces.
      starts_at: '2026-06-04T09:00:00+00:00',
      ends_at: '2026-06-04T16:00:00+00:00',
      ical_uid: 'pattern-ical-uid::2026-06-04',
    });
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [unchangedShift(), dirtyShift]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(
      pattern,
      [unchangedOcc, dirtyOcc],
      NOW
    );

    expect(shiftRepo.update).toHaveBeenCalledTimes(1);
    expect(shiftRepo.update).toHaveBeenCalledWith(
      'shift-2',
      expect.objectContaining({ status: 'pending' })
    );
    expect(shiftRepo.replaceChildrenMany).toHaveBeenCalledTimes(1);
    expect(shiftRepo.replaceChildrenMany).toHaveBeenCalledWith([
      { shiftId: 'shift-2', children: [] },
    ]);
    expect(result.updated).toBe(1);
  });

  it('reads as clean when the stored instant and the expanded occurrence use different offset serialisations for BOTH edges', async () => {
    // Stored with a non-Z, non-`+00:00` numeric offset that is still the same
    // instant as the `.000Z` occurrence below — a stricter mix than
    // `unchangedShift`'s `+00:00`, so a naive string compare on either edge
    // would misfire here specifically.
    const shiftRepo = makeCountingRepo({
      findActiveByPattern: mock(async () => [
        unchangedShift({
          starts_at: '2026-06-02T08:00:00+01:00', // == 07:00Z
          ends_at: '2026-06-02T17:00:00+01:00', // == 16:00Z
        }),
      ]),
    });
    const svc = new ScheduleMaterialisationService(
      shiftRepo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [unchangedOcc], NOW);

    expect(shiftRepo.update).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
  });
});
