/**
 * @module tests/unit/domains/timesheet/services/timesheetCommandService.observedInstants
 *
 * Migration 113's write rule: `observed_clock_in_at` / `observed_clock_out_at`
 * are non-null ONLY where the app actually watched a tap, and never move once
 * written.
 *
 * Two properties are load-bearing and neither is enforced by the database, so
 * they are pinned here:
 *
 * 1. **Frozen.** `updateEntry` must never name either column in its patch.
 *    There is no column grant and no trigger; the omission IS the guarantee.
 *    A correction that overwrote the observation would destroy the evidence
 *    the whole feature exists to keep.
 *
 * 2. **Null means "not observed", never "unchanged".** Retroactive entries,
 *    cancellation-pay rows and the BOUNDARY end of a split session carry
 *    null. Stamping a boundary — which is computed, not tapped — would make
 *    `wasEntryEdited` brand every overnight and week-crossing shift as
 *    corrected, the exact false-marker class its `endsAtLocalMidnight`
 *    exception suppresses today.
 *
 * The forgotten-clock-out case is the one where observed and effective are
 * SUPPOSED to differ: she declares the finish she actually left at, and the
 * gap between that and the tap is the honest record.
 */
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const TZ = 'Pacific/Auckland';
const household = { id: 'h1', timezone: TZ, week_starts_on: 1 };

/** Saturday 15 Aug, 09:00–13:00 NZ. Comfortably inside one Mon-start week. */
const CLOCK_IN_UTC = '2026-08-14T21:00:00.000Z';
const CLOCK_OUT_UTC = '2026-08-15T01:00:00.000Z';

/**
 * A session that straddles the Monday boundary: Sunday 23:00 → Monday 02:00
 * NZ (UTC+12 in August), so the split lands at Monday 00:00 local.
 */
const SPLIT_IN_UTC = '2026-08-16T11:00:00.000Z';
const SPLIT_OUT_UTC = '2026-08-16T14:00:00.000Z';
const SPLIT_BOUNDARY_UTC = '2026-08-16T12:00:00.000Z';

const submittedEntry = {
  id: 't1',
  household_id: 'h1',
  carer_id: 'carer-1',
  carer_display_name: 'Nia Rowe',
  shift_id: null,
  clock_in_at: CLOCK_IN_UTC,
  clock_out_at: CLOCK_OUT_UTC,
  observed_clock_in_at: CLOCK_IN_UTC,
  observed_clock_out_at: CLOCK_OUT_UTC,
  break_minutes: 0,
  scheduled_minutes: null,
  kind: 'worked',
  note: null,
  status: 'submitted',
  local_date: '2026-08-15',
  timezone: TZ,
  created_at: 't',
  updated_at: 't',
};

const runningEntry = {
  ...submittedEntry,
  clock_out_at: null,
  observed_clock_out_at: null,
  status: 'running',
};

let TimesheetCommandService: typeof import('../../../../../src/domains/timesheet/services/timesheetCommandService').TimesheetCommandService;
let assertAgreed: ReturnType<typeof mock>;

beforeAll(async () => {
  assertAgreed = mock(async (..._args: unknown[]) => undefined);
  // Before the dynamic import (docs/09-TESTING.md §4), or the constructor's
  // default argument resolves the real D1-backed singleton.
  mock.module(
    '../../../../../src/domains/pay/services/termsGateService',
    () => ({
      termsGateService: {
        assertAgreed: (...args: unknown[]) => assertAgreed(...args),
      },
      TermsGateService: class {},
    })
  );

  TimesheetCommandService = (
    await import(
      '../../../../../src/domains/timesheet/services/timesheetCommandService'
    )
  ).TimesheetCommandService;
});

beforeEach(() => {
  assertAgreed.mockClear();
  assertAgreed.mockImplementation(async () => undefined);
});

type Any = any;

