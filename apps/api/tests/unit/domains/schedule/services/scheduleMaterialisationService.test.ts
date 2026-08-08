/**
 * Idempotent re-materialisation — one test per branch of the existing-shift
 * policy table in the wave-2 spec. Written BEFORE the implementation exists
 * (TDD red-first). Uses constructor-injected fakes (plain objects
 * implementing `MaterialisationShiftRepository`), never `mock.module()`, per
 * the team's stated preference.
 *
 * @module tests/unit/domains/schedule/services/scheduleMaterialisationService
 */
import { beforeAll, describe, expect, it, mock } from 'bun:test';
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

describe('ScheduleMaterialisationService — new occurrence', () => {
  it('creates a confirmed, system_generated shift with a deterministic ical_uid, and replaces its children', async () => {
    const repo = makeRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const occ = occurrence({
      children: [{ childId: 'child-1', startsAt: null, endsAt: null }],
    });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        household_id: 'household-1',
        carer_id: 'carer-1',
        starts_at: occ.startsAt,
        ends_at: occ.endsAt,
        timezone: 'Europe/London',
        status: 'confirmed',
        origin: 'system_generated',
        source_pattern_id: 'pattern-1',
        ical_uid: 'pattern-ical-uid::2026-06-04',
        note: 'The usual week',
      }),
    ]);
    expect(repo.replaceChildrenMany).toHaveBeenCalledWith([
      {
        shiftId: 'shift-1',
        children: [{ child_id: 'child-1', starts_at: null, ends_at: null }],
      },
    ]);
    expect(result).toEqual({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    });
  });
});

// F-B6-3 (S1): a multi-day horizon-job outage means the catch-up run's
// `expandRecurrence` re-expansion produces occurrences whose `startsAt` is
// already in the past. Without a guard, `materialiseOne` created these as
// brand-new `confirmed` shifts nobody could ever have clocked into.
describe('ScheduleMaterialisationService — horizon catch-up must not backfill past occurrences', () => {
  it('does not create a shift for an occurrence that has already started and has no existing row', async () => {
    const repo = makeRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    // NOW is 2026-06-01T00:00:00Z — this occurrence started 2026-05-28,
    // days before the horizon job caught back up (the D85-89 scenario).
    const occ = occurrence({
      localDate: '2026-05-28',
      startsAt: '2026-05-28T07:00:00.000Z',
      endsAt: '2026-05-28T16:00:00.000Z',
    });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.createMany).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
  });

  it('still creates a shift for an occurrence later today that has not started yet', async () => {
    const repo = makeRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    // NOW is 2026-06-01T00:00:00Z — this occurrence starts later the same day.
    const occ = occurrence({
      localDate: '2026-06-01',
      startsAt: '2026-06-01T18:00:00.000Z',
      endsAt: '2026-06-01T20:00:00.000Z',
    });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.createMany).toHaveBeenCalledTimes(1);
    expect(result.created).toBe(1);
  });

  it('still updates an already-existing row for a started occurrence — the guard only blocks NEW creation', async () => {
    const existing = baseShift({ status: 'draft' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    // now is well after this occurrence's start — but a row already exists
    // for it, so the normal forward-looking update path must still run.
    const later = new Date('2026-06-10T00:00:00.000Z');
    const occ = occurrence({
      startsAt: existing.starts_at,
      endsAt: existing.ends_at,
    });
    const result = await svc.materialise(pattern, [occ], later);

    expect(repo.createMany).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledTimes(1);
    expect(result.updated).toBe(1);
  });
});

