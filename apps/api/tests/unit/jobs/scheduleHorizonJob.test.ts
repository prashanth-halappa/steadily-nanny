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
  return {
    expirePendingOlderThan: mock(async (_cutoffIso: string) => []),
    expirePendingForStartedShifts: mock(async (_nowIso: string) => []),
  };
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
    // S8: injected in every test so the retention sweep never reaches for a
    // real Supabase client (which times the whole file out, slowly).
    events: { deleteSweptEventsOlderThan: mock(async () => 0) },
    // S4b: same reason — the cross-household clash sweep never reaches for a
    // real Supabase client unless a test overrides these.
    clashScan: { listLiveForClashScan: mock(async () => []) },
    clashEvents: {
      listEventKeysForDate: mock(async () => new Set<string>()),
      insertMany: mock(async () => []),
    },
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
      ...noChangeRequests(),
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
      ...noChangeRequests(),
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

  it('J1-a: counts the age-based sweep failure into the run-level errorCount', async () => {
    const changeRequests = {
      ...noChangeRequests(),
      expirePendingOlderThan: mock(async () => {
        throw new Error('shift_change_requests unreachable');
      }) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );

    expect(result.errorCount).toBeGreaterThan(0);
  });

  it('pushes to the requester when an expired row has requested_by', async () => {
    const notifyUser = mock(() => undefined);
    const changeRequests = {
      ...noChangeRequests(),
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
      ...noChangeRequests(),
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
    // J1-a: a failed household in the uncovered-care backstop must count
    // toward the run-level errorCount, not vanish silently.
    expect(result.errorCount).toBe(1);
  });

  it('J1-a: counts as an error when listing households with care hours fails', async () => {
    setSystemTime(new Date('2026-08-01T12:00:00.000Z'));
    const deps = noOpJobDeps({
      commitments: {
        listHouseholdIdsWithCommitments: mock(async () => {
          throw new Error('commitments unreachable');
        }),
      },
    });

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      deps
    );

    expect(result.errorCount).toBeGreaterThan(0);
  });
});

describe('runScheduleHorizonJob — A5: a request must not outlive its shift', () => {
  it('expires pending requests whose shift has already started, keyed on the shift not the request age', async () => {
    const now = new Date();
    setSystemTime(now);
    const changeRequests = {
      ...noChangeRequests(),
      expirePendingForStartedShifts: mock(async (_nowIso: string) => [
        { id: 'cr-started-1' },
        { id: 'cr-started-2' },
      ]) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingForStartedShifts'],
    };

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );

    expect(changeRequests.expirePendingForStartedShifts).toHaveBeenCalledTimes(
      1
    );
    // `now`, NOT a 7-day cutoff — the whole point of A5 is that a request
    // about tomorrow's shift is six days from the age-based cutoff.
    const [call] = changeRequests.expirePendingForStartedShifts.mock.calls;
    expect(call?.[0]).toBe(now.toISOString());
    expect(result.changeRequestsExpiredForStartedShifts).toBe(2);
  });

  it('runs independently of the age-based arm — one throwing never skips the other', async () => {
    const changeRequests = {
      ...noChangeRequests(),
      expirePendingOlderThan: mock(async () => {
        throw new Error('age sweep unreachable');
      }) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingOlderThan'],
    };

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );

    expect(result.changeRequestsExpired).toBe(0);
    expect(changeRequests.expirePendingForStartedShifts).toHaveBeenCalledTimes(
      1
    );
  });

  it('reports 0 rather than failing the run when the started-shift arm throws', async () => {
    const changeRequests = {
      ...noChangeRequests(),
      expirePendingForStartedShifts: mock(async () => {
        throw new Error('unreachable');
      }) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingForStartedShifts'],
    };

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => [patternFor()]) },
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );

    expect(result.changeRequestsExpiredForStartedShifts).toBe(0);
    expect(result.patternsProcessed).toBe(1);
  });

  it('J1-a: counts the started-shift sweep failure into the run-level errorCount', async () => {
    const changeRequests = {
      ...noChangeRequests(),
      expirePendingForStartedShifts: mock(async () => {
        throw new Error('unreachable');
      }) as unknown as ReturnType<
        typeof noChangeRequests
      >['expirePendingForStartedShifts'],
    };

    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      changeRequests,
      noOpJobDeps()
    );

    expect(result.errorCount).toBeGreaterThan(0);
  });
});