function makeService(overrides: Record<string, Any> = {}) {
  const timeEntryRepo: Any = {
    findRunningForCarer: mock(async () => null),
    findById: mock(async () => null),
    clockIn: mock(async (data: Record<string, unknown>) => ({
      ...runningEntry,
      ...data,
    })),
    createSubmitted: mock(async (data: Record<string, unknown>) => ({
      ...submittedEntry,
      ...data,
    })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      ...submittedEntry,
      ...patch,
    })),
    listForCarerWeek: mock(async () => []),
    listOverlapCandidatesForCarer: mock(async () => []),
    findCancellationPaidForSpan: mock(async () => null),
    ...(overrides.timeEntryRepo ?? {}),
  };
  const timesheetRepo: Any = {
    findByWeek: mock(async () => null),
    create: mock(async (data: Record<string, unknown>) => ({
      id: 'ts1',
      status: 'submitted',
      ...data,
    })),
    update: mock(async (_id: string, patch: Record<string, unknown>) => ({
      id: 'ts1',
      status: 'submitted',
      ...patch,
    })),
  };
  const memberRepo: Any = {
    findActiveMembership: mock(async () => ({
      id: 'm1',
      household_id: 'h1',
      user_id: 'carer-1',
      role: 'nanny',
    })),
    findMembershipAnyStatus: mock(async () => ({ id: 'm1' })),
  };
  const householdRepo: Any = { findById: mock(async () => household) };
  const shiftRepo: Any = {
    findById: mock(async () => null),
    findByHouseholdAndRange: mock(async () => []),
  };
  const queries: Any = {
    getOwnedTimeEntry: mock(async () => ({ ...submittedEntry })),
    getOwnedTimesheet: mock(async () => null),
    ...(overrides.queries ?? {}),
  };
  const userService: Any = {
    getProfileById: mock(async () => ({ user_id: 'carer-1', name: 'Nia' })),
  };
  const push: Any = {
    notifyUser: mock(() => undefined),
    notifyHouseholdParents: mock(() => undefined),
  };
  const earnings: Any = { computeWeek: mock(async () => null) };
  const eventRepo: Any = { insertMany: mock(async () => []) };

  const svc = new TimesheetCommandService(
    timeEntryRepo,
    timesheetRepo,
    memberRepo,
    householdRepo,
    shiftRepo,
    queries,
    userService,
    push,
    earnings,
    eventRepo
  );
  return { svc, timeEntryRepo, timesheetRepo, queries };
}

/** A running row that started an hour ago, so an ordinary "tap Clock out"
 * against the real server clock stays inside MAX_SESSION_SPAN_MS. */
function recentRunningEntry() {
  return {
    ...runningEntry,
    clock_in_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  };
}

describe('clockIn — the start is observed', () => {
  it('freezes observed_clock_in_at at the same instant as clock_in_at', async () => {
    const { svc, timeEntryRepo } = makeService();

    await svc.clockIn(
      'carer-1',
      { household_id: 'h1' },
      () => new Date(CLOCK_IN_UTC)
    );

    const data = timeEntryRepo.clockIn.mock.calls[0][0];
    expect(data.clock_in_at).toBe(CLOCK_IN_UTC);
    expect(data.observed_clock_in_at).toBe(CLOCK_IN_UTC);
  });
});

describe('clockOut — the finish is observed', () => {
  it('stamps observed_clock_out_at equal to the finish on the ordinary path', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: {
        getOwnedTimeEntry: mock(async () => recentRunningEntry()),
      },
    });

    await svc.clockOut('carer-1', 't1', {});

    const patch = timeEntryRepo.update.mock.calls[0][1];
    // No declared finish, so the tap IS the finish — one `new Date()`, used
    // twice, so these can never drift by the milliseconds between two calls.
    expect(patch.observed_clock_out_at).toBe(patch.clock_out_at);
  });

  it('keeps the tap when a forgotten clock-out declares a different finish', async () => {
    const declared = '2026-08-15T01:00:00.000Z';
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => ({ ...runningEntry })) },
    });

    await svc.clockOut('carer-1', 't1', { clock_out_at: declared });

    const patch = timeEntryRepo.update.mock.calls[0][1];
    // She left at 13:00 and tapped the next morning. Effective takes what she
    // says; observed keeps what the app saw. The gap is the record.
    expect(patch.clock_out_at).toBe(declared);
    expect(patch.observed_clock_out_at).not.toBe(declared);
    expect(
      new Date(patch.observed_clock_out_at as string).getTime()
    ).toBeGreaterThan(new Date(declared).getTime());
  });
});

describe('a split session — exactly one observed end per fragment', () => {
  it('gives the tap to the fragment that closes at it, and the boundary end none', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: {
        getOwnedTimeEntry: mock(async () => ({
          ...runningEntry,
          clock_in_at: SPLIT_IN_UTC,
          local_date: '2026-08-16',
        })),
      },
    });

    await svc.clockOut('carer-1', 't1', { clock_out_at: SPLIT_OUT_UTC });

    // Fragment B opens at the boundary and closes at the real finish.
    const fragmentB = timeEntryRepo.createSubmitted.mock.calls[0][0];
    expect(fragmentB.clock_in_at).toBe(SPLIT_BOUNDARY_UTC);
    expect(fragmentB.observed_clock_in_at).toBeUndefined();
    expect(fragmentB.observed_clock_out_at).toBeTruthy();

    // Fragment A keeps its real start and closes at the boundary, which
    // nobody tapped — so its patch must not name the finish observation.
    const patchA = timeEntryRepo.update.mock.calls[0][1];
    expect(patchA.clock_out_at).toBe(SPLIT_BOUNDARY_UTC);
    expect(patchA).not.toHaveProperty('observed_clock_out_at');
    expect(patchA).not.toHaveProperty('observed_clock_in_at');
  });
});