describe('ScheduleMaterialisationService — existing shift, untouched, draft/pending', () => {
  it('overwrites times, children, and note; status is left alone', async () => {
    const existing = baseShift({ status: 'draft', note: 'old note' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const occ = occurrence({
      startsAt: '2026-06-04T07:30:00.000Z',
      endsAt: '2026-06-04T16:30:00.000Z',
      children: [{ childId: 'child-2', startsAt: null, endsAt: null }],
    });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({
        starts_at: occ.startsAt,
        ends_at: occ.endsAt,
        note: 'The usual week',
        status: 'draft',
      })
    );
    expect(repo.replaceChildrenMany).toHaveBeenCalledWith([
      {
        shiftId: 'shift-1',
        children: [{ child_id: 'child-2', starts_at: null, ends_at: null }],
      },
    ]);
    expect(result.updated).toBe(1);
    expect(result.conflicts).toEqual([]);
  });
});

describe('ScheduleMaterialisationService — existing confirmed, untouched', () => {
  it('overwrites in place and keeps status confirmed when times did not move', async () => {
    const existing = baseShift({ status: 'confirmed' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    // Same start/end as `existing` — nothing moved.
    const occ = occurrence({
      startsAt: existing.starts_at,
      endsAt: existing.ends_at,
    });
    await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ status: 'confirmed' })
    );
  });

  it('reverts to pending (carer must re-accept) when times moved', async () => {
    const existing = baseShift({ status: 'confirmed' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const occ = occurrence({
      startsAt: '2026-06-04T08:00:00.000Z', // moved from 07:00Z
      endsAt: existing.ends_at,
    });
    await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-1',
      expect.objectContaining({ status: 'pending', starts_at: occ.startsAt })
    );
  });
});

describe('ScheduleMaterialisationService — manually touched shift (origin or change requests)', () => {
  it('preserves a shift with a non-system origin: no update, no delete, emits a pattern_conflict event and a warning', async () => {
    const existing = baseShift({ origin: 'parent_proposed' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        household_id: 'household-1',
        shift_id: 'shift-1',
        local_date: '2026-06-04',
        event_type: 'pattern_conflict',
      }),
    ]);
    expect(result.conflicts).toEqual([
      {
        shiftId: 'shift-1',
        localDate: '2026-06-04',
        reason: 'manually_edited',
      },
    ]);
    expect(result.updated).toBe(0);
  });

  it('raises the pattern_conflict day-thread row AT MOST ONCE per (pattern, shift, local_date), however many times the horizon job re-runs', async () => {
    const existing = baseShift({ origin: 'parent_proposed' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });

    // Run 1: nothing raised yet -> one insert, and we capture its key.
    const firstRunRepo = makeEventRepo();
    const first = await new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      firstRunRepo
    ).materialise(pattern, [occurrence()], NOW);

    expect(firstRunRepo.insertMany).toHaveBeenCalledTimes(1);
    const [rows] = (firstRunRepo.insertMany as any).mock.calls[0] as [any[]];
    const key = rows[0].payload.key as string;
    expect(key).toBe('pattern-1|shift-1|2026-06-04');
    expect(first.conflicts).toHaveLength(1);

    // Run 2 (the next nightly horizon roll): the key is already in the
    // thread -> NO second insert, but the in-memory warning still surfaces.
    const secondRunRepo = makeEventRepo({
      listEventKeysForDate: mock(async () => new Set([key])),
    });
    const second = await new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      secondRunRepo
    ).materialise(pattern, [occurrence()], NOW);

    expect(secondRunRepo.listEventKeysForDate).toHaveBeenCalledWith(
      'household-1',
      '2026-06-04',
      'pattern_conflict'
    );
    expect(secondRunRepo.insertMany).not.toHaveBeenCalled();
    expect(second.conflicts).toHaveLength(1);
  });

  it('preserves a system_generated shift that has any shift_change_requests row, even with no other edits', async () => {
    const existing = baseShift({ origin: 'system_generated' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
      shiftIdsWithChangeRequests: mock(async (ids: string[]) => new Set(ids)),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.reason).toBe('manually_edited');
  });
});

describe('ScheduleMaterialisationService — completed/cancelled shifts are NEVER touched', () => {
  it('does not update, delete, or emit events for a completed shift, even if its times moved', async () => {
    const existing = baseShift({ status: 'completed' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    const occ = occurrence({ startsAt: '2026-06-04T09:00:00.000Z' });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    });
  });

  it('does not touch an already-cancelled shift', async () => {
    const existing = baseShift({ status: 'cancelled' });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(repo.deleteMany).not.toHaveBeenCalled();
  });
});