describe('runScheduleHorizonJob — S8: shift_events retention', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('sweeps machine-generated events older than 90 days', async () => {
    const deleteSweptEventsOlderThan = mock(
      async (_cutoffIso: string, _types: readonly string[]) => 412
    );
    const before = Date.now();
    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({ events: { deleteSweptEventsOlderThan } })
    );
    const after = Date.now();

    expect(deleteSweptEventsOlderThan).toHaveBeenCalledTimes(1);
    const [cutoffIso] = deleteSweptEventsOlderThan.mock.calls[0] ?? [];
    const cutoff = Date.parse(String(cutoffIso));
    expect(cutoff).toBeGreaterThanOrEqual(before - 90 * DAY_MS);
    expect(cutoff).toBeLessThanOrEqual(after - 90 * DAY_MS);
    expect(result.eventsSwept).toBe(412);
  });

  it('passes an ALLOWLIST of machine-generated types, never the thread types', async () => {
    const deleteSweptEventsOlderThan = mock(
      async (_cutoffIso: string, _types: readonly string[]) => 0
    );
    await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({ events: { deleteSweptEventsOlderThan } })
    );

    const types = deleteSweptEventsOlderThan.mock.calls[0]?.[1] as string[];
    // S4b: cross_family_clash joins pattern_conflict/uncovered_care — it is
    // machine output too, recomputed nightly by the same sweep-line, never
    // hand-edited.
    expect([...types].sort()).toEqual([
      'cross_family_clash',
      'pattern_conflict',
      'uncovered_care',
    ]);

    // The rows a dispute is argued from. If any of these ever appears in that
    // list, the week thread (3-T1 / D-18) and the cancellation-pay verdict
    // become deletable, and the audit trail stops being an audit trail.
    for (const protectedType of [
      'timesheet_queried',
      'timesheet_note_added',
      'timesheet_query_withdrawn',
      'shift_cancelled',
      'change_request_accepted',
      'change_request_declined',
      'change_request_created',
    ]) {
      expect(types).not.toContain(protectedType);
    }
  });

  it('J1-a: a failed retention sweep is still counted into the run-level errorCount', async () => {
    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => [patternFor()]) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({
        events: {
          deleteSweptEventsOlderThan: mock(async () => {
            throw new Error('unreachable');
          }),
        },
      })
    );

    expect(result.eventsSwept).toBe(0);
    expect(result.patternsProcessed).toBe(1);
    expect(result.errorCount).toBeGreaterThan(0);
  });
});

describe('runScheduleHorizonJob — S4b: cross-household clash persistence', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const shiftA = {
    id: 's1',
    household_id: 'hh-a',
    carer_id: 'carer-1',
    starts_at: '2026-08-10T09:00:00.000Z',
    ends_at: '2026-08-10T14:00:00.000Z',
    local_date: '2026-08-10',
    ical_uid: 'uid-s1',
  };
  const shiftB = {
    id: 's2',
    household_id: 'hh-b',
    carer_id: 'carer-1',
    starts_at: '2026-08-10T13:00:00.000Z',
    ends_at: '2026-08-10T18:00:00.000Z',
    local_date: '2026-08-10',
    ical_uid: 'uid-s2',
  };

  it('scans an 84-day window from today and raises both sides of a clashing pair', async () => {
    const before = Date.now();
    const insertMany = mock(async (_rows: unknown[]) => []);
    const listLiveForClashScan = mock(async (_from: string, _to: string) => [
      shiftA,
      shiftB,
    ]);
    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({
        clashScan: { listLiveForClashScan },
        clashEvents: {
          listEventKeysForDate: mock(async () => new Set<string>()),
          insertMany,
        },
      })
    );
    const after = Date.now();

    expect(listLiveForClashScan).toHaveBeenCalledTimes(1);
    const [fromIso, toIso] = listLiveForClashScan.mock.calls[0] ?? [];
    expect(Date.parse(String(fromIso))).toBeGreaterThanOrEqual(before);
    expect(Date.parse(String(fromIso))).toBeLessThanOrEqual(after);
    expect(Date.parse(String(toIso))).toBeGreaterThanOrEqual(
      before + 84 * DAY_MS
    );
    expect(Date.parse(String(toIso))).toBeLessThanOrEqual(after + 84 * DAY_MS);

    expect(insertMany).toHaveBeenCalledTimes(1);
    const rows = insertMany.mock.calls[0]?.[0] as Array<{
      household_id: string;
      shift_id: string;
      event_type: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.household_id).sort()).toEqual(['hh-a', 'hh-b']);
    expect(rows.every(r => r.event_type === 'cross_family_clash')).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it('is idempotent — an already-raised key is not re-inserted', async () => {
    const insertMany = mock(async (_rows: unknown[]) => []);
    // hh-a already has s1's half of the pair raised; hh-b does not yet.
    const listEventKeysForDate = mock(
      async (householdId: string, _localDate: string, _eventType: string) =>
        householdId === 'hh-a' ? new Set(['s1|uid-s2']) : new Set<string>()
    );

    await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({
        clashScan: {
          listLiveForClashScan: mock(async () => [shiftA, shiftB]),
        },
        clashEvents: { listEventKeysForDate, insertMany },
      })
    );

    expect(insertMany).toHaveBeenCalledTimes(1);
    const rows = insertMany.mock.calls[0]?.[0] as Array<{
      household_id: string;
    }>;
    // Only hh-b's half is new; hh-a's was already raised.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.household_id).toBe('hh-b');
  });

  it('a sweep failure is isolated and counted into the run-level errorCount', async () => {
    const result = await runScheduleHorizonJob(
      { listAccepted: mock(async () => [patternFor()]) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({
        clashScan: {
          listLiveForClashScan: mock(async () => {
            throw new Error('unreachable');
          }),
        },
      })
    );

    expect(result.patternsProcessed).toBe(1);
    expect(result.errorCount).toBe(1);
  });

  it('does not query for keys or insert anything when nothing clashes', async () => {
    const listEventKeysForDate = mock(async () => new Set<string>());
    const insertMany = mock(async (_rows: unknown[]) => []);
    await runScheduleHorizonJob(
      { listAccepted: mock(async () => []) },
      noOpMaterialiser(),
      noChangeRequests(),
      noOpJobDeps({
        clashScan: { listLiveForClashScan: mock(async () => []) },
        clashEvents: { listEventKeysForDate, insertMany },
      })
    );

    expect(listEventKeysForDate).not.toHaveBeenCalled();
    expect(insertMany).not.toHaveBeenCalled();
  });
});