describe('rows the app never watched', () => {
  it('stamps neither column on a retroactive entry', async () => {
    const { svc, timeEntryRepo } = makeService();

    await svc.createRetroactiveEntry('carer-1', {
      household_id: 'h1',
      clock_in_at: CLOCK_IN_UTC,
      clock_out_at: CLOCK_OUT_UTC,
    });

    const data = timeEntryRepo.createSubmitted.mock.calls[0][0];
    // A claim about the past, not an observation — and that null is exactly
    // what distinguishes it from a real clock-out.
    expect(data.observed_clock_in_at).toBeUndefined();
    expect(data.observed_clock_out_at).toBeUndefined();
  });
});

describe('updateEntry — the observation is frozen', () => {
  it('never names either observed column in its patch', async () => {
    const { svc, timeEntryRepo } = makeService();

    await svc.updateEntry('carer-1', 't1', {
      clock_in_at: '2026-08-14T20:30:00.000Z',
    });

    const patch = timeEntryRepo.update.mock.calls[0][1];
    expect(patch.clock_in_at).toBe('2026-08-14T20:30:00.000Z');
    // The only thing making these immutable: no column grant, no trigger.
    expect(patch).not.toHaveProperty('observed_clock_in_at');
    expect(patch).not.toHaveProperty('observed_clock_out_at');
  });
});

describe('updateEntry — correcting a start while still on the clock', () => {
  /** A runner an hour old: inside MAX_SESSION_SPAN_MS, so only the guard
   * under test can reject it. */
  function runningNow(minutesAgo = 60) {
    return {
      ...runningEntry,
      clock_in_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    };
  }

  it('accepts a start-only correction and leaves the observation alone', async () => {
    const started = runningNow();
    const corrected = new Date(Date.now() - 80 * 60_000).toISOString();
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => started) },
    });

    await svc.updateEntry('carer-1', 't1', { clock_in_at: corrected });

    const patch = timeEntryRepo.update.mock.calls[0][1];
    expect(patch.clock_in_at).toBe(corrected);
    expect(patch).not.toHaveProperty('observed_clock_in_at');
    expect(patch).not.toHaveProperty('status');
  });

  it('refuses a finish or a break while running — neither has happened yet', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => runningNow()) },
    });

    await expect(
      svc.updateEntry('carer-1', 't1', {
        clock_out_at: new Date().toISOString(),
      })
    ).rejects.toThrow();
    await expect(
      svc.updateEntry('carer-1', 't1', { break_minutes: 30 })
    ).rejects.toThrow();
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });

  it('refuses a start in the future', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => runningNow()) },
    });

    await expect(
      svc.updateEntry('carer-1', 't1', {
        clock_in_at: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
    ).rejects.toThrow();
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });

  it('refuses a start that would stretch the live session past the ceiling', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => runningNow()) },
    });

    await expect(
      svc.updateEntry('carer-1', 't1', {
        // 17h ago, against a 16h ceiling measured from the NEW start to now.
        clock_in_at: new Date(Date.now() - 17 * 60 * 60_000).toISOString(),
      })
    ).rejects.toThrow();
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });

  it('still refuses a voided entry', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: {
        getOwnedTimeEntry: mock(async () => ({
          ...submittedEntry,
          status: 'voided',
        })),
      },
    });

    await expect(
      svc.updateEntry('carer-1', 't1', { clock_in_at: CLOCK_IN_UTC })
    ).rejects.toThrow();
    expect(timeEntryRepo.update).not.toHaveBeenCalled();
  });
});

describe('clockOut — a start corrected on the way out', () => {
  it('writes both ends in ONE update, and still freezes only the finish', async () => {
    const declaredIn = '2026-08-14T20:30:00.000Z';
    const declaredOut = '2026-08-15T01:00:00.000Z';
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => ({ ...runningEntry })) },
    });

    await svc.clockOut('carer-1', 't1', {
      clock_in_at: declaredIn,
      clock_out_at: declaredOut,
    });

    expect(timeEntryRepo.update).toHaveBeenCalledTimes(1);
    const patch = timeEntryRepo.update.mock.calls[0][1];
    expect(patch.clock_in_at).toBe(declaredIn);
    expect(patch.clock_out_at).toBe(declaredOut);
    expect(patch.observed_clock_out_at).not.toBe(declaredOut);
    expect(patch).not.toHaveProperty('observed_clock_in_at');
  });

  it('leaves clock_in_at untouched when she did not correct it', async () => {
    const { svc, timeEntryRepo } = makeService({
      queries: { getOwnedTimeEntry: mock(async () => ({ ...runningEntry })) },
    });

    await svc.clockOut('carer-1', 't1', {
      clock_out_at: '2026-08-15T01:00:00.000Z',
    });

    const patch = timeEntryRepo.update.mock.calls[0][1];
    expect(patch).not.toHaveProperty('clock_in_at');
  });
});