describe('ScheduleMaterialisationService — a shift with time_entries is NEVER touched', () => {
  it('leaves an existing shift completely alone when it has a time entry, even though it would otherwise be overwritten (untouched, times moved)', async () => {
    const existing = baseShift({
      status: 'confirmed',
      origin: 'system_generated',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
    });
    const timeEntryRepo = makeTimeEntryRepo({
      shiftIdsWithTimeEntries: mock(async (ids: string[]) => new Set(ids)),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      timeEntryRepo,
      eventRepo
    );

    // Times moved and the shift is otherwise untouched (system_generated, no
    // change requests) — every other branch would overwrite this shift.
    const occ = occurrence({ startsAt: '2026-06-04T09:00:00.000Z' });
    const result = await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(eventRepo.insertMany).not.toHaveBeenCalled();
    expect(result).toEqual({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
    });
  });

  it('leaves an orphaned (no-longer-produced) shift alone when it has a time entry, even though it is future and untouched', async () => {
    const orphan = baseShift({
      id: 'shift-paid-orphan',
      local_date: '2026-07-01',
      starts_at: '2026-07-01T07:00:00.000Z',
      status: 'confirmed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const timeEntryRepo = makeTimeEntryRepo({
      shiftIdsWithTimeEntries: mock(async (ids: string[]) => new Set(ids)),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      timeEntryRepo,
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.cancelled).toBe(0);
  });
});

describe('ScheduleMaterialisationService — occurrences no longer produced by the RRULE', () => {
  it('hard-deletes a future, untouched, system_generated shift that the pattern no longer produces', async () => {
    const orphan = baseShift({
      id: 'shift-orphan',
      local_date: '2026-07-01', // not in the produced set below
      starts_at: '2026-07-01T07:00:00.000Z',
      status: 'confirmed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    // Only 2026-06-04 is produced this run — the orphan's date is not.
    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.deleteMany).toHaveBeenCalledWith(['shift-orphan']);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(result.deleted).toBe(1);
  });

  it('cancels (does not delete) a no-longer-produced shift that is in the past', async () => {
    const orphan = baseShift({
      id: 'shift-past-orphan',
      local_date: '2026-05-01',
      starts_at: '2026-05-01T07:00:00.000Z', // before NOW (2026-06-01)
      status: 'confirmed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(repo.updateMany).toHaveBeenCalledWith(
      ['shift-past-orphan'],
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_changed',
      })
    );
    expect(result.cancelled).toBe(1);
  });

  it('cancels rather than deletes a future no-longer-produced shift that was manually touched, warns, and raises pattern_conflict once', async () => {
    const orphan = baseShift({
      id: 'shift-touched-orphan',
      local_date: '2026-07-01',
      starts_at: '2026-07-01T07:00:00.000Z',
      status: 'confirmed',
      origin: 'nanny_countered',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphan]),
    });
    const eventRepo = makeEventRepo();
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      eventRepo
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(repo.updateMany).toHaveBeenCalledWith(
      ['shift-touched-orphan'],
      expect.objectContaining({
        status: 'cancelled',
        reason: 'pattern_changed',
      })
    );
    expect(result.cancelled).toBe(1);
    expect(result.conflicts).toEqual([
      {
        shiftId: 'shift-touched-orphan',
        localDate: '2026-07-01',
        reason: 'manually_edited_now_cancelled',
      },
    ]);
    expect(eventRepo.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        shift_id: 'shift-touched-orphan',
        event_type: 'pattern_conflict',
        local_date: '2026-07-01',
      }),
    ]);
  });

  it('never touches an orphaned shift that is already completed or cancelled', async () => {
    const orphanCompleted = baseShift({
      id: 'shift-orphan-completed',
      local_date: '2026-05-01',
      status: 'completed',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [orphanCompleted]),
    });
    const svc = new ScheduleMaterialisationService(
      repo,
      makeTimeEntryRepo(),
      makeEventRepo()
    );

    const result = await svc.materialise(pattern, [occurrence()], NOW);

    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.updateMany).not.toHaveBeenCalled();
    expect(repo.deleteMany).not.toHaveBeenCalled();
    expect(result.deleted).toBe(0);
    expect(result.cancelled).toBe(0);
  });
});

describe('ScheduleMaterialisationService — voided entries do not freeze shifts (069)', () => {
  let TimeEntryRepository: typeof import('../../../../../src/domains/timesheet/repositories/timeEntryRepository').TimeEntryRepository;
  // `any` matches the house style for a mocked supabase client (see
  // scheduleShiftRepository.test.ts:16) — the mocked shape and the real
  // SupabaseClient type do not line up, and tests get a relaxed no-any rule.
  // biome-ignore lint/suspicious/noExplicitAny: mocked supabase client
  let mockSupabaseService: any;

  function createSupabaseQueryChain(
    finalResponse: { data: unknown; error: unknown } = {
      data: null,
      error: null,
    }
  ): any {
    const chain: any = {
      select: mock(() => chain),
      eq: mock(() => chain),
      neq: mock(() => chain),
      in: mock(() => chain),
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable for the mock
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(finalResponse).then(resolve),
    };
    return chain;
  }

  beforeAll(async () => {
    mock.module('../../../../../src/config/supabase', () => {
      const obj = {
        from: mock(() => createSupabaseQueryChain({ data: [], error: null })),
      };
      return { supabase: obj, supabaseService: obj };
    });

    TimeEntryRepository = (
      await import(
        '../../../../../src/domains/timesheet/repositories/timeEntryRepository'
      )
    ).TimeEntryRepository;
    mockSupabaseService = (await import('../../../../../src/config/supabase'))
      .supabaseService;
  });

  it('updates a shift when shiftIdsWithTimeEntries excludes its voided-only entry', async () => {
    const existing = baseShift({
      id: 'shift-voided-only',
      status: 'confirmed',
      origin: 'system_generated',
    });
    const repo = makeRepo({
      findActiveByPattern: mock(async () => [existing]),
      update: mock(async () =>
        baseShift({
          id: 'shift-voided-only',
          starts_at: '2026-06-04T09:00:00.000Z',
        })
      ),
    });
    // The real query is `.select('shift_id').in(...).neq('status','voided')`,
    // so a shift whose only entry is voided comes back with NO rows at all.
    // Returning the row here would model a database that ignores its own
    // filter — and production code written to satisfy that would have to
    // guess voidedness from the row shape.
    mockSupabaseService.from.mockImplementation(() =>
      createSupabaseQueryChain({ data: [], error: null })
    );
    const svc = new ScheduleMaterialisationService(
      repo,
      new TimeEntryRepository(),
      makeEventRepo()
    );

    const occ = occurrence({ startsAt: '2026-06-04T09:00:00.000Z' });
    await svc.materialise(pattern, [occ], NOW);

    expect(repo.update).toHaveBeenCalledWith(
      'shift-voided-only',
      expect.objectContaining({ starts_at: '2026-06-04T09:00:00.000Z' })
    );
  });
});
