/**
 * TDD tests for the schedule-horizon-rolling job. `patternRepo` and
 * `commandService` are both injected (see `runScheduleHorizonJob`'s own
 * signature) so these never touch Supabase.
 */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from 'bun:test';
import { PUSH_NOTIFICATION_TYPES } from '@steadily-nanny/shared-types/schemas/notification.schema';
import type { SchedulePattern } from '../../../src/domains/schedule/types';
import type {
  HorizonShiftLookupRepository,
  ScheduleHorizonJobDeps,
} from '../../../src/jobs/scheduleHorizonJob';

function patternFor(overrides: Partial<SchedulePattern> = {}): SchedulePattern {
  return {
    id: 'p1',
    household_id: 'h1',
    carer_id: 'carer-1',
    status: 'accepted',
    rrule: 'FREQ=WEEKLY;INTERVAL=1',
    dtstart: '2026-02-02',
    until: null,
    exdates: [],
    pause_ranges: [],
    timezone: 'Europe/London',
    note: null,
    decline_message: null,
    created_by: 'u1',
    sent_at: null,
    responded_at: null,
    ical_uid: 'pattern-uid',
    sequence: 0,
    created_at: 't',
    updated_at: 't',
    ...overrides,
  };
}

/** A change-request repository that finds nothing stale. */
function noChangeRequests() {
  return { expirePendingOlderThan: mock(async (_cutoffIso: string) => []) };
}

/** A no-op materialiser, for the tests that only care about the sweeps. */
function noOpMaterialiser() {
  return {
    materialiseForHorizon: mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    })),
  };
}

function noOpJobDeps(
  overrides: Partial<ScheduleHorizonJobDeps> = {}
): ScheduleHorizonJobDeps {
  return {
    commitments: { listHouseholdIdsWithCommitments: mock(async () => []) },
    ...overrides,
  };
}

let runScheduleHorizonJob: typeof import('../../../src/jobs/scheduleHorizonJob').runScheduleHorizonJob;

beforeAll(async () => {
  ({ runScheduleHorizonJob } = await import(
    '../../../src/jobs/scheduleHorizonJob'
  ));
});

afterEach(() => {
  setSystemTime();
});

describe('runScheduleHorizonJob', () => {
  it('materialises every accepted pattern the repository lists', async () => {
    const patterns = [patternFor({ id: 'p1' }), patternFor({ id: 'p2' })];
    const patternRepo = { listAccepted: mock(async () => patterns) };
    const materialiseForHorizon = mock(async () => ({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    }));
    const commandService = { materialiseForHorizon };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noChangeRequests(),
      noOpJobDeps()
    );

    expect(materialiseForHorizon).toHaveBeenCalledTimes(2);
    expect(materialiseForHorizon).toHaveBeenCalledWith(patterns[0]);
    expect(materialiseForHorizon).toHaveBeenCalledWith(patterns[1]);
    expect(result.patternsProcessed).toBe(2);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(0);
  });

  it('does nothing when there are no accepted patterns', async () => {
    const patternRepo = { listAccepted: mock(async () => []) };
    const materialiseForHorizon = mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    }));
    const commandService = { materialiseForHorizon };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noChangeRequests(),
      noOpJobDeps()
    );

    expect(materialiseForHorizon).not.toHaveBeenCalled();
    expect(result.patternsProcessed).toBe(0);
    expect(result.successCount).toBe(0);
  });

  it('keeps processing remaining patterns when one materialise call fails, and reports the error count', async () => {
    const patterns = [
      patternFor({ id: 'p-good-1' }),
      patternFor({ id: 'p-bad' }),
      patternFor({ id: 'p-good-2' }),
    ];
    const patternRepo = { listAccepted: mock(async () => patterns) };
    const materialiseForHorizon = mock(async (pattern: SchedulePattern) => {
      if (pattern.id === 'p-bad') {
        throw new Error('boom');
      }
      return {
        created: 1,
        updated: 0,
        deleted: 0,
        cancelled: 0,
        conflicts: [],
        touchedDates: [],
      };
    });
    const commandService = { materialiseForHorizon };

    const result = await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noChangeRequests(),
      noOpJobDeps()
    );

    expect(materialiseForHorizon).toHaveBeenCalledTimes(3);
    expect(result.patternsProcessed).toBe(3);
    expect(result.successCount).toBe(2);
    expect(result.errorCount).toBe(1);
  });

  it("never touches draft/pending/declined/withdrawn patterns — only whatever the repository's listAccepted returns", async () => {
    const patternRepo = { listAccepted: mock(async () => [patternFor()]) };
    const materialiseForHorizon = mock(async () => ({
      created: 0,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    }));
    const commandService = { materialiseForHorizon };

    await runScheduleHorizonJob(
      patternRepo,
      commandService,
      noChangeRequests(),
      noOpJobDeps()
    );

    expect(patternRepo.listAccepted).toHaveBeenCalledTimes(1);
    expect(patternRepo.listAccepted).toHaveBeenCalledWith();
  });
});

describe('runScheduleHorizonJob — stale change-request sweep (F-B5-5)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('expires pending change requests older than 7 days and reports how many', async () => {
    const patternRepo = { listAccepted: mock(async () => []) };
    const changeRequests = {
      expirePendingOlderThan: mock(async (_cutoffIso: string) => [
        { id: 'cr1' },
        { id: 'cr2' },
        { id: 'cr3' },
      ]) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const before = Date.now();
    const result = await runScheduleHorizonJob(
      patternRepo,
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );
    const after = Date.now();

    expect(changeRequests.expirePendingOlderThan).toHaveBeenCalledTimes(1);
    const [firstCall] = changeRequests.expirePendingOlderThan.mock.calls;
    const cutoff = Date.parse(firstCall?.[0] ?? '');
    expect(cutoff).toBeGreaterThanOrEqual(before - 7 * DAY_MS);
    expect(cutoff).toBeLessThanOrEqual(after - 7 * DAY_MS);
    expect(result.changeRequestsExpired).toBe(3);
  });

  it('sweeps globally — no household argument', async () => {
    const patternRepo = { listAccepted: mock(async () => []) };
    const changeRequests = noChangeRequests();

    await runScheduleHorizonJob(
      patternRepo,
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );

    expect(changeRequests.expirePendingOlderThan.mock.calls[0]).toHaveLength(1);
  });

  it('reports 0 and still completes the horizon work when the sweep throws', async () => {
    const patternRepo = { listAccepted: mock(async () => [patternFor()]) };
    const materialiseForHorizon = mock(async () => ({
      created: 1,
      updated: 0,
      deleted: 0,
      cancelled: 0,
      conflicts: [],
      touchedDates: [],
    }));
    const changeRequests = {
      expirePendingOlderThan: mock(async () => {
        throw new Error('shift_change_requests unreachable');
      }) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const result = await runScheduleHorizonJob(
      patternRepo,
      { materialiseForHorizon },
      changeRequests,
      noOpJobDeps()
    );

    expect(result.successCount).toBe(1);
    expect(result.changeRequestsExpired).toBe(0);
  });

  it('pushes to the requester when an expired row has requested_by', async () => {
    const notifyUser = mock(() => undefined);
    const changeRequests = {
      expirePendingOlderThan: mock(async () => [
        {
          id: 'cr-1',
          shift_id: 'shift-1',
          requested_by: 'user-requester',
        },
      ]) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };
    const deps = noOpJobDeps({
      notifyUser,
      shifts: {
        findByIds: mock(async () => [
          {
            id: 'shift-1',
            household_id: 'hh-1',
            local_date: '2026-08-04',
          },
        ]) as unknown as HorizonShiftLookupRepository['findByIds'],
      },
    });

    await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      changeRequests,
      deps
    );

    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser).toHaveBeenCalledWith(
      'user-requester',
      expect.objectContaining({
        title: 'Change request expired',
        body: expect.stringContaining('Aug 4'),
        data: {
          type: PUSH_NOTIFICATION_TYPES.CHANGE_REQUEST_EXPIRED,
          shiftId: 'shift-1',
          changeRequestId: 'cr-1',
          householdId: 'hh-1',
        },
      })
    );
  });

  it('does not push when requested_by is null', async () => {
    const notifyUser = mock(() => undefined);
    const findByIds = mock(async () => []);
    const changeRequests = {
      expirePendingOlderThan: mock(async () => [
        {
          id: 'cr-1',
          shift_id: 'shift-1',
          requested_by: null,
        },
      ]) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };
    const deps = noOpJobDeps({
      notifyUser,
      shifts: {
        findByIds:
          findByIds as unknown as HorizonShiftLookupRepository['findByIds'],
      },
    });

    await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      changeRequests,
      deps
    );

    expect(notifyUser).not.toHaveBeenCalled();
    expect(findByIds).not.toHaveBeenCalled();
  });
});

describe('runScheduleHorizonJob — uncovered-care backstop sweep', () => {
  it('runs detection over today through today+30 for each household with care hours', async () => {
    setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const detectUncovered = mock(async () => []);
    const deps = noOpJobDeps({
      detectUncovered,
      commitments: {
        listHouseholdIdsWithCommitments: mock(async () => ['hh-1']),
      },
      households: {
        findByIds: mock(async () => [
          { id: 'hh-1', timezone: 'UTC', created_at: 't', updated_at: 't' },
        ]) as unknown as NonNullable<
          ScheduleHorizonJobDeps['households']
        >['findByIds'],
      },
    });

    await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      deps
    );

    expect(detectUncovered).toHaveBeenCalledTimes(31);
    expect(detectUncovered).toHaveBeenCalledWith({
      householdId: 'hh-1',
      localDate: '2026-08-01',
      cause: 'nothingScheduled',
    });
    expect(detectUncovered).toHaveBeenCalledWith({
      householdId: 'hh-1',
      localDate: '2026-08-31',
      cause: 'nothingScheduled',
    });
  });

  it('keeps sweeping remaining households when one household detector throws', async () => {
    setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const detectUncovered = mock(async (args: { householdId: string }) => {
      if (args.householdId === 'hh-bad') {
        throw new Error('detector boom');
      }
      return [];
    });
    const deps = noOpJobDeps({
      detectUncovered,
      commitments: {
        listHouseholdIdsWithCommitments: mock(async () => [
          'hh-bad',
          'hh-good',
        ]),
      },
      households: {
        findByIds: mock(async () => [
          { id: 'hh-bad', timezone: 'UTC', created_at: 't', updated_at: 't' },
          { id: 'hh-good', timezone: 'UTC', created_at: 't', updated_at: 't' },
        ]) as unknown as NonNullable<
          ScheduleHorizonJobDeps['households']
        >['findByIds'],
      },
    });

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      deps
    );
    expect(result.successCount).toBe(0);

    // hh-bad throws on its first date; hh-good still gets the full 31-day window.
    expect(detectUncovered).toHaveBeenCalledTimes(32);
    expect(detectUncovered).toHaveBeenCalledWith({
      householdId: 'hh-good',
      localDate: '2026-08-31',
      cause: 'nothingScheduled',
    });
  });
});
